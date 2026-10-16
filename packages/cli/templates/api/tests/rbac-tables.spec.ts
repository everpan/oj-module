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
