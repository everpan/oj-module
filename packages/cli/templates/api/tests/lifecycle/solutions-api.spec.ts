// BDD：方案路由读端点（P1-14，R21 前端归并数据源）。
// GET /api/_platform/solutions/routes：登录即可、只读、无权限点（contacts/api.ts 同纪律）；
// 下发未 deprecated 行全列（path/module/category/order/title_key/required_permission/enabled），
// order 数值 / enabled 布尔归一化；deprecated 行排除；enabled=0 行保留（菜单层过滤在前端，R21）。
/* eslint-disable test/prefer-lowercase-title -- 端点路径是验收锚点 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import api from "../../src/_platform/solutions/api";
import { installDb } from "../fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

/** 捕获 json.ok/json.fail 出口（respond 收口后恰一次调用） */
let last: { status: number, msg?: string, data?: unknown } | null = null;

function seedRoute(partial: {
	path: string
	module: string
	category?: string
	order?: number
	title_key?: string | null
	required_permission?: string | null
	deprecated?: number
	enabled?: number
}) {
	const r = { category: "main", order: 200, title_key: null, required_permission: null, deprecated: 0, enabled: 1, ...partial };
	dbo.prepare(`INSERT INTO sys_solution_route (path, module, category, "order", title_key, required_permission, deprecated, enabled)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
		.run(r.path, r.module, r.category, r.order, r.title_key, r.required_permission, r.deprecated, r.enabled);
}

beforeEach(() => {
	dbo = installDb();
	g.http = { user: { id: 1 } };
	g.json = {
		ok: (data: unknown) => {
			last = { status: 200, data };
		},
		fail: (status: number, msg: string) => {
			last = { status, msg };
		},
	};
	last = null;
});

afterEach(() => {
	g.http = undefined;
	g.json = undefined;
	g.db = undefined;
});

describe("GET /api/_platform/solutions/routes", () => {
	it("匿名 401（登录即可，contacts 同纪律，无权限点）", async () => {
		g.http = {};
		await api.routes.get();
		expect(last?.status).toBe(401);
	});

	it("全列下发且归一化：order 数值、enabled 布尔、category 三值", async () => {
		seedRoute({ path: "/demo", module: "demo-market", category: "main", order: 200, title_key: "demo-market:menu.main" });
		seedRoute({ path: "/demo/admin", module: "demo-market", category: "admin", order: 300, required_permission: "demo.view" });
		seedRoute({ path: "/demo/ping", module: "demo-market", category: "hidden", order: 205, title_key: "demo-market:menu.ping" });
		await api.routes.get();
		expect(last?.status).toBe(200);
		expect(last?.data).toEqual([
			{ path: "/demo", module: "demo-market", category: "main", order: 200, title_key: "demo-market:menu.main", required_permission: null, enabled: true },
			{ path: "/demo/ping", module: "demo-market", category: "hidden", order: 205, title_key: "demo-market:menu.ping", required_permission: null, enabled: true },
			{ path: "/demo/admin", module: "demo-market", category: "admin", order: 300, title_key: null, required_permission: "demo.view", enabled: true },
		]);
	});

	it("deprecated 行排除；enabled=0（禁用）行保留——菜单层过滤归前端（R21）", async () => {
		seedRoute({ path: "/live", module: "live", enabled: 1 });
		seedRoute({ path: "/off", module: "live", enabled: 0 });
		seedRoute({ path: "/gone", module: "old", deprecated: 1 });
		await api.routes.get();
		expect(last?.data).toEqual([
			{ path: "/live", module: "live", category: "main", order: 200, title_key: null, required_permission: null, enabled: true },
			{ path: "/off", module: "live", category: "main", order: 200, title_key: null, required_permission: null, enabled: false },
		]);
	});

	it("空表返回空数组（前端降级空表口径）", async () => {
		await api.routes.get();
		expect(last?.status).toBe(200);
		expect(last?.data).toEqual([]);
	});

	it("排序稳定：module → order → path（跨方案、同方案多路由确定性输出）", async () => {
		seedRoute({ path: "/b/z", module: "b-sol", order: 200 });
		seedRoute({ path: "/a/z", module: "a-sol", order: 300 });
		seedRoute({ path: "/a/p", module: "a-sol", order: 200 });
		seedRoute({ path: "/a/m", module: "a-sol", order: 200 });
		await api.routes.get();
		expect((last?.data as Array<{ path: string }>).map(r => r.path)).toEqual(["/a/m", "/a/p", "/a/z", "/b/z"]);
	});
});
