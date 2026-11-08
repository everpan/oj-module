import type { WecomCache, WecomClient } from "./client";
import type { WecomStoreDeps } from "./store";
// 企微登录领域服务：授权链接构造、state 一次性票据、code→userid、JIT 建档。
//
// 两条入口（都落在同一个回调上）：
//   · 企微客户端内打开（UA 含 wxwork）→ 网页授权 snsapi_privateinfo，拿 code + user_ticket；
//     privateinfo 会弹一次企微授权页（成员敏感信息），换取本人头像等字段的读取权；
//   · 普通浏览器 → qrConnect 扫码（appid=corpid + agentid）。
// 二者换 userid 走同一个 `auth/getuserinfo`（代开发=自建应用口径，不是第三方应用口径）。
//
// JIT（无独立注册）：外部身份沿用 `wecom:<userid>` 用户名前缀（D6），口令哈希占位 `!wecom`
// （任何口令都验不过，低信任来源不接管本地号，同 ldap 的 `!ldap`）；外层租户由 corp_id 决定。
//
// 轨一「登录自更新」（方案 §6.1）：登录成功后顺手 user/get 一次，补本人资料与所属部门。
// 四条纪律：① 24h 节流（老用户不重复打上游）；② 整体 try/catch，失败不影响登录；
// ③ **不建占位部门**——只对已知部门写关联（D10，否则任何登录成员都能凭空造出部门节点）；
// ④ 只加不摘：人调到新部门只加新的，旧部门由全量同步/事件摘除。
// 落库只有**一个**函数（applyMemberDetail）：轨二（全量同步）、轨三（事件增量）也调它——
// 三套写库逻辑必然长歪，而症状只在「某条路径走过来的人组织关系不对」时才暴露。
import { bytesToBase64 } from "#/_platform/_shared/base64";

import { setMainDepartment, upsertMember } from "#/_platform/_shared/service/domain/org";

export const AUTHORIZE_IN_APP = "https://open.weixin.qq.com/connect/oauth2/authorize";
export const AUTHORIZE_QRCODE = "https://open.work.weixin.qq.com/wwopen/sso/qrConnect";

/** 登录票据有效期：302 落地后 SPA 立即兑换，180s 足够；越短越安全 */
export const LOGIN_TICKET_TTL_SECS = 180;

/** state 一次性票据（kv）：既不进 URL 也不可伪造——随机 nonce 即凭证，服务端查得到才认 */
export const LOGIN_STATE_TTL_SECS = 600;

export interface PendingLogin {
	corpId: string
	agentId: string
	env: string
}

export function isWecomUa(ua: string): boolean {
	return /wxwork/i.test(ua);
}

/**
 * 授权链接。`redirect_uri` 必须整串 encode（含自己的 query），否则企微会把我们的参数当自己的解析。
 * 扫码用 qrConnect（`appid` + `agentid`）；企微内用 oauth2 授权。
 *
 * 为什么 scope = snsapi_privateinfo：2022-06-20 起企微不再通过 user/get 下发头像，
 * 必须让成员在授权页确认「敏感信息」后拿 user_ticket，再换 auth/getuserdetail。
 * 代价是企微内首次进入会看到授权页；扫码入口（qrConnect）没有该 scope，仍拿不到头像。
 */
export function buildAuthorizeUrl(opts: {
	corpId: string
	agentId?: string
	redirectUri: string
	state: string
	inWecom: boolean
}): string {
	const redirect = encodeURIComponent(opts.redirectUri);
	const appid = encodeURIComponent(opts.corpId);
	// 多应用未指定 agent 时省略 agentid：以 corp 维度授权（企微回跳只给 userid，不绑定具体应用）
	const agent = opts.agentId ? `&agentid=${encodeURIComponent(opts.agentId)}` : "";
	if (opts.inWecom) {
		return `${AUTHORIZE_IN_APP}?appid=${appid}&redirect_uri=${redirect}&response_type=code&scope=snsapi_privateinfo&state=${encodeURIComponent(opts.state)}${agent}#wechat_redirect`;
	}
	return `${AUTHORIZE_QRCODE}?appid=${appid}${agent}&redirect_uri=${redirect}&state=${encodeURIComponent(opts.state)}`;
}

/**
 * 代开发模板常只服务一家企业：登录入口不传 corp 时，从已安装档案自动解析，
 * 让「应用主页」直接填 https://<域名>/login 即可（无需 ${corpid} 占位符，避开企微后台对非法 URL 字符的校验）。
 *
 * `self` = 本部署自己那家企业内部应用（`wecom_corp_*` 配了什么）。
 * 共存部署里必须传：否则别家企业通过代开发装进来的档案会把「本站默认登录哪家企业」淹掉，
 * 本站自己的 `/login` 反倒回 400「已授权多家企业」。传了就按「自己的企业优先」解析，
 * 且默认 agent 也来自配置，不再依赖写死的应用 id。
 */
export interface SelfApp {
	corpId: string
	agentId: string
}

export async function resolveWecomProfile(agentId: string | null, self?: SelfApp): Promise<{ corpId: string, agentId: string, env: string }> {
	const rows = await db.table("wecom_app_profile")
		.select(["corp_id", "agent_id", "env", "status"])
		.where({ field: "status", op: "eq", value: "active" })
		.all() as Array<{ corp_id: string, agent_id: string, env: string | null, status: string }>;
	const active = rows.filter(r => String(r.status) === "active");
	if (!active.length)
		throw Object.assign(new Error("尚未完成企业微信接入（无可用应用档案）：代开发请先扫码开通；企业内部应用请在后台点「验证并接入」"), { status: 400 });
	const pool = self ? active.filter(r => String(r.corp_id) === self.corpId) : active;
	if (!pool.length)
		throw Object.assign(new Error("本次部署配置的企业内部应用尚未接入：请在后台点「验证并接入」"), { status: 400 });
	const corps = [...new Set(pool.map(r => String(r.corp_id)))];
	if (corps.length > 1 && !agentId)
		throw Object.assign(new Error("已授权多家企业，请在登录链接带 corp 参数以区分"), { status: 400 });
	const corpId = self ? self.corpId : corps[0]!;
	const agents = pool.filter(r => String(r.corp_id) === corpId);
	// 指定 agent 就必须命中；未指定时：自建应用优先取配置里的 agent，否则取首个活跃应用
	const pick = agentId
		? agents.find(a => String(a.agent_id) === agentId)
		: (self ? agents.find(a => String(a.agent_id) === self.agentId) : undefined) ?? agents[0];
	if (!pick)
		throw Object.assign(new Error("指定的 agent 在该企业中不存在"), { status: 400 });
	return { corpId: String(pick.corp_id), agentId: String(pick.agent_id), env: pick.env == null ? "prod" : String(pick.env) };
}

export async function putLoginState(nonce: string, pending: PendingLogin, cache: WecomCache): Promise<void> {
	await cache.set(`wecom:state:${nonce}`, JSON.stringify(pending), LOGIN_STATE_TTL_SECS);
}

/** 取并立即删除（一次性）：拿不到 = 过期/伪造/已用过 */
export async function takeLoginState(nonce: string, cache: WecomCache): Promise<PendingLogin> {
	const raw = await cache.get(`wecom:state:${nonce}`);
	if (!raw)
		throw Object.assign(new Error("登录状态已失效，请从企业微信重新进入"), { status: 400 });
	await cache.del(`wecom:state:${nonce}`);
	const parsed = JSON.parse(raw) as Partial<PendingLogin>;
	if (!parsed.corpId || !parsed.agentId)
		throw Object.assign(new Error("登录状态已失效，请从企业微信重新进入"), { status: 400 });
	return { corpId: parsed.corpId, agentId: parsed.agentId, env: parsed.env ?? "prod" };
}

/** 外部号用户名命名空间（D6）：与 ldap:/sso: 同约定，禁止本地建号占用 */
export function externalUsername(userid: string): string {
	return `wecom:${userid}`;
}

/** 占位口令哈希：bcrypt.verify 对任何口令返回 false（与 `!ldap` 同义） */
export const WECOM_PASSWORD_PLACEHOLDER = "!wecom";

/**
 * JIT find-or-create（租户由调用方先 ensureTenant 绑好，insert 的 tenant_id 由 sql_guard 自动填）。
 * 返回 uid 与禁用位：禁号仍要拦（企微侧未移除，本地已停用时拒绝签发）。
 *
 * `resolveName` 只在**首次建档**时调用一次（老用户不为此多打一次上游）：拿到名字就写进
 * `display_name`，拿不到（无通讯录权限/上游抖）用工号兜底——用户列表里宁可显示工号，也不要空白行。
 */
export async function ensureWecomUser(
	corpId: string,
	userid: string,
	resolveName?: () => Promise<string | null>,
): Promise<{ uid: number, forbidden: boolean }> {
	const username = externalUsername(userid);
	let rows = await db.table("users").select(["id", "is_forbidden"]).where({ field: "username", op: "eq", value: username }).all() as Array<{ id: number, is_forbidden: number }>;
	if (!rows.length) {
		const name = resolveName ? await resolveName().catch(() => null) : null;
		try {
			await db.table("users").insert({
				username,
				display_name: name?.trim() || userid,
				password_hash: WECOM_PASSWORD_PLACEHOLDER,
				avatar_base64: "",
				source: "wecom",
				corp_id: corpId,
				must_change: 0,
				is_forbidden: 0,
				// 走到这里说明真人正在扫码登录 → 这位是「用过本站」的活人，进通讯录目录
				activated: 1,
			}).run();
		}
		catch (e) {
			// 唯一约束兜底（预查与插入间的竞态，同 createUser / ldap 模式）：撞 (tenant_id, username) → 回查复用
			if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e)))
				throw e;
		}
		rows = await db.table("users").select(["id", "is_forbidden"]).where({ field: "username", op: "eq", value: username }).all() as Array<{ id: number, is_forbidden: number }>;
	}
	if (!rows.length)
		throw Object.assign(new Error("账号建档失败"), { status: 500 });
	return { uid: Number(rows[0]!.id), forbidden: Number(rows[0]!.is_forbidden) === 1 };
}

/**
 * 换会话前的最后一道闸：建号可能已过几分钟（票据 TTL 180s），期间管理员可能停用了这个号。
 * 「企微侧还在、本地已停用」必须以本地为准（停用是安全动作，不能被 IdP 覆盖）。
 */
export async function assertUserActive(uid: number): Promise<void> {
	const rows = await db.table("users").select(["is_forbidden"]).where({ field: "id", op: "eq", value: uid }).all() as Array<{ is_forbidden: number }>;
	if (!rows[0])
		throw Object.assign(new Error("账号不存在"), { status: 401 });
	if (Number(rows[0].is_forbidden) === 1)
		throw Object.assign(new Error("账号已被停用，请联系管理员"), { status: 403 });
}

/**
 * 302 落地地址：票据只能走 query（浏览器历史/Referer 可见，故只是**一次性票**，不是 token）。
 * `tenant` 一并带上：前端 tenantStore 启动时读它 → 后续每个请求的 `X-TENANT-ID` 才对得上，
 * 否则换票请求会落到默认租户、被 `ensureTenant` 判成 403。
 * 路径用 SPA 默认的 browser 路由 `/login`；hash 路由部署由前端 Phase 2 的落地页自行改写。
 */
export function loginLandingUrl(opts: { origin: string, ticket: string, tenant: string }): string {
	const q = new URLSearchParams({ wecom_ticket: opts.ticket, tenant: opts.tenant });
	return `${opts.origin}/login?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// 轨一：登录自更新（方案 §6.1）
// ---------------------------------------------------------------------------

/** 节流窗口：一个企业上万员工每天登录都会触发，不节流就是把 user/get 打成常驻流量 */
export const SELF_UPDATE_TTL_SECS = 24 * 60 * 60;

export interface SelfUpdateCtx {
	uid: number
	userid: string
	corpId: string
	agentId: string
	permanentCode: string
}

export interface SelfUpdateDeps {
	client: WecomClient
	cache: WecomCache
	store: WecomStoreDeps
}

/** 企微在职状态里「不该再放进来」的两档：2=已禁用、5=退出企业（4=未激活仍可登录） */
function isBlockedStatus(status: number | null): boolean {
	return status === 2 || status === 5;
}

async function dbExternalStatus(userid: string): Promise<number | null> {
	const rows = await db.table("users").select(["external_status"]).where({ field: "username", op: "eq", value: externalUsername(userid) }).all() as Array<{ external_status: number | null }>;
	const v = rows[0]?.external_status;
	return v == null ? null : Number(v);
}

/** 一条成员的「外部源口径」快照：登录自更新、全量同步、事件增量三处都写这一个形状 */
export interface MemberDetail {
	/** undefined = 这条数据源没给名字，保留原值（空串/空白的名字不写） */
	name?: string | null
	/** undefined = 没给（无通讯录权限时回包不含该字段），**不写**；string = 头像 CDN URL */
	avatar?: string | null
	/** undefined = 没给，**不写**（别把已知职务清成 null；null = 明确为空，写 null） */
	position?: string | null
	/** 同上：undefined = 不知道在职状态，不能覆盖 */
	status?: number | null
	departments: string[]
	orders?: number[]
	leaderInDept?: number[]
	mainDepartment?: number | null
}

/**
 * 把一条成员详情写回本地：资料（姓名/职务/在职状态）+ 所属部门关联。
 *
 * **三轨共用这一个写入口**（登录自更新 / 全量同步 / 事件增量）：两套写库逻辑必然长歪——
 * 一处漏了主部门兜底、一处漏了 D13 归属权，症状都是「某类路径走过来的人组织关系不对」，
 * 而且只在特定组合下才出现。所以这里只认「一条快照」，不认它从哪个轨来。
 *
 * **只加不摘**：人调到新部门只写新部门，旧部门不在这里删——摘除属全量同步/事件增量的职责，
 * 登录路径上删关联会在「企微接口这次只返回部分部门」时把人的组织关系误删。
 * **只写企微拥有的行**（D13）：`source != 'wecom'`（管理员已「转为本地维护」）一律不覆盖。
 */
export async function applyMemberDetail(
	ctx: { uid: number, userid: string },
	detail: MemberDetail,
	opts: {
		now: () => number
		/** 真人刚登录过 → 纳入通讯录目录（§9.1）。同步与事件建档的人**不算**用过本站。 */
		activated?: boolean
		/** 全量同步按片预取的「企微部门 origin_id → 本地 id」；缺省时按本次涉及的部门现查 */
		deptByOrigin?: Map<string, number>
		/**
		 * 企微头像下载（best-effort，返回 null = 拿不到/超限，不写）。
		 * **补缺不覆盖**：只对本地 avatar_base64 为空的行发起下载——用户自己在个人中心
		 * 上传的头像不能被 24h 登录同步冲掉；D13 由下面的 SELECT（source='wecom'）一并挡掉。
		 */
		fetchAvatar?: (url: string) => Promise<{ bytes: Uint8Array, contentType: string } | null>
	},
): Promise<void> {
	const cols: Record<string, unknown> = {};
	if (detail.position !== undefined)
		cols.position = detail.position;
	if (detail.status !== undefined)
		cols.external_status = detail.status;
	if (opts.activated)
		cols.activated = 1;
	const displayName = detail.name?.trim();
	if (displayName)
		cols.display_name = displayName;
	const avatarUrl = typeof detail.avatar === "string" ? detail.avatar.trim() : "";
	if (avatarUrl && opts.fetchAvatar) {
		const local = await db.table("users").select(["avatar_base64"]).where({ and: [
			{ field: "username", op: "eq", value: externalUsername(ctx.userid) },
			{ field: "source", op: "eq", value: "wecom" },
		] }).all() as Array<{ avatar_base64: string | null }>;
		if (local.length && !String(local[0].avatar_base64 ?? "")) {
			const got = await opts.fetchAvatar(avatarUrl).catch(() => null);
			if (got)
				cols.avatar_base64 = `data:${got.contentType};base64,${bytesToBase64(got.bytes)}`;
		}
	}
	if (Object.keys(cols).length) {
		await db.table("users").update(cols).where({ and: [
			{ field: "username", op: "eq", value: externalUsername(ctx.userid) },
			{ field: "source", op: "eq", value: "wecom" },
		] }).run();
	}

	if (!detail.departments.length)
		return;
	const byOrigin = opts.deptByOrigin ?? await wecomDeptIndex(detail.departments);
	const orgDeps = { now: opts.now };
	for (const [i, originId] of detail.departments.entries()) {
		const deptId = byOrigin.get(String(originId));
		// D10：未知部门一律跳过，等全量同步补——这里若能建部门，任何登录成员都能伪造组织架构
		if (!deptId)
			continue;
		await upsertMember({
			userId: ctx.uid,
			deptId,
			orderNo: detail.orders?.[i] ?? 0,
			isLeader: (detail.leaderInDept?.[i] ?? 0) === 1,
		}, orgDeps);
	}
	// 主部门可能缺失（仅当应用对主部门有查看权限时才返回）→ 兜底取 department[0]
	const mainOrigin = detail.mainDepartment != null ? String(detail.mainDepartment) : String(detail.departments[0]!);
	const mainDept = byOrigin.get(mainOrigin);
	if (mainDept != null)
		await setMainDepartment(ctx.uid, mainDept, orgDeps);
}

/**
 * 登录后同步本人企微头像（best-effort）。
 *
 * 图源只能来自 `snsapi_privateinfo` 的 user_ticket → auth/getuserdetail（见 client.ts），
 * 与 user/get 的 24h 自更新节流无关：每次登录都能补，但只在本地为空时写一次。
 * 任何失败静默——头像不是登录的必要条件。
 */
export async function applyLoginAvatar(
	ctx: { uid: number, userid: string },
	avatarUrl: string | null,
	client: WecomClient,
): Promise<boolean> {
	// 返回 true = 本地已有头像或本次写入成功（调用方不必再试下一个 URL）；
	// false = 这个 URL 没拿到字节，可以回落原图。
	if (!avatarUrl)
		return false;
	try {
		const rows = await db.table("users").select(["avatar_base64"]).where({ field: "id", op: "eq", value: ctx.uid }).all() as Array<{ avatar_base64: string | null }>;
		if (!rows.length)
			return false;
		if (String(rows[0].avatar_base64 ?? ""))
			return true;
		const got = await client.avatarBytes(avatarUrl).catch(() => null);
		if (!got)
			return false;
		await db.table("users").update({ avatar_base64: `data:${got.contentType};base64,${bytesToBase64(got.bytes)}` }).where({ field: "id", op: "eq", value: ctx.uid }).run();
		return true;
	}
	catch (e) {
		log.warn("wecom avatar sync skipped", "userid", ctx.userid, "reason", (e as Error).message);
		return false;
	}
}

async function wecomDeptIndex(originIds: string[]): Promise<Map<string, number>> {
	const rows = await db.table("sys_department").select(["id", "origin_id"]).where({ and: [
		{ field: "origin", op: "eq", value: "wecom" },
		{ field: "origin_id", op: "in", value: originIds },
	] }).all() as Array<{ id: number, origin_id: string }>;
	return new Map(rows.map(r => [String(r.origin_id), Number(r.id)]));
}

/**
 * 登录自更新入口。**永不抛出**：任何失败只告警并放过登录（拿不到就用兜底值）。
 * 返回值 `blocked` 供调用方在换会话前拦「企微侧已离职/禁用」的账号。
 */
export async function selfUpdate(ctx: SelfUpdateCtx, deps: SelfUpdateDeps): Promise<{ blocked: boolean }> {
	const key = `wecom:self:${ctx.corpId}:${ctx.userid}`;
	try {
		if (await deps.cache.get(key))
			return { blocked: isBlockedStatus(await dbExternalStatus(ctx.userid)) };
		const detail = await deps.client.userDetail(ctx.corpId, ctx.agentId, ctx.permanentCode, ctx.userid);
		// null = 无通讯录权限 / 不在可见范围 / 上游抖：本次不更新，也别写节流键（下次登录重试）
		if (!detail)
			return { blocked: isBlockedStatus(await dbExternalStatus(ctx.userid)) };
		// 真人刚扫码登录过 → 纳入通讯录目录（§9.1）；同步/事件建档的人不算
		await applyMemberDetail(ctx, detail, { now: deps.store.now, activated: true, fetchAvatar: url => deps.client.avatarBytes(url) });
		await deps.cache.set(key, "1", SELF_UPDATE_TTL_SECS);
		return { blocked: isBlockedStatus(detail.status) };
	}
	catch (e) {
		log.warn("wecom self-update skipped", "userid", ctx.userid, "reason", (e as Error).message);
		return { blocked: false };
	}
}
