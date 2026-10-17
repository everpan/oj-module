import type { SolutionRouteRow } from "#src/api/rbac/types";

import { create } from "zustand";
import { fetchSolutionRoutes } from "#src/api/rbac";
import { useAccessStore } from "#src/store/access";
import { useAuthStore } from "#src/store/auth";

/**
 * 方案路由归并 store（P1-14，R21 独立缓存 store）。
 *
 * 职责：登录即可只读端点（GET /api/_platform/solutions/routes）的唯一前端消费口——
 * - token 就绪强制重拉一次（首登会话归并补齐；现状菜单登记在登录前且 alreadyRegistered
 *   跳过，无此补拉则首登永久降级为无分类，R21）；
 * - 端点失败/未登录降级空表不炸（按无分类渲染，路由照常，R21 降级不阻断）；
 * - 行就绪即推送 access store（setSolutionRoutes）触发按快照重归并。
 */

interface SolutionRoutesState {
	/** 未 deprecated 方案路由行（降级时为空表） */
	routes: SolutionRouteRow[]
	/** 已完成过一次拉取（成功或失败） */
	loaded: boolean
	refresh: () => Promise<void>
	reset: () => void
}

export const useSolutionRoutes = create<SolutionRoutesState>(set => ({
	routes: [],
	loaded: false,

	refresh: async () => {
		try {
			const routes = await fetchSolutionRoutes();
			set({ routes, loaded: true });
			useAccessStore.getState().setSolutionRoutes(routes);
		}
		catch {
			// 降级空表不炸：按无分类渲染（R21），loaded 置位避免同会话反复重试轰炸
			set({ routes: [], loaded: true });
			useAccessStore.getState().setSolutionRoutes([]);
		}
	},

	reset: () => {
		set({ routes: [], loaded: false });
		useAccessStore.getState().setSolutionRoutes([]);
	},
}));

/**
 * token 就绪监视（R21）：登录成功（token 翻转）强制重拉一次；登出清空行并解除归并。
 * 幂等（armed 防重），模块导入即武装——宿主链（shell 无 AuthGuard）同样生效。
 */
let armed = false;
export function watchTokenReady(): void {
	if (armed) {
		return;
	}
	armed = true;
	let lastToken = useAuthStore.getState().token;
	// 刷新页面时 token 已随 persist 恢复：补拉一次
	if (lastToken) {
		void useSolutionRoutes.getState().refresh();
	}
	useAuthStore.subscribe((state) => {
		if (state.token === lastToken) {
			return;
		}
		lastToken = state.token;
		if (state.token) {
			void useSolutionRoutes.getState().refresh();
		}
		else {
			useSolutionRoutes.getState().reset();
		}
	});
}

watchTokenReady();
