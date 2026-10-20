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
	table: DBInstance["table"]
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
	// UNION 结果列名取首分支（userQ）=> 位置 4 名为 is_read。按人项此处即存储整数列；
	// 广播项此处实际承载回执 read_time（非空即已读，与原始 SQL 的 (read_time IS NOT NULL AND <> '') 等价）。
	const isRead = isBroadcast
		? (r.is_read != null && String(r.is_read) !== "")
		: Number(r.is_read) === 1;
	return {
		id: (isBroadcast ? "b:" : "u:") + String(r.id),
		scope: isBroadcast ? "broadcast" : "user",
		avatar: String(r.avatar ?? ""),
		date: String(r.date ?? ""),
		isRead,
		message: String(r.message ?? ""),
		title: String(r.title ?? ""),
		link: r.link == null ? undefined : String(r.link),
		category: (r.category as NoticeCategory) ?? "notice",
	};
}

/** 给指定用户推一条按人通知，返回命名空间 id "u:<id>" */
export async function pushNotice(input: PushInput): Promise<string> {
	const ins = await db.table("notifications").insert({
		user_id: Number(input.userId),
		avatar: input.avatar ?? "",
		date: nowStr(),
		is_read: 0,
		message: input.message,
		title: input.title,
		link: input.link ?? null,
		category: input.category ?? "notice",
	}).returning(["id"]).run() as Array<{ id: number }>;
	return `u:${Number(ins[0]!.id)}`;
}

/** 广播一条通知（全员可见，一行存储），返回命名空间 id "b:<id>" */
export async function pushBroadcastNotice(input: PushBroadcastInput): Promise<string> {
	const ins = await db.table("notifications_broadcast").insert({
		avatar: input.avatar ?? "",
		date: nowStr(),
		message: input.message,
		title: input.title,
		link: input.link ?? null,
		category: input.category ?? "notice",
		create_time: nowStr(),
	}).returning(["id"]).run() as Array<{ id: number }>;
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
		await db.table("notifications_broadcast_read")
			.where({ field: "broadcast_id", op: "eq", value: Number(raw) })
			.where({ field: "user_id", op: "eq", value: uid })
			.delete()
			.run();
		return true;
	}
	const n = await db.table("notifications")
		.where({ field: "id", op: "eq", value: Number(raw) })
		.where({ field: "user_id", op: "eq", value: uid })
		.delete()
		.run() as number;
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
	// 构造器（v0.1.81）：UNION ALL 合并「按人」与「广播(LEFT JOIN 回执)」；lit 打固定 scope 标记列，
	// 顶层 orderBy/limit/offset 跨方言一致。
	// 注意：UNION 结果列名取首分支(userQ)，故两分支位置对齐即可——广播第 4 列取回执 read_time，
	// 经 union 落到 is_read 列名下，是否「已读」由 mapItem 据非空推导（与原始 SQL 同源）。
	const userQ = db.table("notifications").select([
		"id",
		"avatar",
		"date",
		"is_read",
		"message",
		"title",
		"link",
		"category",
		{ lit: "user", as: "scope" },
	]).where({ field: "user_id", op: "eq", value: uid });
	const broadcastQ = db.table("notifications_broadcast").as("b").join("notifications_broadcast_read", [
		{ left: "b.id", right: "r.broadcast_id" },
		{ left: "r.user_id", op: "eq", value: uid },
	], "left", "r").select([
		"b.id",
		"b.avatar",
		"b.date",
		"r.read_time",
		"b.message",
		"b.title",
		"b.link",
		"b.category",
		{ lit: "broadcast", as: "scope" },
	]);
	const rows = await userQ.union(broadcastQ, "all")
		.orderBy([{ field: "date", dir: "desc" }])
		.limit(limit)
		.offset(offset)
		.all();
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
		// 构造器（v0.1.81）：orIgnore 幂等写入（sqlite/pg → ON CONFLICT DO NOTHING；mysql → ON DUPLICATE KEY UPDATE pk=pk）。
		await db.table("notifications_broadcast_read")
			.insert({ broadcast_id: Number(raw), user_id: uid, read_time: now })
			.orIgnore()
			.run();
		return true;
	}
	const n = await db.table("notifications")
		.where({ field: "id", op: "eq", value: Number(raw) })
		.where({ field: "user_id", op: "eq", value: uid })
		.update({ is_read: 1 })
		.run() as number;
	return n > 0;
}

/** 全部已读：按人项全置位 + 广播回执全 upsert */
export async function markAllRead(userId: string | number): Promise<void> {
	const uid = Number(userId);
	const now = nowStr();
	await db.table("notifications").where({ field: "user_id", op: "eq", value: uid }).update({ is_read: 1 }).run();
	// 保留 db.exec：INSERT OR IGNORE ... SELECT 在 sqlite 上构造器无法表达——
	// oj 0.1.81 的 orIgnore 仅跟随 VALUES 的 upsert 子句，不与 fromSelect(SELECT 源) 组合
	// （实测：code 500 "orIgnore with fromSelect is not supported on sqlite"）。原 SQL 三方言通用
	// （sqlite OR IGNORE / pg ON CONFLICT DO NOTHING / mysql ON DUPLICATE KEY），退回裸 SQL。
	await db.exec(
		"INSERT OR IGNORE INTO notifications_broadcast_read (broadcast_id, user_id, read_time) SELECT id, ?, ? FROM notifications_broadcast",
		[uid, now],
	);
}

/** 清空：删按人项 + 删本人广播回执（列表消失） */
export async function clearNotices(userId: string | number): Promise<void> {
	const uid = Number(userId);
	await db.table("notifications").where({ field: "user_id", op: "eq", value: uid }).delete().run();
	await db.table("notifications_broadcast_read").where({ field: "user_id", op: "eq", value: uid }).delete().run();
}
