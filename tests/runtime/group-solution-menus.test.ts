import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { MenuItemType } from "#src/layout/layout-menu/types";

import { describe, expect, it, vi } from "vitest";

import { groupSolutionMenus } from "#src/router/utils/group-solution-menus";

/**
 * 方案路由注册菜单归组（0.2.17 起）：
 * - flat main 归组已取消：category==="main" 不再按模块建父菜单，模块根即第一级菜单；
 * - admin 递归收集：category==="admin" 项（可在树任意层级）摘下，按 module 建子组，
 *   挂入 /system children 末尾，组标题存裸 i18n key `<module>:menu.main`（渲染层翻译），
 *   并压平 admin 项自身的层级（直接取 admin 的 children，使「管理」中间级消失）；
 * - 空表降级原样返回（开发形态不变），非突变。
 */

function row(partial: Partial<SolutionRouteRow> & { path: string }): SolutionRouteRow {
	return {
		module: "wiki",
		category: "admin",
		order: 200,
		title_key: null,
		required_permission: null,
		enabled: true,
		...partial,
	};
}

function item(key: string, children?: MenuItemType[]): MenuItemType {
	return children ? { key, label: key, children } : { key, label: key };
}

/** 携带 handle 元数据（module/category/order）的菜单项——模拟 0.2.16 module-loader 注入后的形态 */
function itemH(key: string, meta: { module?: string, category?: MenuItemType["category"], order?: number }, children?: MenuItemType[]): MenuItemType {
	return children ? { key, label: key, ...meta, children } : { key, label: key, ...meta };
}

function bottom0(): MenuItemType[] {
	return [];
}

describe("groupSolutionMenus（admin 归组 + 取消 flat main）", () => {
	it("g1 空表降级：rows=[]、无 admin 两段原样返回，不突变入参", () => {
		const top = [item("/space")];
		const bottom = [item("/system")];
		const out = groupSolutionMenus(top, bottom, []);
		expect(out.top).toEqual(top);
		expect(out.bottom).toEqual(bottom);
		// 无 admin 时整段无变动，复用原数组引用（不无故分配）
		expect(out.top).toBe(top);
		expect(out.bottom).toBe(bottom);
	});

	it("g2 多 main 不归组：category===\"main\" 直接直出，无 solgroup:main 父项", () => {
		const top = [
			itemH("/space", { module: "wiki", category: "main", order: 200 }),
			itemH("/collections", { module: "wiki", category: "main", order: 210 }),
		];
		const out = groupSolutionMenus(top, bottom0(), []);
		expect(out.top.map(m => m.key)).toEqual(["/space", "/collections"]);
		expect(out.top.some(m => m.key.startsWith("solgroup:main:"))).toBe(false);
	});

	it("g3 admin 递归收集+挂入 /system：从 top 摘下，进 bottom /system children，top 不再出现", () => {
		const top = [
			itemH("/space", { module: "wiki", category: "main", order: 200 }),
			itemH("/system/wiki/admin", { module: "wiki", category: "admin", order: 220 }, [
				itemH("/system/wiki/admin/contacts", { module: "wiki", order: 221 }),
			]),
		];
		const bottom = [itemH("/system", {}, [itemH("/system/users", {})])];
		const out = groupSolutionMenus(top, bottom, []);
		expect(out.top.map(m => m.key)).toEqual(["/space"]); // admin 已摘下
		const [system] = out.bottom;
		expect(system?.key).toBe("/system");
		const adminGroup = system?.children?.find(c => c.key === "solgroup:admin:wiki");
		expect(adminGroup?.label).toBe("wiki:menu.main");
		// 压平 admin 中间级：admin 的 children（通讯录）直挂子组下
		expect(adminGroup?.children?.map(c => c.key)).toEqual(["/system/wiki/admin/contacts"]);
		// /system 原有 children 保留且在前
		expect(system?.children?.[0]?.key).toBe("/system/users");
	});

	it("g4 嵌套 admin 也能递归收集（深层仍可摘挂）", () => {
		const top = [
			itemH("/wiki", { module: "wiki" }, [
				itemH("/wiki/x", { module: "wiki" }, [
					itemH("/wiki/x/admin", { module: "wiki", category: "admin", order: 220 }, [
						itemH("/wiki/x/admin/contacts", { module: "wiki", order: 221 }),
					]),
				]),
			]),
		];
		const bottom = [itemH("/system", {})];
		const out = groupSolutionMenus(top, bottom, []);
		const adminGroup = out.bottom[0]?.children?.find(c => c.key === "solgroup:admin:wiki");
		expect(adminGroup?.children?.map(c => c.key)).toEqual(["/wiki/x/admin/contacts"]);
	});

	it("g5 无 /system 回落：admin 项摘除且无挂载点，告警一次（避免静默丢菜单）", () => {
		const onWarn = vi.fn();
		const top = [itemH("/adm", { module: "wiki", category: "admin", order: 220 })];
		const out = groupSolutionMenus(top, [], [], { onWarn });
		expect(out.top.map(m => m.key)).toEqual([]); // 已摘除、无处挂载
		expect(onWarn).toHaveBeenCalledTimes(1);
	});

	it("g6 多模块 admin 排序：/system children 按 order 升序追加", () => {
		const top = [
			itemH("/b-admin", { module: "beta", category: "admin", order: 230 }, [itemH("/b-admin/c", { module: "beta", order: 231 })]),
			itemH("/a-admin", { module: "alpha", category: "admin", order: 220 }, [itemH("/a-admin/c", { module: "alpha", order: 221 })]),
		];
		const bottom = [itemH("/system", {})];
		const out = groupSolutionMenus(top, bottom, []);
		const adminGroups = out.bottom[0]?.children ?? [];
		expect(adminGroups.map(c => c.key)).toEqual(["solgroup:admin:alpha", "solgroup:admin:beta"]);
	});

	it("g7 行回退仍生效：item 无 handle.category 但行命中 admin，仍收集", () => {
		const top = [item("/system/wiki/admin", [item("/system/wiki/admin/contacts")])];
		const bottom = [item("/system", [item("/system/users")])];
		const rows = [row({ path: "/system/wiki/admin", category: "admin", module: "wiki", order: 220 })];
		const out = groupSolutionMenus(top, bottom, rows);
		const adminGroup = out.bottom[0]?.children?.find(c => c.key === "solgroup:admin:wiki");
		expect(adminGroup?.label).toBe("wiki:menu.main");
		expect(adminGroup?.children?.map(c => c.key)).toEqual(["/system/wiki/admin/contacts"]);
	});

	it("g8 无 admin 时 /system 不被强加空 children（保持原对象引用）", () => {
		const system = itemH("/system", {}, [itemH("/system/users", {})]);
		const bottom = [system];
		const out = groupSolutionMenus([item("/space")], bottom, []);
		expect(out.bottom[0]).toBe(system); // 未改写
	});

	it("g9 菜单项无对应行且无 metadata：不动（无注册语义）", () => {
		const top = [item("/admin"), item("/space")];
		const out = groupSolutionMenus(top, bottom0(), []);
		expect(out.top.map(m => m.key)).toEqual(["/admin", "/space"]);
	});

	it("g10 admin 无 children 时退回 admin 项本身（不丢菜单）", () => {
		const top = [itemH("/system/wiki/admin", { module: "wiki", category: "admin", order: 220 })];
		const bottom = [itemH("/system", {})];
		const out = groupSolutionMenus(top, bottom, []);
		const adminGroup = out.bottom[0]?.children?.find(c => c.key === "solgroup:admin:wiki");
		expect(adminGroup?.children?.map(c => c.key)).toEqual(["/system/wiki/admin"]);
	});
});
