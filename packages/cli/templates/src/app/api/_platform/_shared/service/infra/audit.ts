// 审计出口（AC1-29）：recordOp 落 sys_oplog；auditOp fire-and-forget（失败静默，不阻断业务）；
// auditDeny 按 (user_id, code) 分钟窗口聚合——首条落表，窗口内只更新计数，1000 次循环不逐条落表。
// 反常识修正：oj 每请求重建模块实例，聚合窗口状态以 sys_oplog 自身为锚（分钟内最近一条同 (user,code)
// 的 auth.deny 行），进程内 Map 方案在真实运行时每请求恒为空、恒逐条落表（语义破坏已实测）。
// 脱敏红线：detail 由调用方保证不含口令/密钥/token（本层只做 JSON 序列化）。
import { moduleOf } from "./guard";

export interface OpEntry {
	/** 动作标识，点分：`role.create` / `user.roles.update`（C 区页面筛选项） */
	action: string
	/** 归属模块（sys_oplog.module；聚合/筛选用） */
	module: string
	version?: string
	/** 操作对象标识（角色名/用户名/方案名），可空 */
	target?: string
	/** 结构化明细；本层 JSON 序列化。脱敏红线：不得含口令/密钥/token */
	detail?: unknown
	/** syslog 级，默认 6(info)；403 拒绝为 4(warning) */
	level?: number
}

async function usernameOf(userId: number): Promise<string> {
	if (!userId)
		return "system";
	const rows = await db.table("users").select(["username"]).where({ field: "id", op: "eq", value: userId }).all();
	return rows[0] ? String(rows[0].username) : "unknown";
}

/** 同步落表。关键路径（如 A6 角色管理）直接 await；一般路径用 auditOp。 */
export async function recordOp(entry: OpEntry): Promise<void> {
	const uid = Number(http.user?.id ?? 0);
	await db.table("sys_oplog").insert({
		create_time: Date.now(),
		user_id: uid,
		username: await usernameOf(uid),
		action: entry.action,
		module: entry.module,
		version: entry.version ?? null,
		target: entry.target ?? null,
		detail: entry.detail == null ? null : JSON.stringify(entry.detail),
		level: entry.level ?? 6,
	}).run();
}

/** fire-and-forget：审计失败静默（写日志也失败的极端场景下，业务正确性优先）。 */
export function auditOp(entry: OpEntry): void {
	recordOp(entry).catch(() => {});
}

const DENY_WINDOW_MS = 60_000;
// 串行队列：把同请求内多次 auditDeny 的「查锚点行→更新/插入」串行化（AC1-29 同窗口只许一行首条）。
// 跨请求并发首条可能落两行（锚点查询非原子）——人去重后并发 403 同 (user,code) 极罕见，可容忍。
// ponytail: 模块级队列在 oj 每请求重建语义下只管得住单请求内，跨请求靠 DB 行自身作锚。
let denyQueue: Promise<void> = Promise.resolve();

/**
 * 403 失败审计入口（判权出口调用）：(user_id, code) 分钟窗口聚合，首条 + 计数。
 *  uid 在调用瞬间同步捕获——http.user 是可变全局，异步队列执行时再读会被后续请求覆盖。
 */
export function auditDeny(code: string): void {
	const uid = Number(http.user?.id ?? 0);
	denyQueue = denyQueue.then(() => recordDeny(uid, code)).catch(() => {});
}

/** 清窗口状态：窗口锚点即 sys_oplog 行本身——测试夹具/运维直接清表即重置，本函数仅为兼容既有调用面。 */
export function resetDenyAudit(): void {
	// no-op（状态在 DB；详见文件头反常识修正）
}

async function recordDeny(uid: number, code: string): Promise<void> {
	const now = Date.now();
	// 窗口锚点 = 分钟内最近一条同 (user, code) 的 auth.deny 行；命中只更新计数，否则落首条。
	const rows = await db.table("sys_oplog").select(["id", "detail"]).where({ field: "user_id", op: "eq", value: uid }).where({ field: "action", op: "eq", value: "auth.deny" }).where({ field: "target", op: "eq", value: code }).where({ field: "create_time", op: "gt", value: now - DENY_WINDOW_MS }).orderBy([{ field: "id", dir: "desc" }]).limit(1).all();
	const hit = rows[0] as { id: number, detail: string } | undefined;
	if (hit) {
		const count = (JSON.parse(hit.detail) as { count: number }).count + 1;
		await db.table("sys_oplog").update({ detail: JSON.stringify({ code, count }) }).where({ field: "id", op: "eq", value: hit.id }).run();
		return;
	}
	await db.table("sys_oplog").insert({
		create_time: now,
		user_id: uid,
		username: await usernameOf(uid),
		action: "auth.deny",
		module: moduleOf(code),
		target: code,
		detail: JSON.stringify({ code, count: 1 }),
		level: 4,
	}).run();
}
