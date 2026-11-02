// BDD：RBAC 六表 + users 扩展列的迁移契约（验收锚点 AC1-7 的数据面；
// 设计文档 D10/§5.9.2）。夹具重放真实迁移，本 spec 即「迁移与表结构不漂移」的钉子。
import { beforeAll, describe, expect, it } from "vitest";

import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;

function colsOf(table: string) {
	return (dbo.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string, notnull: number, dflt_value: unknown }>).map(c => c.name);
}

beforeAll(() => {
	dbo = installDb();
});

describe("sys_* RBAC 表（设计文档 §5.9.2）", () => {
	it.each([
		"sys_setting",
		"sys_oplog",
		"sys_solution_route",
		"sys_role",
		"sys_permission",
		"sys_role_permission",
		"sys_user_role",
	])("迁移建出 %s", (table) => {
		expect(colsOf(table).length).toBeGreaterThan(0);
	});

	it("sys_role / sys_permission 带 deprecated 列（升级稳定性 §5 的地基）", () => {
		expect(colsOf("sys_role")).toContain("deprecated");
		expect(colsOf("sys_permission")).toContain("deprecated");
	});

	it("sys_user_role 复合主键 (user_id, role_name)", () => {
		const pk = dbo.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('sys_user_role') WHERE pk > 0").get() as { n: number };
		expect(Number(pk.n)).toBe(2);
	});

	it("sys_oplog 带 (create_time, id) 索引", () => {
		const idx = dbo.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='sys_oplog'").all() as Array<{ name: string, sql: string | null }>;
		const time = idx.find(i => i.sql?.includes("create_time"));
		expect(time).toBeDefined();
		expect(time?.sql).toContain("id");
	});
});

describe("users 表扩展（PRD §4.2 数据模型）", () => {
	it("新增 source / display_name 列", () => {
		expect(colsOf("users")).toContain("source");
		expect(colsOf("users")).toContain("display_name");
	});

	it("移除 users.roles JSON 列（D10：sys_user_role 为唯一权威源）", () => {
		expect(colsOf("users")).not.toContain("roles");
	});

	it("source 默认 local（外来号来源标记的默认值）", () => {
		const info = dbo.prepare("PRAGMA table_info(users)").all() as Array<{ name: string, dflt_value: unknown }>;
		const source = info.find(c => c.name === "source");
		expect(String(source?.dflt_value)).toContain("local");
	});
});

// 回归：0017 给 users 加工号列。事故形态是「列进了库、schema.yaml 白名单漏了」，
// 构造器在发 SQL 前就拒成 `unknown column 'employee_no' in on 'users'`，日志里没有 SQL 可查。
// 白名单那半边在 packages/cli/src/__tests__/templates-schema-columns.test.ts 钉；
// 这里钉库侧语义：列真的落库、租户内唯一、NULL 不占位、跨租户可重复。
describe("users.employee_no（0017 工号列）", () => {
	function addUser(username: string, tenant: string, employeeNo: string | null) {
		dbo.prepare("INSERT INTO users (username, password_hash, tenant_id, employee_no) VALUES (?, 'x', ?, ?)")
			.run(username, tenant, employeeNo);
	}

	it("迁移落出 employee_no 列", () => {
		expect(colsOf("users")).toContain("employee_no");
	});

	it("唯一索引按 (tenant_id, employee_no) 且是部分索引（NULL 不占位）", () => {
		const idx = dbo.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uk_users_employee_no'").get() as { sql: string | null } | undefined;
		expect(idx?.sql).toContain("tenant_id");
		expect(idx?.sql).toContain("employee_no IS NOT NULL");
	});

	it("同租户工号重复被拒，跨租户可重复，NULL 可多行", () => {
		addUser("eno-a", "acme", "E-100");
		expect(() => addUser("eno-b", "acme", "E-100")).toThrow(/UNIQUE/);
		expect(() => addUser("eno-c", "globex", "E-100")).not.toThrow();
		expect(() => addUser("eno-d", "acme", null)).not.toThrow();
		expect(() => addUser("eno-e", "acme", null)).not.toThrow();
	});
});
