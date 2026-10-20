import type { AppRouteRecordRaw } from "#src/router/types";
import { beforeEach, describe, expect, it } from "vitest";

import { useAccessStore } from "#src/store/access";

/**
 * 双段菜单分区（2026-10-20）：ascending 双段序轴后，access store 按首个
 * 负 order 切分主区/底部固定区——wholeMenus 只含主区（order ≥ 0），
 * bottomMenus 只含底部固定区（order < 0，如 system -100）。
 * 渲染层（layout-sidebar / layout-mixed-sidebar 第二列）把 bottomMenus
 * pin 在侧边栏底部；其余菜单形态经合并列表回落到末尾。
 */

const MODULE_ROUTES: AppRouteRecordRaw[] = [
	{
		path: "/home",
		handle: { title: "home:menu.home", layout: "container", order: 1 },
		children: [{ index: true, handle: { title: "home:menu.home" }, Component: () => null }],
	},
	{
		path: "/about",
		handle: { title: "about:menu.about", layout: "container", order: 120 },
		children: [{ index: true, handle: { title: "about:menu.about" }, Component: () => null }],
	},
	{
		path: "/system",
		handle: { title: "system:menu.system", layout: "container", order: -100 },
		children: [{ path: "/system/user", handle: { title: "system:menu.user" }, Component: () => null }],
	},
];

beforeEach(() => {
	// 快照隔离（同 access-store-reset.test.ts 的归零手法）
	useAccessStore.getState().setAccessStore([]);
	useAccessStore.getState().reset();
});

describe("access store：主区/底部固定区分区", () => {
	it("负 order 路由进 bottomMenus，不进 wholeMenus", () => {
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);

		const { wholeMenus, bottomMenus } = useAccessStore.getState();
		expect(wholeMenus.map(m => m.key)).not.toContain("/system");
		expect(wholeMenus.map(m => m.key)).toContain("/home");
		expect(bottomMenus.map(m => m.key)).toEqual(["/system"]);
	});

	it("bottomMenus 条目保留子菜单（children 不丢）", () => {
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);

		const [system] = useAccessStore.getState().bottomMenus;
		expect(system?.children?.map(c => c.key)).toEqual(["/system/user"]);
	});

	it("全部为正 order 时 bottomMenus 为空表", () => {
		useAccessStore.getState().setAccessStore([MODULE_ROUTES[0]!]);

		const { wholeMenus, bottomMenus } = useAccessStore.getState();
		expect(wholeMenus.map(m => m.key)).toContain("/home");
		expect(bottomMenus).toEqual([]);
	});

	it("reset() 后按快照重登记，分区保持（回归 access-store-reset 不变量）", () => {
		useAccessStore.getState().setAccessStore(MODULE_ROUTES);
		useAccessStore.getState().reset();

		const { wholeMenus, bottomMenus } = useAccessStore.getState();
		expect(bottomMenus.map(m => m.key)).toEqual(["/system"]);
		expect(wholeMenus.map(m => m.key)).toContain("/home");
		expect(wholeMenus.map(m => m.key)).not.toContain("/system");
	});
});
