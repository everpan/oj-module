// 通讯录读模型（D9：users 即通讯录；AC1-22~25）。
// 目录红线：只出 id/username/display_name——不含 email/avatar/roles（防低权账号拖走全员邮箱喂钓鱼，安全评审 P2）；
// 详情端点才给 email/avatar。默认排除 is_forbidden=1（AC1-23：管理域仍可见，目录与管理分离）。
// keyword≥2、LIKE 转义复用 query.ts；solutions 同 isolate import searchContacts 直调，无 HTTP 往返（AC1-25）。
import { likePattern } from "../infra/query";

export interface ContactRow {
	id: number
	username: string
	display_name: string | null
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;

export async function searchContacts(keyword: unknown, opts: { limit?: unknown } = {}): Promise<ContactRow[]> {
	const pattern = likePattern(keyword); // <2 字符在此抛 400（AC1-22）
	const rawLimit = Number.parseInt(String(opts.limit ?? ""), 10);
	const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(MAX_LIMIT, rawLimit) : DEFAULT_LIMIT;
	// 保留 db.query：模糊搜索需 ESCAPE '!'(构造器 like 无 escape 子句；mysql 默认 sql_mode 下 ESCAPE '\' 即 1064)
	return await db.query(
		`select id, username, display_name from users
		 where is_forbidden = 0 and (username like ? escape '!' or display_name like ? escape '!')
		 order by username limit ?`,
		[pattern, pattern, limit],
	) as unknown as ContactRow[];
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
