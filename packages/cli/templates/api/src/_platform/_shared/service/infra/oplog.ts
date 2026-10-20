// 操作日志查询（AC1-29/D13：admin 可查；读操作不记审计的红线不适用——本表本身就是审计）。
// 过滤维度：action 精确 / username 包含 / module 精确；分页复用 query.ts 的 pagedFactory（构造器工厂）。
import { pagedFactory } from "./query";

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
	// 构造器（v0.1.82）：可选过滤走 whereIf，条件写一份（mk 工厂），count + list 复用；
	// username 走语义 op contains（引擎转义 %/_/!，等价旧 LIKE ? ESCAPE '!' 的 %kw%）。
	// 照抄口径：devkit scenarios 场景 42 ④。
	// 注意 whereIf 的跳过集是 undefined/null/false/[]——**"" 是合法值会保留**（api-manual
	// §1153），故缺失值必须归一化为 undefined（不能图省事用 ""，否则会发射 `action = ''`
	// 把结果过滤空——与旧 if (filter.x) 的「假值整条跳过」语义相悖）。
	const action = filter.action ? String(filter.action) : undefined;
	const module = filter.module ? String(filter.module) : undefined;
	const username = filter.username ? String(filter.username) : undefined;
	const mk = () => db.table("sys_oplog")
		.whereIf(action, { field: "action", op: "eq", value: action })
		.whereIf(module, { field: "module", op: "eq", value: module })
		.whereIf(username, { field: "username", op: "contains", value: username });
	const r = await pagedFactory<OplogRow>(mk, { size: filter.limit });
	return { list: r.list, total: r.total, truncated: r.truncated };
}
