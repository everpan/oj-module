// 通讯录读模型（D9：users 即通讯录；AC1-22~25）。
// 目录红线：只出 id/username/display_name——不含 email/avatar/roles（防低权账号拖走全员邮箱喂钓鱼，安全评审 P2）；
// 详情端点才给 email/avatar。默认排除 is_forbidden=1（AC1-23：管理域仍可见，目录与管理分离）。
// keyword≥2、LIKE 转义复用 query.ts；solutions 同 isolate import searchContacts 直调，无 HTTP 往返（AC1-25）。
import { likePattern } from "./query";

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
	return await db.query(
		`select id, username, display_name from users
		 where is_forbidden = 0 and (username like ? escape '!' or display_name like ? escape '!')
		 order by username limit ?`,
		[pattern, pattern, limit],
	) as ContactRow[];
}

export async function contactDetail(id: number): Promise<Record<string, unknown>> {
	const rows = await db.query(
		"select id, username, display_name, email, avatar_base64 from users where id = ? and is_forbidden = 0",
		[id],
	);
	if (!rows[0])
		throw Object.assign(new Error("contact not found"), { status: 404 });
	return rows[0] as Record<string, unknown>;
}
