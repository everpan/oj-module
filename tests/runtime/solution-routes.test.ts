import type { RbacSettingItem, SolutionRouteRow } from "#src/api/rbac/types";
import type { AppRouteRecordRaw } from "#src/router/types";
import { describe, expect, it } from "vitest";

import { groupSettingsByModule } from "#src/api/rbac/helpers";
import { mergeSolutionCategories } from "#src/router/utils/merge-solution-categories";

/**
 * BDD：P1-14 前端归并（R20/R21）。
 * - mergeSolutionCategories：三值归并（main/admin/hidden）、hidden/禁用 → hideInMenu、
 *   order 共用序轴（框架 100 带、方案 200 起）、端点失败降级空表不炸、纯函数不可变入参。
 * - groupSettingsByModule：设置按模块三层嵌套分组（R24 所有权）、方案组 label_key 推导、
 *   框架组在前按 group 聚合（维持现状渲染）、方案组按 module 名排序在后。
 */

function row(partial: Partial<SolutionRouteRow> & { path: string }): SolutionRouteRow {
	return {
		module: "demo-market",
		category: "main",
		order: 200,
		title_key: null,
		required_permission: null,
		enabled: true,
		...partial,
	};
}

function route(path: string, order?: number, hideInMenu?: boolean): AppRouteRecordRaw {
	return {
		path,
		handle: { title: `mod:menu.${path}`, ...(order === undefined ? {} : { order }), ...(hideInMenu ? { hideInMenu } : {}) },
		Component: () => null,
	};
}

describe("mergeSolutionCategories：三值归并（R21）", () => {
	it("main/admin/hidden 按路径注记 category，hidden 复用 hideInMenu 通路", () => {
		const routes = [route("/demo"), route("/demo/admin"), route("/demo/ping")];
		const merged = mergeSolutionCategories(routes, [
			row({ path: "/demo", category: "main", order: 200 }),
			row({ path: "/demo/admin", category: "admin", order: 300 }),
			row({ path: "/demo/ping", category: "hidden", order: 205 }),
		]);
		expect(merged.map(r => r.handle.category)).toEqual(["main", "admin", "hidden"]);
		expect(merged[2]!.handle.hideInMenu).toBe(true);
		expect(merged[0]!.handle.hideInMenu).toBe(false);
		expect(merged[1]!.handle.hideInMenu).toBe(false);
	});

	it("enabled=0（禁用）仅菜单层过滤：hideInMenu=true、路由仍可达", () => {
		const merged = mergeSolutionCategories([route("/demo")], [row({ path: "/demo", enabled: false })]);
		expect(merged[0]!.handle.hideInMenu).toBe(true);
		expect(merged[0]!.handle.category).toBe("main");
	});

	it("方案 order 覆写共用序轴：框架项 100 带在前、方案项 200 起在后", () => {
		const routes = [route("/home", 100), route("/demo", 1)];
		const merged = mergeSolutionCategories(routes, [row({ path: "/demo", order: 200 })]);
		expect(merged.map(r => r.handle.order)).toEqual([100, 200]);
		expect([...merged].sort((a, b) => a.handle.order! - b.handle.order!).map(r => r.path)).toEqual(["/home", "/demo"]);
	});

	it("未匹配路由（框架/后端）原样保留；入参不被突变（纯函数）", () => {
		const home = route("/home", 100);
		const demo = route("/demo", 1);
		const merged = mergeSolutionCategories([home, demo], [row({ path: "/demo", order: 200, category: "admin" })]);
		expect(merged[0]).toBe(home);
		expect(home.handle.category).toBeUndefined();
		expect(home.handle.order).toBe(100);
		// demo 被替换为新对象，原对象不动
		expect(demo.handle.order).toBe(1);
		expect(merged[1]!.handle.order).toBe(200);
	});

	it("降级空表不炸：solRoutes 为空时原样返回（路由照常，R21）", () => {
		const routes = [route("/home", 100)];
		expect(mergeSolutionCategories(routes, [])).toBe(routes);
	});

	it("路由已声明 hideInMenu 时不被归并复活", () => {
		const merged = mergeSolutionCategories([route("/demo", undefined, true)], [row({ path: "/demo", category: "main" })]);
		expect(merged[0]!.handle.hideInMenu).toBe(true);
	});
});

function setting(partial: Partial<RbacSettingItem> & { key: string }): RbacSettingItem {
	return {
		module: partial.key?.split(".")[0] ?? "",
		group: "general",
		type: "string",
		value: null,
		default_value: null,
		label_key: null,
		options: null,
		secret: false,
		update_time: 0,
		...partial,
	};
}

describe("groupSettingsByModule：设置三层嵌套分组（R20/R24）", () => {
	it("框架卡按 group 聚合在前（维持现状渲染），方案卡按 module 名排序在后", () => {
		const cards = groupSettingsByModule([
			setting({ key: "framework.site_title", module: "framework", group: "general" }),
			setting({ key: "ldap_base_dn", module: "ldap", group: "ldap" }),
			setting({ key: "demo-market.display.theme", module: "demo-market", group: "display" }),
			setting({ key: "market.cdn_url", module: "market", group: "security" }),
			setting({ key: "another-sol.a.k", module: "another-sol", group: "display" }),
			setting({ key: "demo-market.sync.interval", module: "demo-market", group: "sync" }),
		]);
		// 框架卡：module=null，组序保持服务端次序；方案卡：module 升序
		expect(cards.map(c => [c.module, c.group])).toEqual([
			[null, "general"],
			[null, "ldap"],
			[null, "security"],
			["another-sol", "display"],
			["demo-market", "display"],
			["demo-market", "sync"],
		]);
	});

	it("方案卡 label_key = <module>:settings.group.<group>（C2-22）；框架卡 label_key=null", () => {
		const cards = groupSettingsByModule([
			setting({ key: "framework.site_title", module: "framework", group: "general" }),
			setting({ key: "demo-market.display.theme", module: "demo-market", group: "display" }),
		]);
		expect(cards[0]!.label_key).toBeNull();
		expect(cards[1]!.label_key).toBe("demo-market:settings.group.display");
	});

	it("同组项归同一卡（方案内 group 聚合），项保持原序", () => {
		const a = setting({ key: "demo-market.display.theme", module: "demo-market", group: "display" });
		const b = setting({ key: "demo-market.display.font", module: "demo-market", group: "display" });
		const cards = groupSettingsByModule([a, b]);
		expect(cards).toHaveLength(1);
		expect(cards[0]!.items).toEqual([a, b]);
	});

	it("空行降级：返回空数组不炸", () => {
		expect(groupSettingsByModule([])).toEqual([]);
	});
});
