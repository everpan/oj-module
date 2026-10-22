// 后端 BDD 夹具：node:sqlite 内存库 + **真实迁移文件**建表，装到 globalThis.db——
// 与 oj 运行时注入的全局同名同面，service 代码不改一行即可被测。
// 夹具直接读 src/<模块>/api/migrations/*.sql，与迁移不可能漂移（沿用 oj-wiki 先例）。
//
// **构造器垫片（db.table / listTables）**：oj 的构造器是二进制内的 Rust 实现，Node 侧无可复用
// 模块，故这里按手册契约（oj-api-dev api-manual「查询构造器」）写一层**最小 JS 渲染层**——
// 只覆盖模板后端真正用到的面：select（含聚合 / distinct / lit）/ as / join（列对列 + 列对值）/
// where / whereIf / groupBy / orderBy / limit / offset / union / insert（含 orIgnore、returning）/ update /
// delete / truncate / all / run / listTables。子集外的调用**直接报「未实现」**，不静默返回空结果
// （静默空值会把「垫片缺能力」伪装成「业务没数据」，是最难查的一类假绿）。
//
// 已知边界（模板当前用不到，不模拟）：租户/归属守卫（`tenant_id` 注入、`owner_of`）——模板是单租户，
// 开启多租户后本夹具必先补这两条，否则守卫失效也会绿。
//
// 分工不变：
//   · L2（本目录 *.spec.ts）：构造器渲染出**语义等价**的 SQL 后在真 sqlite 上跑——服务层行为、
//     参数化、AND 串联、IN/LIKE 转义、聚合分组、limit/offset 都在这一层钉。
//   · L1（同目录 *.test.ts，`oj test` 收集）：真 v8 + 真构造器，守 oj 的方言渲染（样板见
//     tests/l1-builder.test.ts；方法论见 devkit oj-test-guide.md）。
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { DatabaseSync } = req("node:sqlite");
const { readdirSync, readFileSync, existsSync } = req("node:fs");
const { join, dirname } = req("node:path");
const { fileURLToPath } = req("node:url");

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

export const ADMIN = 1;

/** 标识符加引号（保留字列名如 `order` / `group` / `count` 全按字面量处理；`表.列` 逐段加） */
function quoteIdent(name: string): string {
	return name.split(".").map(p => `"${p.replace(/"/g, "\"\"")}"`).join(".");
}

/** LIKE 转义符：与 oj 同口径（`!`），`contains`/`startswith`/`endswith` 自动转义 `%` `_` `!` */
const LIKE_ESCAPE = "!";

function escapeLike(value: string): string {
	return value.replace(/[!%_]/g, c => `${LIKE_ESCAPE}${c}`);
}

const COMPARE_OPS: Record<string, string> = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

interface Compiled { sql: string, params: unknown[] }

/** 条件树 → SQL 片段（叶子 {field, op, value}；组 {and}/{or}/{not}） */
function compileWhere(cond: any): Compiled {
	if (cond && typeof cond === "object" && "field" in cond) {
		const field = quoteIdent(String(cond.field));
		const op = String(cond.op ?? "eq").toLowerCase();
		const value = cond.value;
		if (op === "isnull")
			return { sql: `${field} IS NULL`, params: [] };
		if (op === "in") {
			const list = Array.isArray(value) ? value : [value];
			// 与 oj 同口径：空数组早抛（`IN ()` 是永久假谓词，静默 0 行与「无匹配」不可区分；
			// 动态过滤请走 whereIf，它会跳过空数组）
			if (list.length === 0)
				throw new Error("[fixture] in needs non-empty array");
			return { sql: `${field} IN (${list.map(() => "?").join(", ")})`, params: list };
		}
		if (op === "contains" || op === "startswith" || op === "endswith") {
			const escaped = escapeLike(String(value));
			const pattern = op === "contains" ? `%${escaped}%` : op === "startswith" ? `${escaped}%` : `%${escaped}`;
			return { sql: `${field} LIKE ? ESCAPE '${LIKE_ESCAPE}'`, params: [pattern] };
		}
		if (op === "like") {
			// `like` 的模式由调用方负责成形；`escape` 逃生舱（白名单 ! / | ~ # @）原样渲染
			const esc = cond.escape as string | undefined;
			return esc
				? { sql: `${field} LIKE ? ESCAPE '${esc}'`, params: [value] }
				: { sql: `${field} LIKE ?`, params: [value] };
		}
		const sqlOp = COMPARE_OPS[op];
		if (!sqlOp)
			throw new Error(`[fixture] db.table 的 where op 未实现：${op}`);
		return { sql: `${field} ${sqlOp} ?`, params: [value] };
	}
	if (cond && typeof cond === "object" && Array.isArray(cond.and)) {
		const parts = cond.and.map(compileWhere);
		return { sql: parts.map(p => `(${p.sql})`).join(" AND "), params: parts.flatMap(p => p.params) };
	}
	if (cond && typeof cond === "object" && Array.isArray(cond.or)) {
		const parts = cond.or.map(compileWhere);
		return { sql: parts.map(p => `(${p.sql})`).join(" OR "), params: parts.flatMap(p => p.params) };
	}
	if (cond && typeof cond === "object" && cond.not) {
		const part = compileWhere(cond.not);
		return { sql: `NOT (${part.sql})`, params: part.params };
	}
	throw new Error(`[fixture] db.table 的 where 条件形状未实现：${JSON.stringify(cond)}`);
}

interface SelectItem { fn?: string, field?: string, as?: string, distinct?: boolean, lit?: unknown }
type Col = string | SelectItem;

interface QueryState {
	table: string
	alias: string | null
	cols: Col[] | null
	distinct: boolean
	joins: Array<{ table: string, on: any[], kind: "inner" | "left", alias: string | null }>
	wheres: any[]
	having: any[]
	groups: string[]
	orders: Array<{ field: string, dir?: string | null }>
	limit: number | null
	offset: number | null
	verb: "select" | "insert" | "update" | "delete" | "truncate"
	values: unknown
	sets: unknown
	orIgnore: boolean
	returning: string[] | null
	union: { other: FakeQuery, kind: "all" | "distinct" } | null
}

/**
 * 最小构造器：命令式链式调用（每个方法返回自身，与 oj 的 builder 一致——业务代码里
 * `const q = db.table(...).where(...)` 后接 `q.union(...)` 的写法依赖这个语义）。
 */
class FakeQuery {
	private readonly s: QueryState;

	constructor(private readonly dbo: any, table: string, seed?: Partial<QueryState>) {
		this.s = {
			table,
			alias: null,
			cols: null,
			distinct: false,
			joins: [],
			wheres: [],
			having: [],
			groups: [],
			orders: [],
			limit: null,
			offset: null,
			verb: "select",
			values: null,
			sets: null,
			orIgnore: false,
			returning: null,
			union: null,
			...seed,
		};
	}

	/** 基表别名（列限定写 `b.col`；只影响 select/join 渲染） */
	as(alias: string): this {
		this.s.alias = alias;
		return this;
	}

	select(cols: Col[]): this {
		this.s.cols = cols;
		return this;
	}

	distinct(): this {
		this.s.distinct = true;
		return this;
	}

	join(table: string, on: any[], kind: "inner" | "left" = "inner", alias?: string): this {
		this.s.joins.push({ table, on, kind, alias: alias ?? null });
		return this;
	}

	where(cond: any): this {
		this.s.wheres.push(cond);
		return this;
	}

	/** 条件化 where：`undefined`/`null`/`false`/空数组整条跳过（`0` 与 `""` 是合法值，保留） */
	whereIf(test: unknown, cond: any): this {
		const skip = test === undefined || test === null || test === false || (Array.isArray(test) && test.length === 0);
		if (!skip)
			this.s.wheres.push(cond);
		return this;
	}

	having(cond: any): this {
		this.s.having.push(cond);
		return this;
	}

	groupBy(cols: string[]): this {
		this.s.groups.push(...cols);
		return this;
	}

	orderBy(items: Array<{ field: string, dir?: string | null }>): this {
		this.s.orders.push(...items);
		return this;
	}

	limit(n: number): this {
		this.s.limit = n;
		return this;
	}

	offset(n: number): this {
		this.s.offset = n;
		return this;
	}

	/** 合并两条 select（UNION [ALL]）；外层 orderBy/limit/offset 作用于合并结果 */
	union(other: FakeQuery, kind: "all" | "distinct" = "distinct"): this {
		this.s.union = { other, kind };
		return this;
	}

	insert(values: unknown): this {
		this.s.verb = "insert";
		this.s.values = values;
		return this;
	}

	update(sets: unknown): this {
		this.s.verb = "update";
		this.s.sets = sets;
		return this;
	}

	delete(): this {
		this.s.verb = "delete";
		return this;
	}

	truncate(): this {
		this.s.verb = "truncate";
		return this;
	}

	orIgnore(): this {
		this.s.orIgnore = true;
		return this;
	}

	/** insert 取回列（`run()` 改返回行数组，不返回行数）；select/update/delete 不接受 */
	returning(cols: string[]): this {
		if (this.s.verb !== "insert")
			throw new Error(`[fixture] ${this.s.verb} does not accept returning`);
		this.s.returning = cols;
		return this;
	}

	async all(): Promise<Array<Record<string, unknown>>> {
		const { sql, params } = this.compile();
		return this.dbo.prepare(sql).all(...params);
	}

	async run(): Promise<number | Array<Record<string, unknown>>> {
		const { sql, params } = this.compile();
		const stmt = this.dbo.prepare(sql);
		if (this.s.returning)
			return stmt.all(...params);
		return Number(stmt.run(...params).changes);
	}

	/** 编译成 {sql, params}（供 union 复用内层 select） */
	compile(inner = false): Compiled {
		const s = this.s;
		if (s.verb === "insert")
			return this.compileInsert();
		if (s.verb === "update")
			return this.compileUpdate();
		if (s.verb === "delete")
			return this.compileDelete();
		if (s.verb === "truncate")
			return { sql: `DELETE FROM ${quoteIdent(s.table)}`, params: [] };
		return this.compileSelect(inner);
	}

	private compileInsert(): Compiled {
		const rows = (Array.isArray(this.s.values) ? this.s.values : [this.s.values]) as Array<Record<string, unknown>>;
		if (rows.length === 0)
			throw new Error("[fixture] insert 至少需要一行");
		const cols = Object.keys(rows[0]!);
		for (const r of rows) {
			if (Object.keys(r).length !== cols.length)
				throw new Error("[fixture] insert 多行的键集必须一致");
		}
		const params: unknown[] = [];
		const tuple = `(${cols.map(() => "?").join(", ")})`;
		for (const r of rows)
			params.push(...cols.map(c => r[c]));
		const tail = this.s.returning ? ` RETURNING ${this.s.returning.map(quoteIdent).join(", ")}` : "";
		return {
			sql: `INSERT${this.s.orIgnore ? " OR IGNORE" : ""} INTO ${quoteIdent(this.s.table)} (${cols.map(quoteIdent).join(", ")}) VALUES ${rows.map(() => tuple).join(", ")}${tail}`,
			params,
		};
	}

	private compileUpdate(): Compiled {
		const sets = this.s.sets as Record<string, unknown>;
		const cols = Object.keys(sets);
		const params = cols.map(c => sets[c]);
		const where = this.compileWhereClause(params);
		return {
			sql: `UPDATE ${quoteIdent(this.s.table)} SET ${cols.map(c => `${quoteIdent(c)} = ?`).join(", ")}${where.sql}`,
			params: where.params,
		};
	}

	private compileDelete(): Compiled {
		const where = this.compileWhereClause([]);
		return { sql: `DELETE FROM ${quoteIdent(this.s.table)}${where.sql}`, params: where.params };
	}

	/** where 子句（追加进既有 params，返回拼接后的片段） */
	private compileWhereClause(params: unknown[]): Compiled {
		if (this.s.wheres.length === 0)
			return { sql: "", params };
		const parts = this.s.wheres.map(compileWhere);
		return {
			sql: ` WHERE ${parts.map(p => `(${p.sql})`).join(" AND ")}`,
			params: [...params, ...parts.flatMap(p => p.params)],
		};
	}

	private compileSelect(inner: boolean): Compiled {
		const s = this.s;
		const cols = this.compileCols();
		const params: unknown[] = cols.params;
		const from = `${quoteIdent(s.table)}${s.alias ? ` AS ${quoteIdent(s.alias)}` : ""}`;
		const joins = s.joins.map((j) => {
			const on = j.on.map((c) => {
				if (c && c.right !== undefined)
					return { sql: `${quoteIdent(String(c.left))} = ${quoteIdent(String(c.right))}`, params: [] };
				const sqlOp = COMPARE_OPS[String(c.op ?? "eq").toLowerCase()];
				if (!sqlOp)
					throw new Error(`[fixture] join ON 只支持比较类 op，收到：${c.op}`);
				return { sql: `${quoteIdent(String(c.left))} ${sqlOp} ?`, params: [c.value] };
			});
			params.push(...on.flatMap(o => o.params));
			return `${j.kind === "left" ? "LEFT JOIN" : "JOIN"} ${quoteIdent(j.table)}${j.alias ? ` AS ${quoteIdent(j.alias)}` : ""} ON ${on.map(o => o.sql).join(" AND ")}`;
		});
		const where = this.compileWhereClause(params);
		let sql = `SELECT ${s.distinct ? "DISTINCT " : ""}${cols.sql} FROM ${from}${joins.length ? ` ${joins.join(" ")}` : ""}${where.sql}`;
		let allParams = where.params;
		if (s.groups.length) {
			sql += ` GROUP BY ${s.groups.map(quoteIdent).join(", ")}`;
			if (s.having.length) {
				const hv = this.s.having.map(compileWhere);
				sql += ` HAVING ${hv.map(h => `(${h.sql})`).join(" AND ")}`;
				allParams = [...allParams, ...hv.flatMap(h => h.params)];
			}
		}
		if (s.union) {
			const left = s.union.kind === "all" ? " UNION ALL " : " UNION ";
			const right = s.union.other.compile(true);
			sql = `(${sql})${left}(${right.sql})`;
			allParams = [...allParams, ...right.params];
		}
		if (!inner) {
			if (s.orders.length)
				sql += ` ORDER BY ${s.orders.map(o => `${quoteIdent(o.field)}${o.dir === "desc" ? " DESC" : o.dir === "asc" ? " ASC" : ""}`).join(", ")}`;
			if (s.limit !== null)
				sql += ` LIMIT ${Number(s.limit)}`;
			if (s.offset !== null)
				sql += ` OFFSET ${Number(s.offset)}`;
		}
		return { sql, params: allParams };
	}

	private compileCols(): Compiled {
		const cols = this.s.cols;
		if (!cols || cols.length === 0)
			return { sql: "*", params: [] };
		const params: unknown[] = [];
		const parts = cols.map((c) => {
			if (typeof c === "string")
				return c === "*" ? "*" : quoteIdent(c);
			if (c.lit !== undefined) {
				params.push(c.lit);
				return c.as ? `? AS ${quoteIdent(c.as)}` : "?";
			}
			if (!c.fn)
				throw new Error(`[fixture] select 列形状未实现：${JSON.stringify(c)}`);
			const inner = `${c.distinct && c.fn === "count" ? "DISTINCT " : ""}${c.field ? quoteIdent(c.field) : "*"}`;
			return `${c.fn.toUpperCase()}(${inner})${c.as ? ` AS ${quoteIdent(c.as)}` : ""}`;
		});
		return { sql: parts.join(", "), params };
	}
}

/** listTables：sqlite_master 自省（排除 `sqlite_*` 内部表，前缀按字面量匹配） */
const SQL_LIST_TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'";

function listTables(dbo: any, prefix?: string): string[] {
	const sql = `${SQL_LIST_TABLES}${prefix ? ` AND name LIKE ? ESCAPE '${LIKE_ESCAPE}'` : ""} ORDER BY name`;
	const stmt = dbo.prepare(sql);
	const rows = (prefix ? stmt.all(`${escapeLike(prefix)}%`) : stmt.all()) as Array<{ name: string }>;
	return rows.map(r => r.name);
}

/** 建内存库 + 注入全局；返回 DatabaseSync 供用例直插数据/断言。 */
export function installDb(): any {
	const dbo = new DatabaseSync(":memory:");
	// 重放 src 下全部模块的迁移（方言专属文件除外）
	for (const mod of readdirSync(SRC)) {
		const dir = join(SRC, mod, "api", "migrations");
		if (!existsSync(dir))
			continue;
		for (const f of readdirSync(dir).filter((f: string) => f.endsWith(".sql") && !/\.(?:mysql|pg)\.sql$/.test(f)).sort())
			dbo.exec(readFileSync(join(dir, f), "utf8"));
	}

	dbo.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, 'x')").run(ADMIN, "admin");

	const query = async (sql: string, params: unknown[] = []) => dbo.prepare(sql).all(...(params as never[]));
	const exec = async (sql: string, params: unknown[] = []) => Number(dbo.prepare(sql).run(...(params as never[])).changes);
	const table = (name: string) => new FakeQuery(dbo, name);
	const txInstance = { query, exec, table, listTables: (prefix?: string) => listTables(dbo, prefix), isTx: true };
	// db.tx 镜像运行时面：BEGIN/COMMIT/ROLLBACK 包裹回调（versions.ts 注释同语义）
	const tx = async (fn: (t: typeof txInstance) => unknown) => {
		dbo.exec("BEGIN");
		try {
			const r = await fn(txInstance);
			dbo.exec("COMMIT");
			return r;
		}
		catch (e) {
			dbo.exec("ROLLBACK");
			throw e;
		}
	};

	const g = globalThis as any;
	g.db = { query, exec, tx, table, listTables: (prefix?: string) => listTables(dbo, prefix), dialect: () => "sqlite" };
	return dbo;
}
