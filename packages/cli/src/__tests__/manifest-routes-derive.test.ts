import type { DerivedRoute, ModuleDefinitionLike } from "../manifest-routes-derive";

import { describe, expect, it } from "vitest";
import { deriveManifestRoutes, reconcileManifestRoutes } from "../manifest-routes-derive";

/**
 * BDD：R5 manifest.routes 由 entry.ts 路由 handle 自动派生（单一真源，避免手工双写漂移）。
 * - d-1：三类（main/admin/hidden）路由均派生，字段口径正确；
 * - d-2：无 handle.category 的路由（框架/纯页面/动态段子页）跳过，不进 manifest；
 * - d-3：既有 manifest routes 与派生结果漂移时，reconcile 以 entry.ts 为准并发警告（不阻断）。
 */

function def(routes: ModuleDefinitionLike["routes"]): ModuleDefinitionLike {
	return { name: "wiki", routes };
}

describe("deriveManifestRoutes（entry.ts → manifest routes）", () => {
	it("d-1 三类 category 均派生，字段口径正确（path/category/order/title_key）", () => {
		const d = def([
			{ path: "/space", handle: { category: "main", order: 200, title: "wiki:menu.space" } },
			{ path: "/admin", handle: { category: "admin", order: 220, title: "wiki:menu.admin" } },
			{ path: "/wiki/status", handle: { category: "hidden", order: 201, title: "wiki:menu.status" } },
		]);
		const out = deriveManifestRoutes(d);
		expect(out).toEqual([
			{ path: "/space", category: "main", order: 200, title_key: "wiki:menu.space" },
			{ path: "/admin", category: "admin", order: 220, title_key: "wiki:menu.admin" },
			{ path: "/wiki/status", category: "hidden", order: 201, title_key: "wiki:menu.status" },
		]);
	});

	it("d-2 无 category 的路由跳过：框架页/动态段子页/纯组件页不进 manifest", () => {
		const d = def([
			{ path: "/space", handle: { category: "main", order: 200, title: "wiki:menu.space" } },
			// 动态段子页（空间成员页）：不进菜单，无 category → 跳过
			{ path: ":id/members", handle: { title: "wiki:menu.members", hideInMenu: true } },
			// 框架/纯页面路由：无 category → 跳过
			{ path: "/dashboard", handle: { title: "framework:menu.dashboard" } },
		]);
		const out = deriveManifestRoutes(d);
		expect(out).toEqual([
			{ path: "/space", category: "main", order: 200, title_key: "wiki:menu.space" },
		]);
	});

	it("d-2b 缺 order 的 category 路由仍派生（order 省略，交 C2-17 契约校验报必填）", () => {
		const d = def([
			{ path: "/space", handle: { category: "main", title: "wiki:menu.space" } },
		]);
		const out = deriveManifestRoutes(d);
		expect(out).toEqual([{ path: "/space", category: "main", title_key: "wiki:menu.space" }]);
	});

	it("d-2c routes 缺失/空 → 派生为空数组（不抛）", () => {
		expect(deriveManifestRoutes(def(undefined))).toEqual([]);
		expect(deriveManifestRoutes(def([]))).toEqual([]);
	});

	it("d-4 多根树：每个顶层 category 根各自派生为独立 manifest route（需求一·多根）", () => {
		// 模块 routes 数组 length>1：/crm 与 /wiki 为两个一级菜单根，各自带 children
		const d = def([
			{
				path: "/crm",
				handle: { category: "main", order: 200, title: "acme:menu.crm" },
				children: [{ path: "/crm/customers", handle: { title: "acme:menu.customers" } }],
			},
			{
				path: "/wiki",
				handle: { category: "main", order: 210, title: "acme:menu.wiki" },
				children: [{ path: "/wiki/pages", handle: { title: "acme:menu.pages" } }],
			},
		]);
		const out = deriveManifestRoutes(d);
		// 仅取顶层一级菜单根（children 不进 manifest），两棵根都保留、互不坍缩
		expect(out).toEqual([
			{ path: "/crm", category: "main", order: 200, title_key: "acme:menu.crm" },
			{ path: "/wiki", category: "main", order: 210, title_key: "acme:menu.wiki" },
		]);
	});
});

describe("reconcileManifestRoutes（entry.ts 为准 + 漂移警告）", () => {
	it("d-3a 既有 routes 与派生一致：不警告，采用派生", () => {
		const existing: DerivedRoute[] = [
			{ path: "/space", category: "main", order: 200, title_key: "wiki:menu.space" },
		];
		const derived: DerivedRoute[] = [
			{ path: "/space", category: "main", order: 200, title_key: "wiki:menu.space" },
		];
		const { routes, warnings } = reconcileManifestRoutes(existing, derived);
		expect(routes).toEqual(derived);
		expect(warnings).toEqual([]);
	});

	it("d-3b 既有 routes 与派生漂移：以派生为准并发警告（不阻断）", () => {
		const existing: DerivedRoute[] = [
			// 旧 manifest 手写的 order 与 category 与 entry.ts 不一致
			{ path: "/space", category: "admin", order: 999, title_key: "wiki:menu.space" },
		];
		const derived: DerivedRoute[] = [
			{ path: "/space", category: "main", order: 200, title_key: "wiki:menu.space" },
		];
		const { routes, warnings } = reconcileManifestRoutes(existing, derived);
		expect(routes).toEqual(derived); // 以 entry.ts 为准
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("/space");
		expect(warnings[0]).toContain("entry.ts 为准");
	});

	it("d-3c 派生为空（未迁移方案未声明 category）：保留既有 routes，不覆盖", () => {
		const existing: DerivedRoute[] = [
			{ path: "/space", category: "main", order: 200, title_key: "wiki:menu.space" },
		];
		const { routes, warnings } = reconcileManifestRoutes(existing, []);
		expect(routes).toEqual(existing); // 沿用既有，向后兼容
		expect(warnings).toEqual([]);
	});

	it("d-3d 既有为空且派生为空：结果为空，无警告", () => {
		const { routes, warnings } = reconcileManifestRoutes([], []);
		expect(routes).toEqual([]);
		expect(warnings).toEqual([]);
	});
});
