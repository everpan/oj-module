import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { MenuItemType } from "#src/layout/layout-menu/types";

import { describe, expect, it, vi } from "vitest";

import { groupSolutionMenus } from "#src/router/utils/group-solution-menus";

/**
 * 方案路由注册菜单归组（2026-10-21 设计 docs/plans/2026-10-21-1028-solution-menu-grouping.md）：
 * main 路由 ≥2 条按模块归父菜单；admin 路由跨列表挂进 bottom 的 /system；
 * 组标题存裸 i18n key（渲染层 translateMenus 翻译）；空表原样通过（开发形态不变）。
 */

function row(partial: Partial<SolutionRouteRow> & { path: string }): SolutionRouteRow {
	return {
		module: "wiki",
		category: "main",
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

/** wiki 形态夹具：top 两条 main + 一条 admin（正 order），bottom 一条 /system（负 order pin 区） */
function wikiFixture() {
	const top = [item("/space"), item("/wiki/collections"), item("/admin")];
	const bottom = [item("/system", [item("/system/users")])];
	const rows = [
		row({ path: "/space", order: 200 }),
		row({ path: "/wiki/collections", order: 210 }),
		row({ path: "/admin", category: "admin", order: 220 }),
	];
	return { top, bottom, rows };
}

describe("groupSolutionMenus（注册菜单归组）", () => {
	it("g1 空表降级：rows=[] 两段原样返回，不突变入参", () => {
		const top = [item("/space")];
		const bottom = [item("/system")];
		const out = groupSolutionMenus(top, bottom, []);
		expect(out.top).toEqual(top);
		expect(out.bottom).toEqual(bottom);
		expect(out.top).not.toBe(top); // 新数组（防御性拷贝），内容相等
	});

	it("g2 单 main 不归组：顶层直出，无 solgroup 父项", () => {
		const top = [item("/space"), item("/other")];
		const rows = [row({ path: "/space" })];
		const out = groupSolutionMenus(top, bottom0(), rows);
		expect(out.top.map(m => m.key)).toEqual(["/space", "/other"]);
	});

	it("g3 双 main 归组：父项 children 按 order 含两项，站位取组内最小 order", () => {
		const top = [item("/zzz"), item("/space"), item("/wiki/collections")];
		const rows = [
			row({ path: "/space", order: 200 }),
			row({ path: "/wiki/collections", order: 210 }),
		];
		const out = groupSolutionMenus(top, bottom0(), rows);
		// /zzz 无对应行不动；wiki 组插入在 /space 原序位（组内最小 order 200 → index 1）
		expect(out.top.map(m => m.key)).toEqual(["/zzz", "solgroup:main:wiki"]);
		const [group] = out.top.slice(1);
		expect(group?.children?.map(c => c.key)).toEqual(["/space", "/wiki/collections"]);
	});

	it("g4 组标题存裸 i18n key：label === \"wiki:menu.group\"（不翻译）", () => {
		const { top, rows } = wikiFixture();
		const out = groupSolutionMenus(top, bottom0(), rows, { onWarn: () => {} });
		const group = out.top.find(m => m.key === "solgroup:main:wiki");
		expect(group?.label).toBe("wiki:menu.group");
	});

	it("g5 admin 跨列表挂载：从 top 摘下，进 bottom /system children，top 不再出现", () => {
		const { top, bottom, rows } = wikiFixture();
		const out = groupSolutionMenus(top, bottom, rows);
		expect(out.top.map(m => m.key)).toEqual(["solgroup:main:wiki"]);
		const [system] = out.bottom;
		expect(system?.key).toBe("/system");
		const adminGroup = system?.children?.find(c => c.key === "solgroup:admin:wiki");
		expect(adminGroup?.label).toBe("wiki:menu.group");
		expect(adminGroup?.children?.map(c => c.key)).toEqual(["/admin"]);
		// /system 原有 children 保留且在前
		expect(system?.children?.[0]?.key).toBe("/system/users");
	});

	it("g6 无 /system 回落：admin 项回来源列表原序 + warnOnce 一次", () => {
		const onWarn = vi.fn();
		const top = [item("/a"), item("/admin"), item("/b")];
		const rows = [row({ path: "/admin", category: "admin", order: 220 })];
		const out = groupSolutionMenus(top, [], rows, { onWarn });
		expect(out.top.map(m => m.key)).toEqual(["/a", "/admin", "/b"]);
		expect(onWarn).toHaveBeenCalledTimes(1);
	});

	it("g6b 默认 warn 通道为 console.warn 且只打一次（宿主排查面）", async () => {
		// 模块级 warnedOnce 跨测试共享，这里重置模块拿到干净实例，避免 G4 等先污染状态
		vi.resetModules();
		const { groupSolutionMenus: g } = await import("#src/router/utils/group-solution-menus");
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const rows = [row({ path: "/admin", category: "admin" })];
			g([item("/admin")], [], rows);
			g([item("/admin")], [], rows);
			expect(spy).toHaveBeenCalledTimes(1); // warnOnce：同会话不轰炸
		}
		finally {
			spy.mockRestore();
			vi.resetModules();
		}
	});

	it("g7 多模块 admin 排序：/system children 按 row.order 升序追加", () => {
		const top = [item("/a-admin"), item("/b-admin")];
		const bottom = [item("/system")];
		const rows = [
			row({ path: "/b-admin", module: "beta", category: "admin", order: 230 }),
			row({ path: "/a-admin", module: "alpha", category: "admin", order: 220 }),
		];
		const out = groupSolutionMenus(top, bottom, rows);
		const adminGroups = out.bottom[0]?.children ?? [];
		expect(adminGroups.map(c => c.key)).toEqual(["solgroup:admin:alpha", "solgroup:admin:beta"]);
	});

	it("g8 hidden/禁用行不参与：不摘除、不建组", () => {
		const top = [item("/space"), item("/wiki/status"), item("/off")];
		const rows = [
			row({ path: "/space" }),
			row({ path: "/wiki/status", category: "hidden" }),
			row({ path: "/off", enabled: false }),
		];
		const out = groupSolutionMenus(top, bottom0(), rows);
		// 单 main（/space）不归组；hidden 与禁用项原样保留
		expect(out.top.map(m => m.key)).toEqual(["/space", "/wiki/status", "/off"]);
	});

	it("g9 main 与 admin 混合：互不干扰，两类组同存", () => {
		const { top, bottom, rows } = wikiFixture();
		const out = groupSolutionMenus(top, bottom, rows);
		expect(out.top.map(m => m.key)).toEqual(["solgroup:main:wiki"]);
		expect(out.bottom[0]?.children?.map(c => c.key)).toEqual(["/system/users", "solgroup:admin:wiki"]);
	});

	it("g10 菜单项无对应行：不动（无行即无注册语义）", () => {
		const top = [item("/admin"), item("/space")];
		const out = groupSolutionMenus(top, bottom0(), []);
		expect(out.top.map(m => m.key)).toEqual(["/admin", "/space"]);
	});

	it("g11 嵌套 main 子项：只处理顶层，子项不重挂不告警", () => {
		const top = [item("/wiki", [item("/wiki/inner")])];
		const rows = [row({ path: "/wiki/inner", order: 200 })];
		const onWarn = vi.fn();
		const out = groupSolutionMenus(top, [], rows, { onWarn });
		expect(out.top).toEqual(top);
		expect(onWarn).not.toHaveBeenCalled();
	});

	it("边界：rows 里模块只有 main 一条 + admin 一条——main 直出、admin 入 /system", () => {
		const top = [item("/only"), item("/adm")];
		const bottom = [item("/system")];
		const rows = [
			row({ path: "/only", order: 200 }),
			row({ path: "/adm", category: "admin", order: 220 }),
		];
		const out = groupSolutionMenus(top, bottom, rows);
		expect(out.top.map(m => m.key)).toEqual(["/only"]);
		expect(out.bottom[0]?.children?.map(c => c.key)).toEqual(["solgroup:admin:wiki"]);
	});
});

function bottom0(): MenuItemType[] {
	return [];
}
