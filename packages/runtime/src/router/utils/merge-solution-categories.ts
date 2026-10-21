import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { AppRouteRecordRaw } from "#src/router/types";

/**
 * 归并产物：路由 + 方案分类注记（P1-14/R21 三值归并）。
 * 形状与 AppRouteRecordRaw 相同，handle 上多出 category（及 hideInMenu/order 覆写）。
 */
export type AnnotatedRoute = AppRouteRecordRaw;

/**
 * 方案路由归并（纯函数，R21 / 0.2.16 收窄）：DB 行仅作为「管理覆写层」。
 *
 * 0.2.16 起 `category`/`order`/`module` 已是路由 handle 真源（作者声明 + module-loader 注入，
 * 见 R1/R2），不再由本函数从行注写。本函数只保留一项管理语义：
 *
 * - **禁用覆写**：行 `enabled === false`（或 deprecated）时追加 `hideInMenu: true`，
 *   使该菜单项不可见（路由仍可达，D12 口径——禁用在装载层三处同写）；
 * - 其余字段（category/order/module/title）一律不覆写，保持 handle 原值；
 * - 入参不突变（未命中行或无需覆写时返回同一对象引用）；
 * - solRoutes 为空（端点失败/未登录/dev 零行降级）时原样返回——降级不阻断，路由照常。
 */
export function mergeSolutionCategories(routes: AppRouteRecordRaw[], solRoutes: SolutionRouteRow[]): AnnotatedRoute[] {
	if (solRoutes.length === 0) {
		return routes;
	}
	const byPath = new Map(solRoutes.map(r => [r.path, r]));
	return routes.map((route) => {
		const row = route.path ? byPath.get(route.path) : undefined;
		if (!row || row.enabled !== false)
			return route;
		// 仅禁用态：追加 hideInMenu（与既有 handle.hideInMenu / category==="hidden" 取并集）
		return {
			...route,
			handle: {
				...route.handle,
				hideInMenu: true,
			},
		};
	});
}
