import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { AppRouteRecordRaw } from "#src/router/types";
import { beforeEach, describe, expect, it } from "vitest";

import { useAccessStore } from "#src/store/access";

/**
 * 接入层归组回归（0.2.17 单根模块约定 + menu.main 统一）：
 * setAccessStore 在登记前先 rewriteAdminPaths（admin 真重写 /system/<root>/*），
 * 随后登记菜单时调用 groupSolutionMenus（取消 flat main、递归 admin 挂入 /system）。
 * 真正触发归组的时机是 useSolutionRoutes 就绪后 setSolutionRoutes 按快照重归并（R21），
 * 故测试走「先登记路由、再推送方案行」的真实时序；dev 零行时靠 handle 元数据归组。
 */

const NULL = () => null;

// 单根模块（wiki 形态）：根 /wiki，子项 space/collections（main）/admin（admin，含 contacts 子项）
const MODERN_ROUTES: AppRouteRecordRaw[] = [
	{
		path: "wiki",
		handle: { title: "wiki:menu.main", layout: "container", order: 201 },
		children: [
			{ path: "space", handle: { title: "wiki:menu.space", layout: "container", order: 200, category: "main", module: "wiki" }, children: [{ index: true, handle: { title: "wiki:menu.space" }, Component: NULL }] },
			{ path: "collections", handle: { title: "wiki:menu.collections", layout: "container", order: 210, category: "main", module: "wiki" }, children: [{ index: true, handle: { title: "wiki:menu.collections" }, Component: NULL }] },
			{ path: "admin", handle: { title: "wiki:menu.admin", layout: "container", order: 220, category: "admin", module: "wiki" }, children: [{ path: "contacts", handle: { title: "wiki:menu.contacts", module: "wiki" }, Component: NULL }] },
		],
	},
	{
		path: "/system",
		handle: { title: "system:menu.system", layout: "container", order: -100 },
		children: [{ path: "/system/user", handle: { title: "system:menu.user" }, Component: NULL }],
	},
];

// 旧态（无 handle 声明，category/module 全靠宿主行）
const LEGACY_ROUTES: AppRouteRecordRaw[] = [
	{
		path: "wiki",
		handle: { title: "wiki:menu.main", layout: "container", order: 201 },
		children: [
			{ path: "space", handle: { title: "wiki:menu.space", layout: "container", order: 200 }, children: [{ index: true, handle: { title: "wiki:menu.space" }, Component: NULL }] },
			{ path: "collections", handle: { title: "wiki:menu.collections", layout: "container", order: 210 }, children: [{ index: true, handle: { title: "wiki:menu.collections" }, Component: NULL }] },
			{ path: "admin", handle: { title: "wiki:menu.admin", layout: "container", order: 220 }, children: [{ path: "contacts", handle: { title: "wiki:menu.contacts" }, Component: NULL }] },
		],
	},
	{
		path: "/system",
		handle: { title: "system:menu.system", layout: "container", order: -100 },
		children: [{ path: "/system/user", handle: { title: "system:menu.user" }, Component: NULL }],
	},
];

// 迁移后行：admin 路径须随真重写同步为 /system/wiki/admin（R6 回退层不补偿路径）
const MIGRATED_ROWS: SolutionRouteRow[] = [
	{ path: "/system/wiki/admin", module: "wiki", category: "admin", order: 220, title_key: "wiki:menu.admin", required_permission: null, enabled: true },
];

beforeEach(() => {
	useAccessStore.getState().setAccessStore([]);
	useAccessStore.getState().reset();
});

describe("access store：handle 声明优先归组（0.2.17 真重写 + 取消 flat main）", () => {
	it("dev 零行也归组：admin 真重写挂入 /system（label=wiki:menu.main、压平 contacts），main 不归父菜单", () => {
		useAccessStore.getState().setAccessStore(MODERN_ROUTES);
		useAccessStore.getState().setSolutionRoutes([]); // dev 形态：无行

		const { wholeMenus, bottomMenus, routeList } = useAccessStore.getState();

		// 主区：/wiki 根菜单直出，子项 space/collections 平铺（无 solgroup:main 父项）
		expect(wholeMenus.map(m => m.key)).toEqual(["/wiki"]);
		const wikiRoot = wholeMenus[0];
		expect(wikiRoot?.children?.map(c => c.key)).toEqual(["/wiki/space", "/wiki/collections"]);

		// admin 已被真重写：路由表中出现 /system/wiki/admin，原 /wiki/admin 已摘除
		expect(routeList.some(r => r.path === "/system/wiki/admin")).toBe(true);
		expect(wikiRoot?.children?.map(c => c.key)).not.toContain("/wiki/admin");

		// 底部：/system 保留原有子项，并追加 solgroup:admin:wiki（label=wiki:menu.main）
		const [system] = bottomMenus;
		expect(system?.key).toBe("/system");
		expect(system?.children?.map(c => c.key)).toEqual(["/system/user", "solgroup:admin:wiki"]);
		const adminGroup = system?.children?.find(c => c.key === "solgroup:admin:wiki");
		expect(adminGroup?.label).toBe("wiki:menu.main");
		// 压平 admin 中间级：contacts 直挂子组下
		expect(adminGroup?.children?.map(c => c.key)).toEqual(["/system/wiki/admin/contacts"]);
	});
});

describe("access store：行回退归组（迁移后行路径随真重写同步）", () => {
	it("推送迁移后行（admin 路径=/system/wiki/admin）仍归组，结果与 handle 声明一致（无漂移）", () => {
		useAccessStore.getState().setAccessStore(MODERN_ROUTES);
		useAccessStore.getState().setSolutionRoutes(MIGRATED_ROWS);

		const handleResult = {
			top: useAccessStore.getState().wholeMenus.map(m => m.key),
			bottom: useAccessStore.getState().bottomMenus[0]?.children?.map(c => c.key),
		};

		useAccessStore.getState().reset();
		useAccessStore.getState().setAccessStore(MODERN_ROUTES);
		useAccessStore.getState().setSolutionRoutes([]); // dev 零行（handle 真源）
		const rowResult = {
			top: useAccessStore.getState().wholeMenus.map(m => m.key),
			bottom: useAccessStore.getState().bottomMenus[0]?.children?.map(c => c.key),
		};

		expect(handleResult).toEqual(rowResult);
	});

	it("无 handle 声明且无行：不归组（admin 留原树位置，旧态平铺）", () => {
		useAccessStore.getState().setAccessStore(LEGACY_ROUTES); // 无 handle.category，未推送行
		const { wholeMenus, bottomMenus } = useAccessStore.getState();
		// legacy 无 handle.category → 不被真重写、不被归组：admin 仍在 /wiki 下
		const wikiRoot = wholeMenus.find(m => m.key === "/wiki");
		expect(wikiRoot?.children?.map(c => c.key)).toEqual(["/wiki/space", "/wiki/collections", "/wiki/admin"]);
		expect(bottomMenus[0]?.children?.map(c => c.key)).toEqual(["/system/user"]); // 无 admin 组
	});
});
