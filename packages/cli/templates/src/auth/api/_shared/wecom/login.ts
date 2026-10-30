// 企微登录领域服务：授权链接构造、state 一次性票据、code→userid、JIT 建档。
//
// 两条入口（都落在同一个回调上）：
//   · 企微客户端内打开（UA 含 wxwork）→ 网页授权 snsapi_base，静默拿 code；
//   · 普通浏览器 → qrConnect 扫码（appid=corpid + agentid）。
// 二者换 userid 走同一个 `auth/getuserinfo`（代开发=自建应用口径，不是第三方应用口径）。
//
// JIT（无独立注册）：外部身份沿用 `wecom:<userid>` 用户名前缀（D6），口令哈希占位 `!wecom`
// （任何口令都验不过，低信任来源不接管本地号，同 ldap 的 `!ldap`）；外层租户由 corp_id 决定。
import type { WecomCache } from "./client";

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
 * 扫码用 qrConnect（`appid` + `agentid`）；企微内用 oauth2 授权（scope 固定 snsapi_base：
 * 只换 userid，不弹授权页，够 JIT 与身份识别；要姓名头像再加 snsapi_privateinfo，属 Phase 3）。
 */
export function buildAuthorizeUrl(opts: {
	corpId: string
	agentId: string
	redirectUri: string
	state: string
	inWecom: boolean
}): string {
	const redirect = encodeURIComponent(opts.redirectUri);
	const appid = encodeURIComponent(opts.corpId);
	const agentid = encodeURIComponent(opts.agentId);
	if (opts.inWecom) {
		return `${AUTHORIZE_IN_APP}?appid=${appid}&redirect_uri=${redirect}&response_type=code&scope=snsapi_base&state=${encodeURIComponent(opts.state)}&agentid=${agentid}#wechat_redirect`;
	}
	return `${AUTHORIZE_QRCODE}?appid=${appid}&agentid=${agentid}&redirect_uri=${redirect}&state=${encodeURIComponent(opts.state)}`;
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
