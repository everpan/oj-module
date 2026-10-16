// 操作日志查询（AC1-29/D13：admin 可查；读操作不记审计的红线不适用——本表本身就是审计）。
// 过滤维度：action 精确 / username 前缀 / module 精确；分页复用 query.ts（limit 钳 200/truncated）。
import { likePattern, paged } from "./query";

export interface OplogRow {
	id: number
	create_time: number
	user_id: number
	username: string
	action: string
	module: string
	version: string | null
	target: string | null
	detail: string | null
	level: number
}

export interface OplogPage {
	list: OplogRow[]
	total: number
	truncated: boolean
}

export async function searchOplog(filter: { action?: unknown, username?: unknown, module?: unknown, limit?: unknown }): Promise<OplogPage> {
	const conds: string[] = [];
	const params: unknown[] = [];
	if (filter.action) {
		conds.push("action = ?");
		params.push(String(filter.action));
	}
	if (filter.module) {
		conds.push("module = ?");
		params.push(String(filter.module));
	}
	if (filter.username) {
		conds.push("username like ? escape '!'");
		params.push(likePattern(filter.username));
	}
	const where = conds.length ? `where ${conds.join(" and ")}` : "";
	const r = await paged<OplogRow>(
		`select * from sys_oplog ${where} order by id desc`,
		`select count(*) as c from sys_oplog ${where}`,
		params,
		{ size: filter.limit },
	);
	return { list: r.list, total: r.total, truncated: r.truncated };
}
