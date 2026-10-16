// 审计出口（AC1-29）：recordOp 落 sys_oplog；auditOp fire-and-forget（失败静默，不阻断业务）；
// auditDeny 按 (user_id, code) 分钟窗口聚合——首条落表，窗口内只更新计数，1000 次循环不逐条落表。
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
	const rows = await db.query("select username from users where id = ?", [userId]);
	return rows[0] ? String(rows[0].username) : "unknown";
}

/** 同步落表。关键路径（如 A6 角色管理）直接 await；一般路径用 auditOp。 */
export async function recordOp(entry: OpEntry): Promise<void> {
	const uid = http.user?.id ?? 0;
	await db.exec(
		"insert into sys_oplog (create_time, user_id, username, action, module, version, target, detail, level) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		[
			Date.now(),
			uid,
			await usernameOf(uid),
			entry.action,
			entry.module,
			entry.version ?? null,
			entry.target ?? null,
			entry.detail == null ? null : JSON.stringify(entry.detail),
			entry.level ?? 6,
		],
	);
}

/** fire-and-forget：审计失败静默（写日志也失败的极端场景下，业务正确性优先）。 */
export function auditOp(entry: OpEntry): void {
	recordOp(entry).catch(() => {});
}

const DENY_WINDOW_MS = 60_000;
const denyWindows = new Map<string, { at: number, rowId: number, count: number }>();
// 串行队列：deny 审计的「查窗口→落首条→更新计数」必须原子，并发进入会产生多首条（AC1-29 语义破坏）
// ponytail: 进程内单队列；deny 频率低（人去重后），吞吐不敏感
let denyQueue: Promise<void> = Promise.resolve();

/**
 * 403 失败审计入口（判权出口调用）：(user_id, code) 分钟窗口聚合，首条 + 计数。
 *  uid 在调用瞬间同步捕获——http.user 是可变全局，异步队列执行时再读会被后续请求覆盖。
 */
export function auditDeny(code: string): void {
	const uid = http.user?.id ?? 0;
	denyQueue = denyQueue.then(() => recordDeny(uid, code)).catch(() => {});
}

/** 清窗口状态（测试夹具/运维排障用；与 DB 清表配套，防内存窗口指向已删行）。 */
export function resetDenyAudit(): void {
	denyWindows.clear();
}

async function recordDeny(uid: number, code: string): Promise<void> {
	const key = `${uid}:${code}`;
	const now = Date.now();
	const w = denyWindows.get(key);
	if (w && now - w.at < DENY_WINDOW_MS) {
		w.count += 1;
		await db.exec("update sys_oplog set detail = ? where id = ?", [JSON.stringify({ code, count: w.count }), w.rowId]);
		return;
	}
	const rows = await db.query(
		"insert into sys_oplog (create_time, user_id, username, action, module, target, detail, level) values (?, ?, ?, 'auth.deny', ?, ?, ?, 4) returning id",
		[now, uid, await usernameOf(uid), moduleOf(code), code, JSON.stringify({ code, count: 1 })],
	);
	denyWindows.set(key, { at: now, rowId: Number((rows[0] as { id: unknown }).id), count: 1 });
}
