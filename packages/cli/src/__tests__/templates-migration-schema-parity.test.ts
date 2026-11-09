import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * BDD：迁移里的建表语句与 schema.yaml / manifest.yaml 三处一致。
 *
 * 为什么要这条：oj 的 SQL 构造器在发 SQL 前先按 schema.yaml 校验列名，多一列少一列都是
 * 端点 500 或「列不存在」的假象；而 manifest.yaml 的 tables 才是模块装载时的表清单。
 * 历史演进靠迁移叠加，结构漂移往往就藏在最后一条 ALTER 里，属于最难靠人眼发现的一类。
 *
 * 2026-11 把 _platform 的 0001–0018（45 个文件）压平成一条基线后，原先靠
 * templates-schema-columns 的 `ALTER ADD COLUMN` 校验对 _platform 直接失效（基线里没有
 * ALTER）——本用例补的就是这个缺口，且覆盖面从「只查新增列」扩大到「整表逐列 + 三方言」。
 *
 * S006 纪律：结构只进 migrations。故本用例不解析 seed.sql。
 */

const templatesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");
const apiRoot = join(templatesRoot, "src", "app", "api");

/**
 * 表级约束行。注意不能简单地按首词判 KEY——`key TEXT PRIMARY KEY` 里的 key 是**列名**
 * （sys_setting 的历史遗留，mysql 侧写作 `key`），按首词判会把它当约束整行丢掉。
 */
const CONSTRAINT_PATTERNS = [
	/^UNIQUE\b/i,
	/^PRIMARY\s+KEY\b/i,
	/^CONSTRAINT\b/i,
	/^FOREIGN\s+KEY\b/i,
	/^CHECK\s*\(/i,
	/^INDEX\s/i,
	/^KEY\s+[`"\w]+\s*\(/i,
];

function isConstraintLine(segment: string): boolean {
	return CONSTRAINT_PATTERNS.some(re => re.test(segment));
}

/** 由 oj 自建自管的 journal，结构不归任何模块的迁移管 */
const OJ_OWNED_TABLES = new Set(["_oj_migrations"]);

interface TableDecl {
	tenant?: boolean
	columns?: Record<string, unknown>
}

function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir))
		return out;
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory())
			walk(full, out);
		else
			out.push(full);
	}
	return out;
}

function modulesWithApi(): string[] {
	return readdirSync(apiRoot).filter((name) => {
		const full = join(apiRoot, name);
		return statSync(full).isDirectory() && existsSync(join(full, "manifest.yaml"));
	});
}

/**
 * 按「方言覆盖文件必胜、通用文件兜底」的装配规则取某方言实际执行的迁移序列。
 * 覆盖是**按版本号**替换，不是追加：0002__tenant.mysql.sql 存在时，0002__tenant.sql 不执行。
 */
function migrationsFor(module: string, dialect: "base" | "mysql" | "pg"): string[] {
	const dir = join(apiRoot, module, "migrations");
	if (!existsSync(dir))
		return [];

	const base = new Map<string, string>();
	const override = new Map<string, string>();

	for (const f of readdirSync(dir).filter(name => name.endsWith(".sql"))) {
		const seq = f.slice(0, 4);
		if (f.endsWith(".mysql.sql")) {
			if (dialect === "mysql")
				override.set(seq, join(dir, f));
		}
		else if (f.endsWith(".pg.sql")) {
			if (dialect === "pg")
				override.set(seq, join(dir, f));
		}
		else {
			base.set(seq, join(dir, f));
		}
	}

	return [...new Set([...base.keys(), ...override.keys()])]
		.sort()
		.map(seq => override.get(seq) ?? base.get(seq)!);
}

function hasDialectOverrides(module: string, dialect: "mysql" | "pg"): boolean {
	const dir = join(apiRoot, module, "migrations");
	return existsSync(dir) && readdirSync(dir).some(f => f.endsWith(`.${dialect}.sql`));
}

/** 只留可执行语句：`--` 行注释里的示例语法不算方言违规 */
function executableSql(sql: string): string {
	return sql.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
}

/**
 * 各方言必须拒绝的 SQLite 专有写法。命中任意一条，该方言在真库上必然语法错
 * （2026-11-05 演练实踩：home 0001 只写 sqlite 版，MySQL 报 1064 AUTOINCREMENT）。
 * `CREATE INDEX IF NOT EXISTS` 在 pg 合法，故只列 mysql。
 */
const DIALECT_ONLY_SQLITE: Record<"mysql" | "pg", RegExp[]> = {
	mysql: [/\bAUTOINCREMENT\b/i, /\bINSERT\s+OR\s+IGNORE\b/i, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i],
	pg: [/\bAUTOINCREMENT\b/i, /\bINSERT\s+OR\s+IGNORE\b/i],
};

/** `INSERT [OR IGNORE|IGNORE] INTO <表>` 按表计数（剥注释，避免注释里的示例语句算数） */
function insertCountsByTable(sql: string): Map<string, number> {
	const out = new Map<string, number>();
	const re = /\bINSERT\s+(?:OR\s+IGNORE\s+|IGNORE\s+)?INTO\s+([`"\w]+)/gi;
	for (const m of executableSql(sql).matchAll(re)) {
		const table = m[1].replace(/[`"]/g, "");
		out.set(table, (out.get(table) ?? 0) + 1);
	}
	return out;
}

/** 模板内所有 `seed*.sql`（跳过依赖与产物目录），返回相对模板根的路径 */
function seedSqlFiles(): string[] {
	const out: string[] = [];
	const skip = new Set(["node_modules", "dist", "compress-cache", "logs", ".git"]);
	const visit = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			if (skip.has(entry))
				continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory())
				visit(full);
			else if (/^seed.*\.sql$/i.test(entry))
				out.push(relative(templatesRoot, full));
		}
	};
	visit(templatesRoot);
	return out;
}

/**
 * mysql 保留字里最容易被当成列名的一批。不求穷举——目标是把「裸 key」这类**必然 1064**
 * 的写法挡在模板里，而不是当 SQL 解析器（真语法错误由真库演练兜底）。
 */
const MYSQL_RESERVED = new Set([
	"key",
	"group",
	"order",
	"desc",
	"index",
	"rank",
	"range",
	"system",
	"interval",
	"condition",
	"references",
	"usage",
	"values",
	"table",
]);

/** `INSERT ... (列清单)` 里裸写的保留字（反引号 / 双引号包起来的合法，跳过） */
function bareReservedColumns(sql: string): string[] {
	const hits: string[] = [];
	const re = /\bINSERT\s+(?:OR\s+IGNORE\s+|IGNORE\s+)?INTO\s+[`"\w]+\s*\(([^)]*)\)/gi;
	for (const m of executableSql(sql).matchAll(re)) {
		for (const raw of m[1].split(",")) {
			const col = raw.trim();
			if (!col || col.startsWith("`") || col.startsWith("\""))
				continue;
			const name = col.split(".").pop()!.replace(/\W/g, "").toLowerCase();
			if (MYSQL_RESERVED.has(name))
				hits.push(col);
		}
	}
	return hits;
}

/** 解析单文件里的 `CREATE TABLE` → 表 → 列 → 首词类型（去掉引号与长度参数） */
function columnTypes(file: string): Map<string, Map<string, string>> {
	const out = new Map<string, Map<string, string>>();
	const sql = readFileSync(file, "utf-8");
	for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\w]+)\s*\(([\s\S]*?)\)\s*(?:ENGINE|;)/gi)) {
		const table = m[1].replace(/[`"]/g, "");
		const cols = new Map<string, string>();
		for (const raw of m[2].split("\n")) {
			const line = raw.trim().replace(/,$/, "");
			if (!line || line.startsWith("--") || isConstraintLine(line))
				continue;
			const [, name, type] = line.match(/^([`"\w]+)\s+([a-z]+)/i) ?? [];
			if (name && type)
				cols.set(name.replace(/[`"]/g, "").toLowerCase(), type.toUpperCase());
		}
		out.set(table, cols);
	}
	return out;
}

/** seed 装配规则：`seed.<dialect>.sql` 存在则必胜，否则回落 `seed.sql` */function seedFor(module: string, dialect: "base" | "mysql" | "pg"): string | null {
	const dir = join(apiRoot, module);
	if (dialect !== "base") {
		const override = join(dir, `seed.${dialect}.sql`);
		if (existsSync(override))
			return override;
	}
	const base = join(dir, "seed.sql");
	return existsSync(base) ? base : null;
}

/** 取出 `CREATE TABLE <name> ( ... )` 的 (表名, 列名集合)，能处理引号与嵌套括号 */
function parseCreateTables(sql: string): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\w]+)\s*\(/gi;
	for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
		const rawName = m[1].replace(/[`"]/g, "");
		const start = re.lastIndex;
		let depth = 1;
		let i = start;
		while (i < sql.length && depth > 0) {
			const ch = sql[i];
			if (ch === "(")
				depth++;
			else if (ch === ")")
				depth--;
			i++;
		}
		const body = sql.slice(start, i - 1);
		out.set(rawName, parseColumns(body));
	}
	return out;
}

/** 顶层逗号切分（忽略括号内逗号），取每段的首个标识符为列名 */
function parseColumns(body: string): Set<string> {
	const cols = new Set<string>();
	let depth = 0;
	let start = 0;
	const segments: string[] = [];
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === "(") {
			depth++;
		}
		else if (ch === ")") {
			depth--;
		}
		else if (ch === "," && depth === 0) {
			segments.push(body.slice(start, i));
			start = i + 1;
		}
	}
	segments.push(body.slice(start));

	for (const raw of segments) {
		// 去掉行注释再取首词
		const seg = raw
			.split("\n")
			.filter(line => !line.trim().startsWith("--"))
			.join(" ")
			.trim();
		if (seg === "" || isConstraintLine(seg))
			continue;
		cols.add(seg.split(/\s+/)[0].replace(/[`"]/g, "").toLowerCase());
	}
	return cols;
}

const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"\w]+)\s*;/gi;
/** ADD UNIQUE KEY / ADD CONSTRAINT 等是加约束不是加列，不能误判成名为 unique/constraint 的列 */
const ADD_COLUMN_RE = /ALTER\s+TABLE\s+([`"\w]+)\s+ADD\s+(?!(?:UNIQUE|CONSTRAINT|PRIMARY|INDEX|KEY|FOREIGN|FULLTEXT|SPATIAL|CHECK)\b)(?:COLUMN\s+)?([`"\w]+)/gi;

/**
 * 按文件序累积出「跑完这些迁移后的表 → 列集」。
 * 覆盖三种演进形态：整表 CREATE、DROP 后重建、ALTER ADD COLUMN（历史模块的常态）。
 * 压平后的 _platform 只有第一种，正是本文件要守的那一类。
 */
function effectiveSchema(files: string[]): Map<string, Set<string>> {
	const tables = new Map<string, Set<string>>();

	for (const file of files) {
		const sql = readFileSync(file, "utf-8");

		for (const m of sql.matchAll(DROP_TABLE_RE))
			tables.delete(m[1].replace(/[`"]/g, ""));

		for (const [table, cols] of parseCreateTables(sql))
			tables.set(table, cols);

		for (const m of sql.matchAll(ADD_COLUMN_RE)) {
			const table = m[1].replace(/[`"]/g, "");
			const column = m[2].replace(/[`"]/g, "").toLowerCase();
			if (!tables.has(table))
				tables.set(table, new Set());
			tables.get(table)!.add(column);
		}
	}

	return tables;
}

function loadSchemaTables(): Map<string, TableDecl> {
	const tables = new Map<string, TableDecl>();
	for (const file of walk(join(templatesRoot, "src")).filter(f => f.endsWith("schema.yaml"))) {
		const doc = parse(readFileSync(file, "utf-8")) as { tables?: Record<string, TableDecl> } | null;
		for (const [name, decl] of Object.entries(doc?.tables ?? {}))
			tables.set(name, decl);
	}
	return tables;
}

function loadManifestTables(module: string): string[] {
	const doc = parse(readFileSync(join(apiRoot, module, "manifest.yaml"), "utf-8")) as { tables?: string[] } | null;
	return doc?.tables ?? [];
}

describe("templates 迁移 ↔ schema.yaml / manifest.yaml 结构一致", () => {
	it("m-1 迁移落地后的列集与 schema.yaml 双向一致（多列 = 构造器拒查，少列 = 运行时缺列）", () => {
		const declared = loadSchemaTables();
		const violations: string[] = [];

		for (const module of modulesWithApi()) {
			const effective = effectiveSchema(migrationsFor(module, "base"));
			for (const [table, cols] of effective) {
				const where = `${module}/migrations`;
				const decl = declared.get(table);
				if (!decl) {
					violations.push(`${where}: 表 ${table} 未在任何 schema.yaml 声明`);
					continue;
				}
				const declaredCols = new Set(Object.keys(decl.columns ?? {}).map(c => c.toLowerCase()));
				for (const c of cols) {
					if (!declaredCols.has(c))
						violations.push(`${where}: ${table}.${c} 建了列但 schema.yaml 未声明`);
				}
				for (const c of declaredCols) {
					if (!cols.has(c))
						violations.push(`${where}: ${table}.${c} 在 schema.yaml 声明但迁移未建列`);
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("m-2 每个 manifest.yaml 声明的表都有建表语句（_oj_migrations 由 oj 自建自有，豁免）", () => {
		const violations: string[] = [];

		for (const module of modulesWithApi()) {
			const created = new Set(effectiveSchema(migrationsFor(module, "base")).keys());
			for (const table of loadManifestTables(module)) {
				if (OJ_OWNED_TABLES.has(table))
					continue;
				if (!created.has(table))
					violations.push(`${module}: manifest.yaml 声明了 ${table}，但该模块 migrations 里没有建表语句`);
			}
		}

		expect(violations).toEqual([]);
	});

	it("m-3 方言覆盖不得缺表（有方言文件时，基础迁移的每张表都要有方言版）", () => {
		const violations: string[] = [];

		for (const module of modulesWithApi()) {
			const baseTables = new Set(effectiveSchema(migrationsFor(module, "base")).keys());
			if (baseTables.size === 0)
				continue;

			for (const dialect of ["mysql", "pg"] as const) {
				const files = migrationsFor(module, dialect);
				// 整个模块没有方言覆盖是合法的：oj 用基础迁移兜底（home / notification 现状）
				if (!hasDialectOverrides(module, dialect))
					continue;

				const dialectTables = new Set(effectiveSchema(files).keys());
				for (const table of baseTables) {
					if (!dialectTables.has(table))
						violations.push(`${module}: 表 ${table} 缺 ${dialect} 方言建表语句`);
				}
				for (const table of dialectTables) {
					if (!baseTables.has(table))
						violations.push(`${module}: ${dialect} 方言建了基础迁移里不存在的表 ${table}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("m-4 方言覆盖的列集与 schema.yaml 一致（类型可方言化，列名不行）", () => {
		const declared = loadSchemaTables();
		const violations: string[] = [];

		for (const module of modulesWithApi()) {
			for (const dialect of ["mysql", "pg"] as const) {
				const files = migrationsFor(module, dialect);
				if (!hasDialectOverrides(module, dialect))
					continue;

				for (const [table, cols] of effectiveSchema(files)) {
					const decl = declared.get(table);
					if (!decl) {
						violations.push(`${module}/${dialect}: 表 ${table} 未在任何 schema.yaml 声明`);
						continue;
					}
					const declaredCols = new Set(Object.keys(decl.columns ?? {}).map(c => c.toLowerCase()));
					for (const c of cols) {
						if (!declaredCols.has(c))
							violations.push(`${module}/${dialect}: ${table}.${c} 建了列但 schema.yaml 未声明`);
					}
					for (const c of declaredCols) {
						if (!cols.has(c))
							violations.push(`${module}/${dialect}: ${table}.${c} 在 schema.yaml 声明但方言迁移未建列`);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("m-5 任一方言实际执行的迁移与 seed 不含该方言不支持的语法（方言覆盖须整条链路可执行）", () => {
		const violations: string[] = [];

		for (const module of modulesWithApi()) {
			for (const dialect of ["mysql", "pg"] as const) {
				const files = [...migrationsFor(module, dialect)];
				const seed = seedFor(module, dialect);
				if (seed)
					files.push(seed);

				for (const file of files) {
					const sql = executableSql(readFileSync(file, "utf-8"));
					for (const re of DIALECT_ONLY_SQLITE[dialect]) {
						if (re.test(sql))
							violations.push(`${module}/${dialect}: ${relative(apiRoot, file)} 含该方言不支持的语法 ${re}`);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("m-6 方言 seed 与基础 seed 覆盖同一批表、同样条数（漏段 = 部署面静默缺数据）", () => {
		const violations: string[] = [];

		for (const module of modulesWithApi()) {
			const baseSeed = seedFor(module, "base");
			if (!baseSeed)
				continue;
			const expected = insertCountsByTable(readFileSync(baseSeed, "utf-8"));

			for (const dialect of ["mysql", "pg"] as const) {
				const seed = seedFor(module, dialect);
				if (!seed || seed === baseSeed)
					continue;

				// seed 按 `;` 朴素切分：一行出现第二个终止符会切出孤立语句（如 `; ON CONFLICT DO NOTHING`）
				for (const [i, line] of readFileSync(seed, "utf-8").split("\n").entries()) {
					if (line.trim().startsWith("--"))
						continue;
					if ((line.match(/;/g) ?? []).length > 1)
						violations.push(`${module}/${dialect} seed: 第 ${i + 1} 行有多个语句终止符（拼接错会切出孤立语句）`);
				}

				const actual = insertCountsByTable(readFileSync(seed, "utf-8"));
				for (const table of new Set([...expected.keys(), ...actual.keys()])) {
					if ((expected.get(table) ?? 0) !== (actual.get(table) ?? 0)) {
						violations.push(
							`${module}/${dialect} seed: ${table} 基础 ${expected.get(table) ?? 0} 条 / 方言 ${actual.get(table) ?? 0} 条`,
						);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("m-7 _platform 基线的 BIGINT 时间列在 pg 不得收窄为 INTEGER（毫秒 epoch 超出 int32）", () => {
		const dir = join(apiRoot, "_platform", "migrations");
		const mysql = columnTypes(join(dir, "0001__baseline.mysql.sql"));
		const pg = columnTypes(join(dir, "0001__baseline.pg.sql"));
		// 只盯时间语义列：*_at / *_time / *_start / *_until（秒级与毫秒级 epoch 都要求 64 位）
		const TIME_COLUMN = /(?:^|_)(?:at|time|start|until)$/;
		const violations: string[] = [];

		for (const [table, cols] of mysql) {
			for (const [col, type] of cols) {
				if (type !== "BIGINT" || !TIME_COLUMN.test(col))
					continue;
				const pgType = pg.get(table)?.get(col);
				if (pgType && pgType !== "BIGINT")
					violations.push(`${table}.${col}: mysql=BIGINT / pg=${pgType}`);
			}
		}

		expect(violations).toEqual([]);
	});

	/**
	 * 2026-11-05 实踩：模板根曾有 `seed.mysql.sql` / `seed.pg.sql` 的旧副本——只有 4 条
	 * sys_setting（模块内真件 22 条），且 mysql 那份把保留字 `key` 裸写，照文档部署必
	 * `1064 near 'key, module, ...'`。它既不在 m-5/m-6 的扫描范围（只扫 `src/<模块>/`），
	 * 也没有任何执行路径天天跑它，坏了大半年没人发现。这条守卫钉两件事：
	 *   1) `seed*.sql` 只允许活在模块目录（根级/别处出现即违规，从源头禁掉第二份真源）；
	 *   2) mysql 方言件的 INSERT 列名里，保留字必须反引号（裸写 = 该方言必然语法错）。
	 */
	it("m-8 seed*.sql 只活在模块目录，且 mysql 保留字列必须反引号（根级副本会漂移）", () => {
		const misplaced = seedSqlFiles().filter((rel) => {
			return !rel.startsWith(join("src", "app", "api") + sep);
		});
		expect(misplaced).toEqual([]);

		const unescaped: string[] = [];
		for (const module of modulesWithApi()) {
			const file = join(apiRoot, module, "seed.mysql.sql");
			if (!existsSync(file))
				continue;
			for (const col of bareReservedColumns(readFileSync(file, "utf-8")))
				unescaped.push(`${module}/seed.mysql.sql: 列 ${col} 未转义`);
		}
		expect(unescaped).toEqual([]);

		// 反证：检测器对坏样本必须命中（否则这条守卫只是恒绿）
		expect(bareReservedColumns("INSERT IGNORE INTO t (key, module) VALUES ('a','b')")).toEqual(["key"]);
		expect(bareReservedColumns("INSERT IGNORE INTO t (`key`, module) VALUES ('a','b')")).toEqual([]);
	});
});
