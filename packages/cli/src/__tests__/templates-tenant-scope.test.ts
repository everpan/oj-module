import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * BDD：模板工程的租户定性表与 oj 的 `sql_guard` 装配规则一致（企微代开发 v3 Phase 0）。
 *
 * oj 在 `tenant.sql_guard != Off` 时对 schema.yaml 声明的每张表强制二选一：
 *   A 租户表 —— 必须有 `tenant_id` 列（text/integer/bigint），构造器查询自动注入；
 *   B 共享表 —— schema.yaml `tenant: false` **且** config `tenant.shared_allow` 列出，双声明才豁免。
 * 两者缺一：serve 启动 / `oj build` / `oj migrate` 三处 fail-fast。
 *
 * 本用例把这个隐式约定固化成可跑的断言，防的是两类真实事故：
 *   1. 新加表忘了定性 → 上线即拒启；
 *   2. 标了 `tenant: false` 却漏进 shared_allow（或反之）→ 声明被静默忽略，表被当租户表，守卫全拒。
 */

const templatesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");

interface ColumnDecl {
	type?: string
	null?: boolean
	[key: string]: unknown
}

interface TableDecl {
	tenant?: boolean
	pk?: string | string[]
	columns?: Record<string, ColumnDecl>
}

const TENANT_COLUMN_TYPES = new Set(["text", "integer", "bigint"]);

function collectSchemaFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory())
			collectSchemaFiles(full, out);
		else if (entry === "schema.yaml")
			out.push(full);
	}
	return out;
}

interface Loaded {
	/** 表名 → 声明（跨模块同名表会撞，oj 侧 S002 拒启，这里同样断言唯一） */
	tables: Map<string, TableDecl>
}

function loadSchemaTables(): Loaded {
	const tables = new Map<string, TableDecl>();
	for (const file of collectSchemaFiles(join(templatesRoot, "src"))) {
		const doc = parse(readFileSync(file, "utf-8")) as { tables?: Record<string, TableDecl> } | null;
		for (const [name, decl] of Object.entries(doc?.tables ?? {})) {
			if (tables.has(name))
				throw new Error(`表 ${name} 被两个模块 schema.yaml 重复声明（${file}）`);
			tables.set(name, decl);
		}
	}
	return { tables };
}

function loadTenantConfig(): {
	enable?: boolean
	sql_guard?: string | boolean
	shared_allow?: string[]
	allow_as_tenant?: boolean
	anonymous_paths?: unknown[]
} {
	const doc = parse(readFileSync(join(templatesRoot, "config.yaml"), "utf-8")) as { tenant?: Record<string, unknown> };
	return (doc.tenant ?? {}) as never;
}

describe("templates 租户定性（A 租户表 / B 共享表）", () => {
	it("t-1 config 已开启多租户且守卫为 deny", () => {
		const tenant = loadTenantConfig();
		expect(tenant.enable).toBe(true);
		expect(tenant.sql_guard).toBe("deny");
		expect(tenant.allow_as_tenant).toBe(true);
	});

	it("t-2 每张表二选一：有 tenant_id 列，或 tenant:false + shared_allow 双声明", () => {
		const { tables } = loadSchemaTables();
		const sharedAllow = new Set(loadTenantConfig().shared_allow ?? []);
		const violations: string[] = [];

		for (const [name, decl] of tables) {
			const shared = decl.tenant === false;
			const tenantColumn = decl.columns?.tenant_id;

			if (shared) {
				if (!sharedAllow.has(name))
					violations.push(`${name}: 标了 tenant:false 但不在 config tenant.shared_allow（声明会被忽略）`);
				if (tenantColumn)
					violations.push(`${name}: 既标 tenant:false 又声明 tenant_id 列（自相矛盾）`);
				continue;
			}

			if (!tenantColumn) {
				violations.push(`${name}: 无 tenant_id 列且未标 tenant:false（sql_guard 非 Off 时启动即拒）`);
				continue;
			}
			if (!TENANT_COLUMN_TYPES.has(String(tenantColumn.type)))
				violations.push(`${name}.tenant_id 类型 ${String(tenantColumn.type)} 不合法（只能是 text/integer/bigint）`);
		}

		expect(violations).toEqual([]);
	});

	it("t-3 shared_allow 不含未声明的表名（拼写错误会让豁免静默失效）", () => {
		const { tables } = loadSchemaTables();
		const unknown = (loadTenantConfig().shared_allow ?? []).filter(name => !tables.has(name));
		expect(unknown).toEqual([]);
	});

	it("t-4 21 张表的 A/B 分组与方案 v3 §5.2 一致（新增表须先定性）", () => {
		const { tables } = loadSchemaTables();
		const shared = [...tables].filter(([, d]) => d.tenant === false).map(([n]) => n).sort();
		expect(tables.size).toBe(21);
		expect(shared).toEqual([
			"_oj_migrations",
			"market_history",
			"reg_source_seq",
			"sys_login_throttle",
			"sys_permission",
			"sys_rate_window",
			"sys_role",
			"sys_role_permission",
			"sys_setting",
			"sys_solution_route",
		]);
	});
});
