import type { AppRouteRecordRaw } from "#src/router/types";

import { describe, expect, it } from "vitest";

import { getParentKeys, resolveSelectedKeys } from "#src/layout/layout-menu/utils";
import { addRouteIdByPath } from "#src/router/utils/add-route-id-by-path";
import { generateMenuItemsFromRoutes } from "#src/router/utils/generate-menu-items-from-routes";
import { groupSolutionMenus } from "#src/router/utils/group-solution-menus";
import { resolveRoutePath, rewriteAdminPaths } from "#src/router/utils/rewrite-admin-paths";

/**
 * admin 路由真重写（0.2.17 单根模块约定）：
 * category==="admin" 的路由子树改写为 /system/<模块 root path>/*，并 hoist 到顶层，
 * 原父树位置摘除。非突变。
 */

function r(path: string, meta: { module?: string, category?: "main" | "admin" | "hidden" }, children?: AppRouteRecordRaw[]): AppRouteRecordRaw {
	return children ? { path, handle: { title: path, ...meta }, children } : { path, handle: { title: path, ...meta } };
}

/** 模拟 wiki 单根结构：根 /wiki，children 含 status(hidden)/collections/space/admin(admin) */
function wikiRoutes(): AppRouteRecordRaw[] {
	return [
		r("wiki", { module: "wiki" }, [
			r("status", { module: "wiki", category: "hidden" }),
			r("collections", { module: "wiki" }),
			r("space", { module: "wiki" }, [
				r(":id/members", { module: "wiki" }),
			]),
			r("admin", { module: "wiki", category: "admin" }, [
				r("index", { module: "wiki" }),
				r("contacts", { module: "wiki" }),
			]),
		]),
	];
}

describe("rewriteAdminPaths", () => {
	it("r1 admin 真重写：/wiki/admin → /system/wiki/admin，且 hoist 到顶层（摘除原位置）", () => {
		const out = rewriteAdminPaths(wikiRoutes());
		// 顶层出现 /system/wiki/admin（hoisted）
		const hoisted = out.find(rt => rt.path === "/system/wiki/admin");
		expect(hoisted).toBeDefined();
		expect(hoisted?.handle?.category).toBe("admin");
		expect(hoisted?.handle?.module).toBe("wiki");
		// 原 /wiki 树下不再含 admin 子项
		const wikiRoot = out.find(rt => rt.path === "wiki");
		expect(wikiRoot?.children?.map(c => c.path)).not.toContain("admin");
		// 其余 children 仍在 /wiki 下
		expect(wikiRoot?.children?.map(c => c.path)).toEqual(["status", "collections", "space"]);
	});

	it("r2 前缀取模块 root path（非模块名）：深层嵌套 admin 后缀原样保留", () => {
		const routes = [
			r("wiki", { module: "wiki" }, [
				r("settings", { module: "wiki" }, [
					r("admin", { module: "wiki", category: "admin" }, [
						r("contacts", { module: "wiki" }),
					]),
				]),
			]),
		];
		const out = rewriteAdminPaths(routes);
		const hoisted = out.find(rt => rt.path === "/system/wiki/settings/admin");
		expect(hoisted).toBeDefined();
		expect(hoisted?.children?.map(c => c.path)).toEqual(["contacts"]); // 相对层级保留
	});

	it("r3 无 admin 时原样返回（结构相等、顶层数量不变）", () => {
		const routes = [r("wiki", { module: "wiki" }, [r("space", { module: "wiki" })])];
		const out = rewriteAdminPaths(routes);
		expect(out).toEqual(routes);
	});

	it("r4 非突变：入参对象不被修改", () => {
		const routes = wikiRoutes();
		const snapshot = JSON.parse(JSON.stringify(routes));
		rewriteAdminPaths(routes);
		expect(routes).toEqual(snapshot);
	});

	it("r5 多模块各自归位：不同 root path 生成不同 /system 前缀", () => {
		const routes = [
			r("wiki", { module: "wiki" }, [r("admin", { module: "wiki", category: "admin" })]),
			r("/oj-market", { module: "oj-market" }, [r("admin", { module: "oj-market", category: "admin" })]),
		];
		const out = rewriteAdminPaths(routes);
		expect(out.map(rt => rt.path)).toContain("/system/wiki/admin");
		expect(out.map(rt => rt.path)).toContain("/system/oj-market/admin");
	});

	it("r6 admin 重写同步刷新子树 id，选中菜单时展开系统管理父链", () => {
		const routes = addRouteIdByPath([
			r("/wiz-pm", { module: "wiz-pm" }, [
				r("admin", { module: "wiz-pm", category: "admin" }, [
					r("data", { module: "wiz-pm" }),
				]),
			]),
		]);
		const out = rewriteAdminPaths(routes);
		const hoisted = out.find(rt => rt.path === "/system/wiz-pm/admin") as (AppRouteRecordRaw & { id?: string }) | undefined;
		const leaf = hoisted?.children?.[0] as (AppRouteRecordRaw & { id?: string }) | undefined;

		expect(hoisted?.id).toBe("/system/wiz-pm/admin");
		expect(leaf?.id).toBe("/system/wiz-pm/admin/data");

		const grouped = groupSolutionMenus(
			generateMenuItemsFromRoutes(out),
			[{ key: "/system", label: "系统管理" }],
			[],
		);
		const parentKeys = getParentKeys([...grouped.top, ...grouped.bottom]);
		const selected = resolveSelectedKeys(
			[{ id: leaf?.id, handle: leaf?.handle }] as any,
			parentKeys,
		);
		expect(selected).toEqual(["/system", "solgroup:admin:wiz-pm", "/system/wiz-pm/admin/data"]);
	});
});

describe("resolveRoutePath：单路由导航 path", () => {
	it.each([
		{
			name: "绝对 admin path 添加 /system",
			route: r("/wiz-pm/admin", { module: "wiz-pm", category: "admin" }),
			want: "/system/wiz-pm/admin",
		},
		{
			name: "相对 admin path 使用绝对 id 保留模块根",
			route: { ...r("admin", { module: "wiz-pm", category: "admin" }), id: "/wiz-pm/admin" },
			want: "/system/wiz-pm/admin",
		},
		{
			name: "普通路由 path 原样返回",
			route: r("/wiz-pm/data", { module: "wiz-pm" }),
			want: "/wiz-pm/data",
		},
		{
			name: "已重写 admin path 不重复添加 /system",
			route: r("/system/wiz-pm/admin", { module: "wiz-pm", category: "admin" }),
			want: "/system/wiz-pm/admin",
		},
	])("$name", ({ route, want }) => {
		expect(resolveRoutePath(route)).toBe(want);
	});
});

describe("resolveRoutePath：admin 子树后代（category 继承自祖先链）", () => {
	const root = r("/wiz-pm", { module: "wiz-pm" });
	const adminParent = r("admin", { module: "wiz-pm", category: "admin" });

	it.each([
		{
			name: "相对子路由按链拼接并重写",
			route: r("data", { module: "wiz-pm" }),
			chain: [root, adminParent],
			want: "/system/wiz-pm/admin/data",
		},
		{
			name: "已生成原始 id 优先，链仅供 admin 判定",
			route: { ...r("data", { module: "wiz-pm" }), id: "/wiz-pm/admin/data" },
			chain: [root, adminParent],
			want: "/system/wiz-pm/admin/data",
		},
		{
			name: "admin 嵌套在链深层，重写与深度无关",
			route: r("data", { module: "a" }),
			chain: [r("/a", { module: "a" }), r("b", { module: "a" }), r("admin", { module: "a", category: "admin" })],
			want: "/system/a/b/admin/data",
		},
		{
			name: "链无 admin 祖先：仅拼接绝对路径，不重写",
			route: r("data", { module: "wiki" }),
			chain: [r("/wiki", { module: "wiki" }), r("admin", { module: "wiki" })],
			want: "/wiki/admin/data",
		},
		{
			name: "index 子路由尾斜杠与框架 id 同源",
			route: { index: true, handle: { title: "index", module: "wiz-pm" } },
			chain: [root, adminParent],
			want: "/system/wiz-pm/admin/",
		},
		{
			name: "已重写 id 幂等原样返回",
			route: { ...r("data", { module: "wiz-pm" }), id: "/system/wiz-pm/admin/data" },
			chain: [root, adminParent],
			want: "/system/wiz-pm/admin/data",
		},
	])("$name", ({ route, chain, want }) => {
		expect(resolveRoutePath(route, ...chain)).toBe(want);
	});

	it("与框架全管线一致：链式结果等于 rewriteAdminPaths 后子树 id", () => {
		const withIds = addRouteIdByPath(wikiRoutes());
		const rootNode = withIds[0];
		const adminNode = rootNode.children!.find(c => c.handle?.category === "admin")!;
		const contacts = adminNode.children!.find(c => c.path === "contacts")!;

		const rewritten = rewriteAdminPaths(withIds);
		const hoistedAdmin = rewritten.find(c => c.path === "/system/wiki/admin")!;
		const rewrittenContacts = hoistedAdmin.children!.find(c => c.path === "contacts")!;

		expect(resolveRoutePath(contacts, rootNode, adminNode)).toBe((rewrittenContacts as AppRouteRecordRaw & { id?: string }).id);
		expect(resolveRoutePath(contacts, rootNode, adminNode)).toBe("/system/wiki/admin/contacts");
	});
});
