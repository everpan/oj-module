// 通讯录读模型（D9：users 即通讯录；AC1-22~25）。
// 目录红线：只出 id/username/display_name——不含 email/avatar/roles（防低权账号拖走全员邮箱喂钓鱼，安全评审 P2）；
// 详情端点才给 email/avatar。默认排除 is_forbidden=1（AC1-23：管理域仍可见，目录与管理分离）。
// keyword≥2、LIKE 转义复用 query.ts；solutions 同 isolate import searchContacts 直调，无 HTTP 往返（AC1-25）。
export interface ContactRow {
	id: number
	username: string
	display_name: string | null
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;

export async function searchContacts(keyword: unknown, opts: { limit?: unknown } = {}): Promise<ContactRow[]> {
	// 长度红线（默认 2~64，越界 400）——与 query.ts likePattern 同口径；contains 自动转义 %/_/!，无需手写 ESCAPE。
	const kw = String(keyword ?? "").trim();
	if (kw.length < 2 || kw.length > 64)
		throw Object.assign(new Error(kw.length < 2 ? "keyword too short (min 2)" : "keyword too long (max 64)"), { status: 400 });
	const rawLimit = Number.parseInt(String(opts.limit ?? ""), 10);
	const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(MAX_LIMIT, rawLimit) : DEFAULT_LIMIT;
	// 构造器（v0.1.81）：模糊搜索走语义 op contains（自动转义 + 包 %），OR 用条件树 or，方言无关。
	return await db.table("users")
		.select(["id", "username", "display_name"])
		.where({ field: "is_forbidden", op: "eq", value: 0 })
		.where({ or: [
			{ field: "username", op: "contains", value: kw },
			{ field: "display_name", op: "contains", value: kw },
		] })
		.orderBy([{ field: "username", dir: "asc" }])
		.limit(limit)
		.all() as unknown as ContactRow[];
}

export async function contactDetail(id: number): Promise<Record<string, unknown>> {
	const rows = await db.table("users")
		.select(["id", "username", "display_name", "email", "avatar_base64"])
		.where({ field: "id", op: "eq", value: id })
		.where({ field: "is_forbidden", op: "eq", value: 0 })
		.all();
	if (!rows[0])
		throw Object.assign(new Error("contact not found"), { status: 404 });
	return rows[0] as Record<string, unknown>;
}
