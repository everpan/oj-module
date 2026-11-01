import type { WecomClient, WecomDept } from "./client";
import type { WecomKind } from "./config";
import type { MemberDetail } from "./login";
import type { CallbackFields } from "./payload";
import type { WecomStoreDeps } from "./store";
// 轨三：通讯录变更事件增量（`change_contact`）。
//
// 定位是**加速器，不是权威**（方案 §6.3）：权威永远是全量同步。事件只负责「管理员刚改完，
// 页面上马上能看见」，所以这里的纪律与全量同步正好相反——
//   · 任何失败都**不抛**（`handleContactChange` 全包在 try/catch 里），照旧回 success。
//     企微拿不到 success 会重推三次，而重推补不回一次已经判死的失败，只会让企业管理员
//     在后台看到「应用安装失败」；真正的兜底是下一轮全量同步。
//   · 只记 `ChangeType` / 企业 ID / 失败原因，**不记姓名与工号**（明文里有）。
//
// 两种报文形态都认（归一化在 payload.ts）：
//   · 应用侧数据回调（90970）：`ToUserName`(=corpid) / `FromUserName=sys` / `MsgType=event` /
//     `Event=change_contact` / `ChangeType` / `UserID` / `Name` / `Department` / `MainDepartment` /
//     `IsLeaderInDept` / `Position`；
//   · 代开发指令回调（91134）：`SuiteId` / `AuthCorpId` / `InfoType=change_contact` /
//     `ChangeType` / `UserID`（或部门 `Id`）。它**只给 id**，姓名与归属得回源 `user/get` /
//     `department/get` 拿——这就是「事件里为什么还要出一次网」的全部原因。
//
// 写库一律复用轨一同一套函数（login.ts::applyMemberDetail）：三套写库逻辑必然长歪。
import { markDeleted, upsertDepartment } from "#/_platform/_shared/service/domain/org";
import { upsertSourceUser } from "#/_platform/_shared/service/domain/users";
import { applyMemberDetail, externalUsername } from "./login";
import { field, requireField } from "./payload";
import { ensureTenant, findCorpAuth, tenantOfCorp } from "./store";

/** 归属权标识（D13）：与 sync.ts 的 ORIGIN 同值，事件与同步必须写同一批行 */
const ORIGIN = "wecom";

export interface ContactEventDeps {
	client: WecomClient
	store: WecomStoreDeps
	/**
	 * 本次回调**验签命中的**凭据来源（由入口从 `callbackCreds()` 传下来）。
	 * 同一家企业可能有代开发行与自建行，取哪一行的 secret 决定这次事件读通讯录能不能成。
	 */
	credentialKind: WecomKind
}

/** 一条事件的执行上下文：企业已授权 → 应用 与 永久码（= 企业应用 secret） */
interface CorpCtx {
	corpId: string
	agentId: string
	secret: string
	now: () => number
	client: WecomClient
}

/**
 * 事件入口：**永不抛出**，返回值只用于日志（`handleSuiteEvent` 原样回给调用方记一行）。
 *
 * 企业身份两处取：应用侧数据回调放在 `ToUserName`（corpid），代开发指令回调放在 `AuthCorpId`。
 * 两者都空时无从判断租户，直接记一笔放弃——猜一个默认企业比不处理更危险。
 */
export async function handleContactChange(fields: CallbackFields, deps: ContactEventDeps): Promise<string> {
	const changeType = field(fields, "ChangeType");
	const corpId = field(fields, "AuthCorpId") || field(fields, "ToUserName");
	if (!changeType) {
		log.info("wecom change_contact skipped", "reason", "报文里没有 ChangeType");
		return "change_contact";
	}
	try {
		const handled = await applyChange(changeType, corpId, fields, deps);
		if (handled)
			log.info("wecom change_contact applied", "changeType", changeType, "corpId", corpId);
		else
			log.info("wecom change_contact not consumed", "changeType", changeType, "corpId", corpId);
	}
	catch (e) {
		log.warn("wecom change_contact ignored", "changeType", changeType, "corpId", corpId, "reason", (e as Error).message);
	}
	return changeType;
}

/** 返回 true = 本 ChangeType 被消费；false = 不认识（标签变更等），记账即可 */
async function applyChange(changeType: string, corpId: string, fields: CallbackFields, deps: ContactEventDeps): Promise<boolean> {
	if (!corpId)
		throw new Error("报文里没有企业身份（ToUserName / AuthCorpId 皆空）");
	const auth = await findCorpAuth(corpId, deps.store, deps.credentialKind);
	if (!auth)
		throw new Error("该企业未授权本站（wecom_app_profile 无记录）");
	const ctx: CorpCtx = {
		corpId: auth.corpId,
		// 永久码是 (suite, corp) 级的，应用只决定 token 缓存键，任取一个已授权应用即可
		agentId: auth.agentIds[0] ?? "",
		secret: auth.permanentCode,
		now: deps.store.now,
		client: deps.client,
	};
	// 顺序刚性：先绑租户再碰 users / sys_department / sys_dept_member——
	// 本端点匿名（企微带不了 X-TENANT-ID），`sql_guard: deny` 下没有租户上下文的写会被直接拒。
	ensureTenant(tenantOfCorp(auth.corpId));

	switch (changeType) {
		case "create_user":
		case "update_user":
			await applyUserEvent(fields, ctx);
			return true;
		case "delete_user":
			await removeUserEvent(fields);
			return true;
		case "create_party":
		case "update_party":
			await applyDeptEvent(fields, ctx);
			return true;
		case "delete_party":
			// `deleted=1` 的唯一写入口（子部门一并标记，见 org.ts::markDeleted）
			await markDeleted(ORIGIN, requireField(fields, "Id", "change_contact"), { now: ctx.now });
			return true;
		default:
			return false;
	}
}

/**
 * 成员新增/变更。事件自带姓名与部门，但**不带排序、不带在职状态**，代开发形态甚至只有一个
 * `UserID`——所以统一回源 `user/get` 拿全量快照；拿不到（无通讯录权限/不在可见范围/上游抖）
 * 才退回事件自带字段，缺的字段不写（`undefined` 与 `null` 在 applyMemberDetail 里语义不同）。
 */
async function applyUserEvent(fields: CallbackFields, ctx: CorpCtx): Promise<void> {
	const userid = requireField(fields, "UserID", "change_contact");
	// userid 变更与建档是两件事：先把旧行改名（同一行），再按新号补资料
	const newUserid = field(fields, "NewUserID");
	if (newUserid && newUserid !== userid)
		await renameUser(userid, newUserid);
	const target = newUserid || userid;

	const detail = await ctx.client.userDetail(ctx.corpId, ctx.agentId, ctx.secret, target);
	const eventName = field(fields, "Name").trim();
	const uid = await upsertSourceUser({
		username: externalUsername(target),
		displayName: detail?.name?.trim() || eventName || null,
		source: ORIGIN,
		corpId: ctx.corpId,
	});
	// activated 不置位：建档 ≠ 用过本站（§9.1 的通讯录目录只收登录过的人）
	await applyMemberDetail({ uid, userid: target }, detail ?? memberFromEvent(fields), { now: ctx.now });
}

/**
 * userid 变更 = **同一行的改名**，不是新建（方案 §6.1）：否则旧号残留，而旧号还能登录。
 *
 * 新号已有本地行时**不合并**，抛给上层记一笔放弃：两行合并是「谁是真身」的判断题
 * （角色、历史操作、文件归属都在旧行上），交给全量同步与人工，不在回调的 1 秒窗口里赌。
 */
async function renameUser(fromUserid: string, toUserid: string): Promise<void> {
	const rows = await db.table("users").select(["id"]).where({ and: [
		{ field: "username", op: "eq", value: externalUsername(fromUserid) },
		{ field: "source", op: "eq", value: ORIGIN },
	] }).all() as Array<{ id: number }>;
	if (!rows.length)
		return; // 旧号没建过档（全量同步还没跑到）：按新号走建档即可
	const taken = await db.table("users").select(["id"]).where({ field: "username", op: "eq", value: externalUsername(toUserid) }).all();
	if (taken.length)
		throw new Error("新 userid 已有本地账号，跳过改名（交给全量同步/人工处理）");
	const uid = Number(rows[0]!.id);
	await db.table("users").update({ username: externalUsername(toUserid) }).where({ field: "id", op: "eq", value: uid }).run();
	await revokeSessions(uid);
}

/**
 * 退出企业：**不删账号**（审计、角色、历史引用都挂在 `users.id` 上），只把外部状态置 5 并摘掉
 * 部门关联；`is_forbidden` 一律不动（那是本站管理员的手动启停，不能被 IdP 覆盖）。
 *
 * 保留期结束后的匿名化要靠定时清扫（方案 §9.3，D 阶段才有调度器）：现在写一个「删除」只会
 * 得到一行立即过期的数据，所以这里刻意不做。
 */
async function removeUserEvent(fields: CallbackFields): Promise<void> {
	const userid = requireField(fields, "UserID", "change_contact");
	const rows = await db.table("users").select(["id"]).where({ and: [
		{ field: "username", op: "eq", value: externalUsername(userid) },
		{ field: "source", op: "eq", value: ORIGIN },
	] }).all() as Array<{ id: number }>;
	if (!rows.length)
		return; // 没建过档就没什么可摘，等下一轮全量
	const uid = Number(rows[0]!.id);
	await db.tx(async (t) => {
		await t.table("sys_dept_member").where({ field: "user_id", op: "eq", value: uid }).delete().run();
		await t.table("users").update({ external_status: 5 }).where({ field: "id", op: "eq", value: uid }).run();
	});
	await revokeSessions(uid);
}

/**
 * 部门新增/变更。
 *
 * 父级有**三态**，判断顺序不能换：上游详情 > 事件自带 `ParentId` > 保持本地现值。
 * 最关键的是第三态——事件与上游都没给父级时**绝不能写成 null**，那会把整棵子树拍平到根，
 * 而企微的 `ParentId` 为空串时既可能表示「根部门」也可能表示「这条报文没带」，光看值分不出来，
 * 所以只在确认上游详情拿到时才敢按空处理（详情里的空就是根）。
 */
async function applyDeptEvent(fields: CallbackFields, ctx: CorpCtx): Promise<void> {
	const originId = requireField(fields, "Id", "change_contact");
	let detail: WecomDept | null = null;
	try {
		detail = await ctx.client.departmentDetail(ctx.corpId, ctx.agentId, ctx.secret, originId);
	}
	catch (e) {
		// 无权限/不在可见范围是常态：退回事件自带字段，再不行就只改名字
		log.warn("wecom dept detail skipped", "originId", originId, "reason", (e as Error).message);
	}

	const local = await localDept(originId);
	let name: string | null = detail?.name ?? null;
	if (!name)
		name = field(fields, "Name").trim() || local?.name || null;
	if (!name)
		throw new Error("部门事件既没有名字、本地也没有这一行：不建无名部门");

	let parentLocal: number | null = local?.parentId ?? null;
	if (detail)
		parentLocal = detail.parentId ? await localDeptId(detail.parentId) : null;
	else if (fields.values.has("parentid"))
		parentLocal = field(fields, "ParentId") ? await localDeptId(field(fields, "ParentId")) : null;

	await upsertDepartment({
		origin: ORIGIN,
		originId,
		parentId: parentLocal,
		name,
		orderNo: detail?.order ?? Number(field(fields, "Order") || 0),
	}, { now: ctx.now });
}

/**
 * 事件自带的成员字段。代开发形态只有 UserID，这里会退化成「只建档、不写组织关系」——
 * 那没关系：下一次全量同步会把该有的都补上，而事件本来只是加速器。
 */
function memberFromEvent(fields: CallbackFields): MemberDetail {
	const main = Number(field(fields, "MainDepartment"));
	const position = field(fields, "Position").trim();
	return {
		name: field(fields, "Name").trim() || null,
		// 空串 = 这条报文没给：不写（否则会把已知职务清成 null）
		position: position || undefined,
		status: undefined,
		departments: splitIds(field(fields, "Department")),
		orders: [],
		leaderInDept: splitIds(field(fields, "IsLeaderInDept")).map(v => Number(v)),
		mainDepartment: Number.isFinite(main) && main > 0 ? main : null,
	};
}

/** 多值字段分隔符：企微用 `|`；逗号一并认，免得哪天换格式时静默只取到第一个 */
function splitIds(raw: string): string[] {
	return raw.split(/[|,]/).map(s => s.trim()).filter(Boolean);
}

async function localDept(originId: string): Promise<{ id: number, parentId: number | null, name: string | null } | null> {
	const rows = await db.table("sys_department").select(["id", "parent_id", "name"]).where({ and: [
		{ field: "origin", op: "eq", value: ORIGIN },
		{ field: "origin_id", op: "eq", value: originId },
	] }).all() as Array<{ id: number, parent_id: number | null, name: string | null }>;
	const r = rows[0];
	return r ? { id: Number(r.id), parentId: r.parent_id == null ? null : Number(r.parent_id), name: r.name } : null;
}

async function localDeptId(originId: string): Promise<number | null> {
	const row = await localDept(originId);
	return row ? row.id : null;
}

/** 删该用户全部 refresh 记录（与 session.ts::revokeAll 同语义，这里不构造 session 免得带进登录依赖） */
async function revokeSessions(uid: number): Promise<void> {
	await db.table("sys_refresh_token").where({ field: "user_id", op: "eq", value: uid }).delete().run();
}
