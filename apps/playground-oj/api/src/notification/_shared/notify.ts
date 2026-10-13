// 跨模块通知发射原语（sample 后端实现，本地模块）。
//
// 设计文档 §4.3：「Sample 后端（实现）：api/src/_shared/notify.ts 用 db 直写两表，
// 是后端模块真正 import 的原语」。oj 只把 api/src 的【顶层】目录当作模块（须有 manifest.yaml），
// 故共享原语不能放 api/src/_shared（会被当成缺 manifest 的模块），须嵌进所属模块目录
// （此处嵌套在 notification/ 下）。后端解析裸 specifier 以 api/ 为项目根并钳制模块不越界
// （api-manual 第 5 章），原语用相对导入、不能 import 来自 @oj-module/runtime 的包
// （符号链接指向 packages/runtime，越出项目根）。
//
// 语义：原语不做任何业务判断（不判空间/角色/可见性），收件人过滤是发送方责任。
// 按人通知落 notifications（user_id 必填）；广播落 notifications_broadcast（一行），
// 已读状态走 notifications_broadcast_read 回执表，避免广播按人 fan-out 的信息爆炸。
//
// 类型与 runtime 的 @oj-module/runtime/notify 保持同形（前端契约面复用 runtime 类型）；
// 此处本地定义以避免后端 import 越界。两处形状变更需同步。

export type NoticeCategory = "notice" | "pm" | "mention";

export interface NoticeItem {
	id: string
	scope: "user" | "broadcast"
	avatar: string
	date: string
	isRead?: boolean
	message: string
	title: string
	link?: string
	category?: NoticeCategory
}

export interface PushInput {
	userId: string | number
	title: string
	message: string
	link?: string
	avatar?: string
	category?: NoticeCategory
}

export interface PushBroadcastInput {
	title: string
	message: string
	link?: string
	avatar?: string
	category?: NoticeCategory
}

interface Row {
	[k: string]: unknown
}
interface NotifyDb {
	query: (sql: string, params?: unknown[]) => Promise<Row[]>
	exec: (sql: string, params?: unknown[]) => Promise<number>
}
declare const db: NotifyDb;

function nowStr(): string {
	return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function splitId(id: string): [scope: "u" | "b", raw: string] {
	const i = id.indexOf(":");
	if (i < 0)
		return ["u", id];
	return [id.slice(0, i) === "b" ? "b" : "u", id.slice(i + 1)];
}

function mapItem(r: Row): NoticeItem {
	const scope = String(r.scope);
	const isBroadcast = scope === "broadcast";
	return {
		id: (isBroadcast ? "b:" : "u:") + String(r.id),
		scope: isBroadcast ? "broadcast" : "user",
		avatar: String(r.avatar ?? ""),
		date: String(r.date ?? ""),
		isRead: Number(r.is_read) === 1,
		message: String(r.message ?? ""),
		title: String(r.title ?? ""),
		link: r.link == null ? undefined : String(r.link),
		category: (r.category as NoticeCategory) ?? "notice",
	};
}

/** 给指定用户推一条按人通知，返回命名空间 id "u:<id>" */
export async function pushNotice(input: PushInput): Promise<string> {
	const ins = await db.query(
		`INSERT INTO notifications (user_id, avatar, date, is_read, message, title, link, category)
		 VALUES (?, ?, ?, 0, ?, ?, ?, ?) RETURNING id`,
		[
			Number(input.userId),
			input.avatar ?? "",
			nowStr(),
			input.message,
			input.title,
			input.link ?? null,
			input.category ?? "notice",
		],
	);
	return `u:${Number(ins[0]!.id)}`;
}

/** 广播一条通知（全员可见，一行存储），返回命名空间 id "b:<id>" */
export async function pushBroadcastNotice(input: PushBroadcastInput): Promise<string> {
	const ins = await db.query(
		`INSERT INTO notifications_broadcast (avatar, date, message, title, link, category, create_time)
		 VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		[
			input.avatar ?? "",
			nowStr(),
			input.message,
			input.title,
			input.link ?? null,
			input.category ?? "notice",
			nowStr(),
		],
	);
	return `b:${Number(ins[0]!.id)}`;
}

/**
 * 删除通知。按人项校验归属：非本人返回 false；广播项仅删本人回执（幂等，返回 true）。
 * 返回是否成功操作到目标（调用方据 false 判 403）。
 */
export async function delNotice(id: string, userId: string | number): Promise<boolean> {
	const [scope, raw] = splitId(id);
	const uid = Number(userId);
	if (scope === "b") {
		await db.exec(
			"DELETE FROM notifications_broadcast_read WHERE broadcast_id = ? AND user_id = ?",
			[Number(raw), uid],
		);
		return true;
	}
	const n = await db.exec(
		"DELETE FROM notifications WHERE id = ? AND user_id = ?",
		[Number(raw), uid],
	);
	return n > 0;
}

/** 取某用户的合并通知列表（广播 LEFT JOIN 回执算 is_read UNION 按人），按时间倒序 */
export async function noticesFor(
	userId: string | number,
	opts: { offset?: number, limit?: number } = {},
): Promise<NoticeItem[]> {
	const limit = opts.limit ?? 50;
	const offset = opts.offset ?? 0;
	const uid = Number(userId);
	const rows = await db.query(
		`SELECT id, avatar, date, is_read, message, title, link, category, 'user' as scope
		   FROM notifications WHERE user_id = ?
		 UNION ALL
		 SELECT b.id, b.avatar, b.date, (r.read_time IS NOT NULL AND r.read_time <> '') as is_read,
		        b.message, b.title, b.link, b.category, 'broadcast' as scope
		   FROM notifications_broadcast b
		   LEFT JOIN notifications_broadcast_read r ON r.broadcast_id = b.id AND r.user_id = ?
		 ORDER BY date DESC
		 LIMIT ? OFFSET ?`,
		[uid, uid, limit, offset],
	);
	return rows.map(mapItem);
}

/**
 * 标记已读：按人项校验归属（非本人返回 false）；广播项 upsert 回执（始终 true）。
 * 返回是否命中目标（调用方据 false 判 403，与 delNotice 对称）。
 */
export async function markRead(id: string, userId: string | number): Promise<boolean> {
	const [scope, raw] = splitId(id);
	const uid = Number(userId);
	const now = nowStr();
	if (scope === "b") {
		await db.exec(
			"INSERT OR IGNORE INTO notifications_broadcast_read (broadcast_id, user_id, read_time) VALUES (?, ?, ?)",
			[Number(raw), uid, now],
		);
		return true;
	}
	const n = await db.exec("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", [Number(raw), uid]);
	return n > 0;
}

/** 全部已读：按人项全置位 + 广播回执全 upsert */
export async function markAllRead(userId: string | number): Promise<void> {
	const uid = Number(userId);
	const now = nowStr();
	await db.exec("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [uid]);
	await db.exec(
		"INSERT OR IGNORE INTO notifications_broadcast_read (broadcast_id, user_id, read_time) SELECT id, ?, ? FROM notifications_broadcast",
		[uid, now],
	);
}

/** 清空：删按人项 + 删本人广播回执（列表消失） */
export async function clearNotices(userId: string | number): Promise<void> {
	const uid = Number(userId);
	await db.exec("DELETE FROM notifications WHERE user_id = ?", [uid]);
	await db.exec("DELETE FROM notifications_broadcast_read WHERE user_id = ?", [uid]);
}
