import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { AppRouteRecordRaw } from "#src/router/types";
import { beforeEach, describe, expect, it } from "vitest";

import { useAccessStore } from "#src/store/access";

/**
 * 接入层归组回归（2026-10-21 设计 docs/plans/2026-10-21-1028-solution-menu-grouping.md）：
 * setAccessStore 在登记菜单时同步调用 groupSolutionMenus；空表/无命中行为无操作（开发形态不变）。
 * 真正触发归组的时机是 useSolutionRoutes 就绪后 setSolutionRoutes 按快照重归并（R21），
 * 故测试走「先登记路由、再推送方案行」的真实时序。
 */

// 宿主侧已登记的路由（含一条 /system 底部菜单，与方案 admin 归组挂载点对应）
const MODULE_ROUTES: AppRouteRecordRaw[] = [
	{
		path: "/space",
		handle: { title: "wiki:menu.space", layout: "container", order: 200 },
		children: [{ index: true, handle: { title: "wiki:menu.space" }, Component: () => null }],
	},
	{
		path: "/wiki/collections",
		handle: { title: "wiki:menu.collections", layout: "container", order: 210 },
		children: [{ index: true, handle: { title: "wiki:menu.collections" }, Component: () => null }],
	},
	{
		path: "/admin",
		handle: { title: "wiki:menu.admin", layout: "container", order: 220 },
		children: [{ index: true, handle: { title: "wiki:menu.admin" }, Component: () => null }],
	},
	{
		path: "/system",
		handle: { title: "system:menu.system", layout: "container", order: -100 },
		children: [{ path: "/system/user", handle: { title: "system:menu.user" }, Component: () => null }],
	},
];

const SOLUTION_ROWS: SolutionRouteRow[] = [
	{ path: "/space", module: "wiki", category: "main", order: 200, title_key: "wiki:menu.space", required_permission: null, enabled: true },
	{ path: "/wiki/collections", module: "wiki", category: "main", order: 210, title_key: "wiki:menu.collections", required_permission: null, enabled: true },
	{ path: "/admin", module: "wiki", category: "admin", order: 220, title_key: "wiki:menu.admin", required_permission: null, enabled: true },
];

beforeEach(() => {
	useAccessStore.getState().setAccessStore([]);
	useAccessStore.getState().reset();
});

describe("access store：方案路由注册菜单归组", () => {
	it("方案行就绪后 main ≥2 按模块归父菜单、admin 挂入底部 /system", () => {
		useAccessStore.getState().setAccessStore(MODULE_ROUTES); // 先登记路由（此时 solutionRoutes 为空，不归组）
		useAccessStore.getState().setSolutionRoutes(SOLUTION_ROWS); // 推送方案行 → 按快照重归并

		const { wholeMenus, bottomMenus } = useAccessStore.getState();
		// 主区：wiki 两条 main 归为一个 solgroup:main:wiki 父项，原两项不再平铺
		expect(wholeMenus.map(m => m.key)).toEqual(["solgroup:main:wiki"]);
		const mainGroup = wholeMenus[0];
		expect(mainGroup?.label).toBe("wiki:menu.group");
		expect(mainGroup?.children?.map(c => c.key)).toEqual(["/space", "/wiki/collections"]);

		// 底部：/system 保留原有子项，并追加 solgroup:admin:wiki（wiki 的 admin 项被摘下移入）
		const [system] = bottomMenus;
		expect(system?.key).toBe("/system");
		expect(system?.children?.map(c => c.key)).toEqual(["/system/user", "solgroup:admin:wiki"]);
		expect(system?.children?.[1]?.label).toBe("wiki:menu.group");
		// admin 项从主区移除
		expect(wholeMenus.map(m => m.key)).not.toContain("/admin");
	});

	it("未推送方案行时菜单保持平铺（开发形态不变，归组为空操作）", () => {
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);

		const { wholeMenus, bottomMenus } = useAccessStore.getState();
		expect(wholeMenus.map(m => m.key)).toEqual(["/space", "/wiki/collections", "/admin"]);
		expect(bottomMenus.map(m => m.key)).toEqual(["/system"]);
	});

	it("清空方案行（端点失败/登出）回落平铺，不残留 solgroup 父项", () => {
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);
		useAccessStore.getState().setSolutionRoutes(SOLUTION_ROWS);
		expect(useAccessStore.getState().wholeMenus.map(m => m.key)).toContain("solgroup:main:wiki");

		useAccessStore.getState().setSolutionRoutes([]); // 端点失败/登出清空

		const { wholeMenus, bottomMenus } = useAccessStore.getState();
		expect(wholeMenus.map(m => m.key)).toEqual(["/space", "/wiki/collections", "/admin"]);
		expect(bottomMenus[0]?.children?.map(c => c.key)).toEqual(["/system/user"]);
	});
});
