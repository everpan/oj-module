import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { AppRouteRecordRaw } from "#src/router/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSolutionRoutes } from "#src/api/rbac";
import { useAccessStore } from "#src/store/access";
import { useAuthStore } from "#src/store/auth";
import { useSolutionRoutes } from "#src/store/solution-routes";

/**
 * BDD：useSolutionRoutes 独立归并 store（R21）。
 * - token 就绪强制重拉一次（首登会话不再永久降级）；
 * - 端点失败降级空表不炸；登出清空；
 * - 行就绪后推送 access store 重归并（hidden 出菜单、category/order 注记上路由表）。
 */

vi.mock("#src/api/rbac", async importOriginal => ({
	...(await importOriginal<typeof import("#src/api/rbac")>()),
	fetchSolutionRoutes: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchSolutionRoutes);

function row(partial: Partial<SolutionRouteRow> & { path: string }): SolutionRouteRow {
	return { module: "demo-market", category: "main", order: 200, title_key: null, required_permission: null, enabled: true, ...partial };
}

const MODULE_ROUTES: AppRouteRecordRaw[] = [
	{ path: "/home", handle: { title: "home:menu.home", order: 100 }, Component: () => null },
	{ path: "/demo", handle: { title: "demo-market:menu.main" }, Component: () => null },
];

beforeEach(() => {
	vi.clearAllMocks();
	useAuthStore.setState({ token: "" });
	mockedFetch.mockResolvedValue([]);
	// 快照隔离：归零登记状态与已推送的方案路由
	useAccessStore.getState().setSolutionRoutes([]);
	useAccessStore.getState().setAccessStore([]);
	useAccessStore.getState().reset();
});

describe("useSolutionRoutes（R21 归并 store）", () => {
	it("refresh 成功：行落 store 并推送 access store 重归并（hidden 出菜单、category/order 注记）", async () => {
		const rows = [row({ path: "/demo", category: "hidden", order: 200 })];
		mockedFetch.mockResolvedValue(rows);
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);

		await useSolutionRoutes.getState().refresh();

		expect(useSolutionRoutes.getState().routes).toEqual(rows);
		expect(useSolutionRoutes.getState().loaded).toBe(true);
		const access = useAccessStore.getState();
		expect(access.routeList.find(r => r.path === "/demo")?.handle.category).toBe("hidden");
		expect(access.routeList.find(r => r.path === "/demo")?.handle.hideInMenu).toBe(true);
		// /home 未匹配方案行 → 不受影响
		expect(access.routeList.find(r => r.path === "/home")?.handle.category).toBeUndefined();
		// hidden 不进菜单（hideInMenu 既有通路）
		expect(access.wholeMenus.some(m => m.key === "/demo")).toBe(false);
		expect(access.wholeMenus.some(m => m.key === "/home")).toBe(true);
	});

	it("端点失败降级空表不炸：行清空、loaded 置位、不抛出", async () => {
		mockedFetch.mockRejectedValueOnce(new Error("network down"));
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);

		await expect(useSolutionRoutes.getState().refresh()).resolves.toBeUndefined();

		expect(useSolutionRoutes.getState().routes).toEqual([]);
		expect(useSolutionRoutes.getState().loaded).toBe(true);
		// 路由照常可达（降级不阻断，R21）
		expect(useAccessStore.getState().routeList.some(r => r.path === "/demo")).toBe(true);
	});

	it("token 就绪强制重拉一次（R21：首登会话归并补齐）；登出清空", async () => {
		mockedFetch.mockResolvedValue([row({ path: "/demo" })]);
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);

		useAuthStore.setState({ token: "tok-1" });
		await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(useAccessStore.getState().routeList.find(r => r.path === "/demo")?.handle.category).toBe("main"));

		useAuthStore.setState({ token: "" });
		await vi.waitFor(() => expect(useSolutionRoutes.getState().routes).toEqual([]));
		expect(mockedFetch).toHaveBeenCalledTimes(1);
	});
});
