import type { AppRouteRecordRaw } from "#src/router/types";
import { beforeEach, describe, expect, it } from "vitest";

import { useAccessStore } from "#src/store/access";

/**
 * 回归（2026-09-10）：logout 经 auth store reset() 连带清空 access store
 * 后，模块路由随之消失——宿主链（shell 免登录宿主，无 AuthGuard）没有任何
 * 机制重新登记，重新登录后侧栏菜单永远空白（首次登录正常、登出再登录即
 * 复现）。
 *
 * 不变量（module-loader loadAll 尾部登记处的既有设计）：模块路由与宿主用户
 * 体系解耦——一经登记即持续可用，reset() 不得使其失效。
 */

const MODULE_ROUTES: AppRouteRecordRaw[] = [
	{
		path: "/home",
		handle: { title: "home:menu.home", layout: "container", order: 1 },
		children: [{ index: true, handle: { title: "home:menu.home" }, Component: () => null }],
	},
	{
		path: "/system",
		handle: { title: "system:menu.system", layout: "container", roles: ["admin"] },
		children: [{ path: "/system/user", handle: { title: "system:menu.user" }, Component: () => null }],
	},
];

beforeEach(() => {
	// 快照隔离：恢复到未登记状态（直接改内部快照不可行，用两次调用归零）
	useAccessStore.getState().setAccessStore([]);
	// setAccessStore([]) 会把快照记为 []；再清一次模拟「从未登记」
	useAccessStore.getState().reset();
});

describe("access store reset 保留模块路由登记（回归）", () => {
	it("reset() 后按快照重登记：routeList / wholeMenus / router 不再裸奔", () => {
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);
		expect(useAccessStore.getState().routeList.some(r => r.path === "/home")).toBe(true);

		// 模拟 logout：清空用户/路由状态
		useAccessStore.getState().reset();

		const state = useAccessStore.getState();
		expect(state.isAccessChecked).toBe(true);
		expect(state.routeList.some(r => r.path === "/home")).toBe(true);
		expect(state.routeList.some(r => r.path === "/system")).toBe(true);
		expect(state.wholeMenus.length, "菜单不得因 reset 清空").toBeGreaterThan(0);
	});

	it("从未登记过路由时，reset() 保持初始态（不引入幽灵菜单）", () => {
		// beforeEach 已把快照归零并 reset
		const state = useAccessStore.getState();
		expect(state.routeList.some(r => r.path === "/home")).toBe(false);
		expect(state.isAccessChecked).toBe(false);
	});

	it("重登记后可再次被 setAccessStore 覆盖（App 链 AuthGuard 以最新角色重新合并）", () => {
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);
		useAccessStore.getState().reset();

		const reduced: AppRouteRecordRaw[] = [MODULE_ROUTES[0]!];
		useAccessStore.getState().setAccessStore(reduced);

		const state = useAccessStore.getState();
		expect(state.routeList.some(r => r.path === "/home")).toBe(true);
		expect(state.routeList.some(r => r.path === "/system")).toBe(false);
	});
});
