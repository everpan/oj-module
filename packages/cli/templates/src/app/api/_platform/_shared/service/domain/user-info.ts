// 批量用户信息读面（_platform/users/info，登录即可）：ids → 完整展示信息。
// 与 web/user-info（当前登录用户单人）同字段口径，供解决方案模块一次取回多行所需的人名/头像等。
// 反 N+1：一次 users IN 查询 + 一次 sys_user_role IN 查询（均经 allRows 分页兜底隐式 limit）。
// 租户隔离：db.table 构造器按当前请求租户自动注入谓词，跨租户/已删 id 自然查不到、直接略过。
import { allRows } from "../infra/query";

export interface BatchUserInfo {
	id: number
	username: string
	displayName: string
	avatar: string
	email: string
	phoneNumber: string
	description: string
	roles: string[]
	mustChange: boolean
}

/** 端点单次 ids 硬上限（防枚举整份名册）：超限 400；runtime 侧按此值分块请求。 */
export const MAX_BATCH_IDS = 200;

/** 归一：去重、只留正整数；非法项静默丢弃（调用方无须先清洗）。 */
function normalizeIds(input: readonly unknown[]): number[] {
	const out: number[] = [];
	const seen = new Set<number>();
	for (const value of input) {
		const n = Number(value);
		if (!Number.isInteger(n) || n <= 0 || seen.has(n))
			continue;
		seen.add(n);
		out.push(n);
	}
	return out;
}

/**
 * ids → 用户完整展示信息。批量、定序、租户隔离。
 *
 * 定序按入参 ids 顺序返回，缺失 id 不占位（前端按 id 建 Map 即可）。
 */
export async function usersInfoByIds(input: readonly unknown[]): Promise<BatchUserInfo[]> {
	const ids = normalizeIds(input);
	if (!ids.length)
		return [];
	if (ids.length > MAX_BATCH_IDS)
		throw Object.assign(new Error(`too many ids (max ${MAX_BATCH_IDS})`), { status: 400 });

	const rows = await allRows<Record<string, unknown>>(() =>
		db.table("users")
			.select(["id", "username", "display_name", "avatar_base64", "email", "phone_number", "description", "must_change"])
			.where({ field: "id", op: "in", value: ids }),
	);
	if (!rows.length)
		return [];

	const roleRows = await allRows<{ user_id: number, role_name: string }>(() =>
		db.table("sys_user_role").select(["user_id", "role_name"]).where({ field: "user_id", op: "in", value: ids }),
	);
	const rolesByUser = new Map<number, string[]>();
	for (const r of roleRows)
		(rolesByUser.get(Number(r.user_id)) ?? rolesByUser.set(Number(r.user_id), []).get(Number(r.user_id)))!.push(String(r.role_name));

	const found = new Map(rows.map(r => [Number(r.id), r]));
	const out: BatchUserInfo[] = [];
	for (const id of ids) {
		const r = found.get(id);
		if (!r)
			continue;
		out.push({
			id,
			username: String(r.username),
			displayName: r.display_name == null ? "" : String(r.display_name),
			avatar: r.avatar_base64 == null ? "" : String(r.avatar_base64),
			email: r.email == null ? "" : String(r.email),
			phoneNumber: r.phone_number == null ? "" : String(r.phone_number),
			description: r.description == null ? "" : String(r.description),
			roles: rolesByUser.get(id) ?? [],
			mustChange: Number(r.must_change) === 1,
		});
	}
	return out;
}
