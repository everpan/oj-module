import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { MenuItemType } from "#src/layout/layout-menu/types";
import type { AppRouteRecordRaw } from "#src/router/types";

import { create } from "zustand";
import { rootRoute, router } from "#src/router";
import { ROOT_ROUTE_ID } from "#src/router/constants";
import { baseRoutes } from "#src/router/routes";
import { ascending } from "#src/router/utils/ascending";
import { flattenRoutes } from "#src/router/utils/flatten-routes";
import { generateMenuItemsFromRoutes } from "#src/router/utils/generate-menu-items-from-routes";

import { mergeSolutionCategories } from "#src/router/utils/merge-solution-categories";
import { resolveLoginRoute } from "#src/router/utils/resolve-login-route";

interface AccessState {
	// 路由菜单
	wholeMenus: MenuItemType[]
	// 有权限的 React Router 路由
	routeList: AppRouteRecordRaw[]
	// 扁平化后的路由，路由 id 作为索引 key
	flatRouteList: Record<string, AppRouteRecordRaw>
	// 是否获取到权限
	isAccessChecked: boolean
	// 方案路由行（P1-14/R21）：useSolutionRoutes 就绪后推送，参与归并
	solutionRoutes: SolutionRouteRow[]
}

const initialState: AccessState = {
	wholeMenus: generateMenuItemsFromRoutes(baseRoutes),
	routeList: baseRoutes,
	flatRouteList: flattenRoutes(baseRoutes),
	isAccessChecked: false,
	solutionRoutes: [],
};

/**
 * 最近一次 setAccessStore 登记的路由快照。
 *
 * 模块路由一经登记即持续可用（与宿主用户体系解耦，module-loader loadAll
 * 尾部登记；模块是受信 bundle，登出不撤销信任）。reset() 若只清不还，
 * 宿主链（shell 无 AuthGuard）没有任何机制重登记——logout 后重新登录，
 * 侧栏菜单永远空白（2026-09-10 playground 回归）。
 */
let lastRegisteredRoutes: AppRouteRecordRaw[] = [];

interface AccessAction {
	setAccessStore: (routes: AppRouteRecordRaw[]) => Omit<AccessState, "solutionRoutes">
	/** 方案路由行推送（useSolutionRoutes 就绪/清空时调用），推送后按快照重归并（R21） */
	setSolutionRoutes: (rows: SolutionRouteRow[]) => void
	reset: () => void
};

export const useAccessStore = create<AccessState & AccessAction>((set, get) => ({
	...initialState,

	setAccessStore: (routes) => {
		/* login 模块化（P3）：存在外部 login 模块路由时剔除内置兜底（含 router 重建） */
		const effectiveBase = resolveLoginRoute(baseRoutes, routes, router, rootRoute);
		/* 方案路由三值归并（P1-14/R21）：空表降级原样返回，菜单登记不因端点失败降级 */
		const newRoutes = ascending([...effectiveBase, ...mergeSolutionCategories(routes, get().solutionRoutes)]);
		/* 添加新的路由到根路由 */
		router.patchRoutes(ROOT_ROUTE_ID, routes);
		const flatRouteList = flattenRoutes(newRoutes);
		const wholeMenus = generateMenuItemsFromRoutes(newRoutes);
		const newState = {
			wholeMenus,
			routeList: newRoutes,
			flatRouteList,
			isAccessChecked: true,
		};
		lastRegisteredRoutes = routes;
		set(() => newState);
		return newState;
	},

	setSolutionRoutes: (rows) => {
		set({ solutionRoutes: rows });
		/* 行就绪/清空即按快照重归并（R21：首登会话归并补齐，宿主链无 AuthGuard 也生效） */
		if (lastRegisteredRoutes.length > 0) {
			get().setAccessStore(lastRegisteredRoutes);
		}
	},

	reset: () => {
		/* 移除动态路由 */
		router._internalSetRoutes(rootRoute);
		set(initialState);
		/* 按快照重登记模块路由，恢复「登记即持续可用」不变量。App 链随后由
		 * AuthGuard 以最新用户角色重新合并覆盖；宿主链则依赖此处。 */
		if (lastRegisteredRoutes.length > 0) {
			useAccessStore.getState().setAccessStore(lastRegisteredRoutes);
		}
	},
}));
