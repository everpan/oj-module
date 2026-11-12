import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * BDD：模板后端「迁移落库的列」必须在所属模块 schema.yaml 的列白名单里声明。
 *
 * 为什么要这条：oj 的 SQL 构造器是二进制内的 Rust 实现，select/insert/update 的列会**先**按
 * schema.yaml 校验，列在库里但不在白名单时，SQL 还没发就被拒成
 * `unknown column 'x' in <site>`（site 随语句位置变：join on / insert values / update sets …）。
 * 线上表现是端点 500、日志里没有 SQL，看起来像「列不存在」，实际是声明漏了。
 *
 * 真实事故（2026-11）：_platform 0017 加了 users.employee_no，schema.yaml 漏声明，
 * /system/departments（选人列表依赖 /system/users）整页 500。
 *
 * 校验面取 `ALTER TABLE … ADD COLUMN`：已有表新增列的唯一入口，也是最容易「只写迁移、
 * 忘了补声明」的一类。整表声明由 t-2（租户定性）与表数快照兜底。
 */

const templatesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");
const srcRoot = join(templatesRoot, "src");

interface ColumnDecl {
	type?: string
	[key: string]: unknown
}

interface SchemaDoc {
	tables?: Record<string, { columns?: Record<string, ColumnDecl> }>
}

/** `ALTER TABLE <表> ADD [COLUMN] <列>`（忽略方言专属文件，sqlite 基础件是唯一真相） */
const ADD_COLUMN_RE = /ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+ADD\s+(?:COLUMN\s+)?[`"']?(\w+)[`"']?/gi;

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory())
			walk(full, out);
		else
			out.push(full);
	}
	return out;
}

/** 表名 → 声明的列集合（跨模块同名表由 templates-tenant-scope 的 S002 断言拦，这里取并集） */
function loadDeclaredColumns(files: string[]): Map<string, Set<string>> {
	const declared = new Map<string, Set<string>>();
	for (const file of files.filter(f => f.endsWith("schema.yaml"))) {
		const doc = parse(readFileSync(file, "utf-8")) as SchemaDoc | null;
		for (const [table, decl] of Object.entries(doc?.tables ?? {}))
			declared.set(table, new Set(Object.keys(decl.columns ?? {})));
	}
	return declared;
}

/** 基础迁移文件：`migrations/*.sql`，排除 `<名>.mysql.sql` / `<名>.pg.sql` */
function isBaseMigration(file: string): boolean {
	return /[/\\]migrations[/\\][^/\\]+\.sql$/.test(file) && !/\.(?:mysql|pg)\.sql$/.test(file);
}

describe("templates 后端 schema.yaml 列白名单", () => {
	it("s-1 迁移里 ADD COLUMN 的列都在 schema.yaml 有声明（漏声明 = 构造器拒查）", () => {
		const files = walk(srcRoot);
		const declared = loadDeclaredColumns(files);
		const violations: string[] = [];

		for (const file of files.filter(isBaseMigration)) {
			for (const m of readFileSync(file, "utf-8").matchAll(ADD_COLUMN_RE)) {
				const [, table, column] = m;
				const where = relative(templatesRoot, file);
				const cols = declared.get(table);
				if (!cols) {
					violations.push(`${where}: 表 ${table} 未在任何 schema.yaml 声明`);
					continue;
				}
				if (!cols.has(column)) {
					violations.push(
						`${where}: ${table}.${column} 未在 schema.yaml 声明`
						+ `（构造器会拒为 unknown column '${column}' in on '${table}'；补到 owning 模块的 tables.${table}.columns）`,
					);
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("s-2 回归锚点：_platform 基线为 0001、增量 0002（发布历史）/ 0003（市场目录扩列）/ 0004（退役 reg_source_seq）/ 0005（sig_registry_id）/ 0006（avatar_base64 扩容 MEDIUMTEXT）/ 0007（机器人凭据三表）/ 0008（服务凭据过期列）/ 0009（服务凭据状态列）三方言齐备，且基线里确有 users.employee_no", () => {
		const migDir = join(srcRoot, "app", "api", "_platform", "migrations");
		for (const file of [
			"0001__baseline.sql",
			"0001__baseline.mysql.sql",
			"0001__baseline.pg.sql",
			"0002__market_release.sql",
			"0002__market_release.mysql.sql",
			"0002__market_release.pg.sql",
			"0003__market_catalog.sql",
			"0003__market_catalog.mysql.sql",
			"0003__market_catalog.pg.sql",
			"0004__market_drop_source_seq.sql",
			"0004__market_drop_source_seq.mysql.sql",
			"0004__market_drop_source_seq.pg.sql",
			"0005__market_sig_registry.sql",
			"0005__market_sig_registry.mysql.sql",
			"0005__market_sig_registry.pg.sql",
			"0006__avatar_mediumtext.sql",
			"0006__avatar_mediumtext.mysql.sql",
			"0006__avatar_mediumtext.pg.sql",
			"0007__mcp_svc_tables.sql",
			"0007__mcp_svc_tables.mysql.sql",
			"0007__mcp_svc_tables.pg.sql",
			"0008__svc_token_expires.sql",
			"0008__svc_token_expires.mysql.sql",
			"0008__svc_token_expires.pg.sql",
			"0009__svc_token_status.sql",
			"0009__svc_token_status.mysql.sql",
			"0009__svc_token_status.pg.sql",
		])
			expect(existsSync(join(migDir, file)), `缺迁移 ${file}`).toBe(true);

		// 0001 是压平后的结构基线，已应用过的库不会重跑——新增结构只能追加新序号，
		// 不得回改基线（否则老库拿不到）。序号必须从 0001 起连续、无空洞。
		const seqs = [...new Set(readdirSync(migDir).map(f => f.slice(0, 4)))].sort();
		expect(seqs).toEqual(["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"]);

		const schema = parse(readFileSync(join(srcRoot, "app", "api", "_platform", "schema.yaml"), "utf-8")) as SchemaDoc;
		expect(schema.tables?.users?.columns?.employee_no).toMatchObject({ type: "text" });
		expect(readFileSync(join(migDir, "0001__baseline.sql"), "utf-8")).toContain("employee_no");
	});
});
