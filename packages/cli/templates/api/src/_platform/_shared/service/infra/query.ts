// 查询工具（DRY 收敛，AC1-22/24）：全部列表接口复用——
// paged：limit 钳 200（静默）、truncated 标记（offset+list.length < total）、count+list 双查询；
// likePattern：keyword 长度红线（默认 2~64，越界 400）、LIKE 元字符转义（ESCAPE '!' 三方言同语义）。
// 错误约定与判权出口一致：Error & { status }。

export interface PageResult<T> {
	list: T[]
	total: number
	page: number
	size: number
	/** 还有未返回数据（AC1-24：多取一条判截断） */
	truncated: boolean
}

const MAX_SIZE = 200;
const DEFAULT_SIZE = 20;

function pageArgs(input: { page?: unknown, size?: unknown }): { page: number, size: number, offset: number } {
	const rawPage = Number.parseInt(String(input.page ?? ""), 10);
	const rawSize = Number.parseInt(String(input.size ?? ""), 10);
	const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
	// 非法/<1 回落默认 20，再钳上限 200（AC1-24 静默钳制）
	const size = Math.min(MAX_SIZE, Number.isFinite(rawSize) && rawSize >= 1 ? rawSize : DEFAULT_SIZE);
	return { page, size, offset: (page - 1) * size };
}

/** 双查询分页：listSql/countSql 共用 params（调用方同一 WHERE），limit/offset 参数化（三方言安全）。 */
export async function paged<T>(
	listSql: string,
	countSql: string,
	params: unknown[],
	input: { page?: unknown, size?: unknown },
): Promise<PageResult<T>> {
	const { page, size, offset } = pageArgs(input);
	const total = Number((await db.query(countSql, params) as Array<Record<string, unknown>>)[0]?.c ?? 0);
	const list = await db.query(`${listSql} limit ? offset ?`, [...params, size, offset]) as T[];
	return { list, total, page, size, truncated: offset + list.length < total };
}

// 构造器分页工厂（v0.1.82）：条件写一份（mk 工厂），count + list 各跑一次（count 用聚合，
// 不受 LIMIT 钳制）；替代「接受任意 SQL 片段」的旧 paged（裸 SQL 包装器）。条件收敛到构造器
// （contains 替代 LIKE ? ESCAPE '!'），残留任意 SQL 的场景才继续走旧 paged。
type Builder = ReturnType<typeof db.table>;
export async function pagedFactory<T>(
	mk: () => Builder,
	input: { page?: unknown, size?: unknown } = {},
): Promise<PageResult<T>> {
	const { page, size, offset } = pageArgs(input);
	const total = Number(
		(await mk().select([{ fn: "count", as: "c" }]).all() as Array<Record<string, unknown>>)[0]?.c ?? 0,
	);
	const list = total === 0
		? []
		: await mk().orderBy([{ field: "id", dir: "desc" }]).limit(size).offset(offset).all() as T[];
	return { list, total, page, size, truncated: total > page * size };
}

/**
 * LIKE 模式：修剪后校验长度（默认 2~64），元字符 % _ ! 加 ! 转义，两侧包 %。
 *  SQL 侧必须写 `like ? escape '!'`（三方言同语义；sqlite 默认无转义符，mysql/pg 默认不是 !）。
 */
export function likePattern(keyword: unknown, opts: { minLen?: number, maxLen?: number } = {}): string {
	const kw = String(keyword ?? "").trim();
	const min = opts.minLen ?? 2;
	const max = opts.maxLen ?? 64;
	if (kw.length < min)
		throw Object.assign(new Error(`keyword too short (min ${min})`), { status: 400 });
	if (kw.length > max)
		throw Object.assign(new Error(`keyword too long (max ${max})`), { status: 400 });
	return `%${kw.replace(/[!%_]/g, m => `!${m}`)}%`;
}
