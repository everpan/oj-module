// BDD：注册步骤（P1-8，十阶段 stage registering，D10 唯一出口）。
// 安装 = registerSolution 一次性把方案声明的 RBAC/设置/路由 upsert 进宿主库：
// sys_role/sys_permission 经 upsertSolutionPerms 出口（AC2-1~6），sys_setting/sys_solution_route
// 在本步收敛；声明消失 → 行保留标 deprecated=1（镜像 solution-perms），管理员改过的
// value 永不被声明覆写（AC1-15 同纪律）。DB 级路由占用检查承接 P1-5 备案③（首段比较）。
// queryRegistered 归一化快照（过滤 deprecated）供 P1-9 冒烟对账；auditOp 落 solution.register。
// 夹具即真实库：真实迁移建表（0010 重构 sys_solution_route + sys_setting 补 deprecated）。
/* eslint-disable test/prefer-lowercase-title -- 任务/AC 编号是验收锚点，保留大写（DB/P1-5） */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { checkOccupancy, queryAllRegistered, queryRegistered, registerSolution } from "../../src/_platform/_lifecycle/steps/register";
import { installDb } from "../fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

beforeAll(() => {
	dbo = installDb();
	g.http = {}; // 安装器系统侧：无 http 会话 → audit username='system'
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM sys_role_permission");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM sys_permission");
	dbo.exec("DELETE FROM sys_role");
	dbo.exec("DELETE FROM sys_solution_route");
	dbo.exec("DELETE FROM sys_setting");
	dbo.exec("DELETE FROM sys_oplog");
});

function rows(sql: string) {
	return dbo.prepare(sql).all() as Record<string, unknown>[];
}

function counts() {
	const c = (t: string) => Number((rows(`SELECT COUNT(*) AS n FROM ${t}`)[0]).n);
	return { role: c("sys_role"), perm: c("sys_permission"), setting: c("sys_setting"), route: c("sys_solution_route") };
}

/** wiki 1.0.0 声明切片：两角色一（含两权限点）、两设置项、两路由 */
const WIKI_V1 = {
	module: "wiki",
	version: "1.0.0",
	roles: [
		{ name: "wiki.admin", title: "管理员", permissions: ["wiki.doc.create", "wiki.space.create"] },
	],
	settings: [
		{ key: "wiki.home.page", group: "wiki", type: "string", default_value: "start", label_key: "wiki:settings.home" },
		{ key: "wiki.readonly", group: "wiki", type: "bool", default_value: "0" },
	],
	routes: [
		{ path: "/wiki/docs", category: "main", order: 200, title_key: "wiki:menu.docs" },
		{ path: "/wiki/admin", category: "admin", order: 300, title_key: "wiki:menu.admin", required_permission: "wiki.doc.create" },
	],
};

describe("注册后四表行存在", () => {
	it("注册一次落齐 sys_role/sys_permission/sys_setting/sys_solution_route，deprecated 为空", async () => {
		const r = await registerSolution(WIKI_V1);
		expect(r.ok).toBe(true);
		expect(r.deprecated).toEqual([]);
		expect(rows("SELECT * FROM sys_role WHERE name = 'wiki.admin'")).toHaveLength(1);
		expect(rows("SELECT * FROM sys_permission")).toHaveLength(2);
		const setting = rows("SELECT * FROM sys_setting WHERE key = 'wiki.home.page'")[0];
		expect(setting.value).toBe("start"); // 首装 value = default_value
		expect(setting.module).toBe("wiki");
		expect(setting.label_key).toBe("wiki:settings.home");
		const route = rows("SELECT * FROM sys_solution_route WHERE path = '/wiki/admin'")[0];
		expect(route.module).toBe("wiki");
		expect(route.category).toBe("admin");
		expect(route.required_permission).toBe("wiki.doc.create");
		expect(Number(route.deprecated)).toBe(0);
	});
});

describe("重跑幂等", () => {
	it("同 decl 跑两遍：四表行数不变；管理员改过的 value 不被覆写（AC1-15 同纪律），定义列照常更新", async () => {
		await registerSolution(WIKI_V1);
		dbo.exec("UPDATE sys_setting SET value = 'admin-changed' WHERE key = 'wiki.home.page'");
		const before = counts();
		const r = await registerSolution({
			...WIKI_V1,
			settings: [{ ...WIKI_V1.settings[0], default_value: "start-v2" }, WIKI_V1.settings[1]],
		});
		expect(r.ok).toBe(true);
		expect(r.deprecated).toEqual([]);
		expect(counts()).toEqual(before);
		expect(rows("SELECT value, default_value FROM sys_setting WHERE key = 'wiki.home.page'")[0]).toEqual({ value: "admin-changed", default_value: "start-v2" });
	});
});

describe("deprecated 语义（镜像 solution-perms AC2-3/4）", () => {
	it("声明消失的 route/setting 旧行保留标 deprecated=1 并汇入清单；queryRegistered 快照不再含", async () => {
		await registerSolution(WIKI_V1);
		const r = await registerSolution({
			...WIKI_V1,
			version: "1.1.0",
			roles: [{ name: "wiki.admin", title: "管理员", permissions: ["wiki.doc.create"] }], // wiki.space.create 消失
			settings: [WIKI_V1.settings[0]], // wiki.readonly 消失
			routes: [WIKI_V1.routes[0]], // /wiki/admin 消失
		});
		expect(r.ok).toBe(true);
		expect(r.deprecated).toEqual(["wiki.space.create", "wiki.readonly", "/wiki/admin"]);
		// 旧行全保留且标 deprecated（判决不突变）
		expect(Number(rows("SELECT deprecated FROM sys_permission WHERE code = 'wiki.space.create'")[0].deprecated)).toBe(1);
		expect(rows("SELECT * FROM sys_setting WHERE key = 'wiki.readonly'")).toHaveLength(1);
		expect(Number(rows("SELECT deprecated FROM sys_setting WHERE key = 'wiki.readonly'")[0].deprecated)).toBe(1);
		expect(rows("SELECT * FROM sys_solution_route WHERE path = '/wiki/admin'")).toHaveLength(1);
		expect(Number(rows("SELECT deprecated FROM sys_solution_route WHERE path = '/wiki/admin'")[0].deprecated)).toBe(1);
		// 快照只含现行声明行
		const snap = await queryRegistered("wiki");
		expect(snap?.routes).toEqual(["/wiki/docs"]);
		expect(snap?.settings).toEqual(["wiki.home.page"]);
		expect(snap?.permissions).toEqual(["wiki.doc.create"]);
	});
});

describe("DB 级路由占用（P1-5 备案③承接）", () => {
	it("module B 声明 module A 已注册的首段 → ok=false 含占用者，A 的行原样", async () => {
		await registerSolution({ module: "alpha", roles: [], routes: [{ path: "/alpha/x", category: "main", order: 200, title_key: "alpha:menu.x" }] });
		const before = rows("SELECT * FROM sys_solution_route");
		const r = await registerSolution({ module: "beta", roles: [], routes: [{ path: "/alpha/y", category: "main", order: 200, title_key: "beta:menu.y" }] });
		expect(r.ok).toBe(false);
		expect(r.message).toContain("alpha");
		expect(rows("SELECT * FROM sys_solution_route")).toEqual(before);
	});

	it("checkOccupancy：同 module 重注册不报自占；他 module 首段冲突逐条报告", async () => {
		await registerSolution({ module: "alpha", roles: [], routes: [{ path: "/alpha/x", category: "main", order: 200, title_key: "alpha:menu.x" }] });
		expect(await checkOccupancy("alpha", ["/alpha/x", "/alpha/z"])).toEqual([]);
		expect(await checkOccupancy("beta", ["/alpha/y", "/beta/own"])).toEqual(["/alpha/y"]);
	});
});

describe("queryRegistered：冒烟对账快照", () => {
	it("未注册返回 null；注册后四清单全排序、module 归一", async () => {
		expect(await queryRegistered("nosuch")).toBeNull();
		await registerSolution({
			module: "sort",
			roles: [{ name: "sort.b", title: "B" }, { name: "sort.a", title: "A" }],
			settings: [
				{ key: "sort.k2", group: "sort", type: "string", default_value: "2" },
				{ key: "sort.k1", group: "sort", type: "string", default_value: "1" },
			],
			routes: [
				{ path: "/sort/z", category: "hidden", order: 200 },
				{ path: "/sort/m", category: "main", order: 201, title_key: "sort:menu.m" },
			],
		});
		expect(await queryRegistered("sort")).toEqual({
			module: "sort",
			routes: ["/sort/m", "/sort/z"],
			settings: ["sort.k1", "sort.k2"],
			roles: ["sort.a", "sort.b"],
			permissions: [],
		});
	});
});

describe("queryAllRegistered：全方案快照清单（P1-14 读端点辅助）", () => {
	it("四表并集取模块名，按 module 排序逐个快照；无任何行 → 空数组", async () => {
		expect(await queryAllRegistered()).toEqual([]);
		await registerSolution({ module: "b-sol", roles: [], settings: [], routes: [{ path: "/b", category: "main", order: 200 }] });
		await registerSolution({ module: "a-sol", roles: [], settings: [{ key: "a.k", group: "g", type: "string" }], routes: [] });
		const all = await queryAllRegistered();
		expect(all.map(s => s.module)).toEqual(["a-sol", "b-sol"]);
		expect(all.find(s => s.module === "a-sol")).toMatchObject({ settings: ["a.k"], routes: [] });
		expect(all.find(s => s.module === "b-sol")).toMatchObject({ routes: ["/b"] });
	});

	it("deprecated 行不计入存在性：唯一路由被声明消失标 deprecated 后方案不再列出", async () => {
		await registerSolution({ module: "gone-sol", roles: [], settings: [], routes: [{ path: "/gone", category: "main", order: 200 }] });
		// 重注册去掉 /gone → 旧行 deprecated=1，方案再无任何非 deprecated 行
		await registerSolution({ module: "gone-sol", roles: [], settings: [], routes: [] });
		const all = await queryAllRegistered();
		expect(all.map(s => s.module)).toEqual([]);
	});
});

describe("审计：auditOp 落 solution.register", () => {
	it("注册成功落 oplog 一条（系统侧 username=system，含版本与 deprecated 明细）", async () => {
		await registerSolution(WIKI_V1);
		await vi.waitFor(() => expect(rows("SELECT * FROM sys_oplog")).toHaveLength(1));
		const r = rows("SELECT * FROM sys_oplog")[0];
		expect(r.action).toBe("solution.register");
		expect(r.module).toBe("wiki");
		expect(r.version).toBe("1.0.0");
		expect(r.target).toBe("wiki");
		expect(r.username).toBe("system");
		expect(JSON.parse(String(r.detail))).toEqual({ routes: 2, settings: 2, deprecated: [] });
	});
});
