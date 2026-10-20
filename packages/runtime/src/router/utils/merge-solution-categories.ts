import type { SolutionRouteRow } from "#src/api/rbac/types";
import type { AppRouteRecordRaw } from "#src/router/types";

/**
 * 归并产物：路由 + 方案分类注记（P1-14/R21 三值归并）。
 * 形状与 AppRouteRecordRaw 相同，handle 上多出 category（及 hideInMenu/order 覆写）。
 */
export type AnnotatedRoute = AppRouteRecordRaw;

/**
 * 方案路由归并（纯函数，R21）：按 path 把 sys_solution_route 行注记到已注册路由上。
 *
 * - 三值 category 原样落 handle.category（main=常规组、admin=管理组、hidden=不进菜单）；
 * - hidden 与 enabled=0（禁用）复用既有 hideInMenu 通路——只过滤菜单层，路由仍可达
 *   （禁用的路由摘除归装载层三处同写，D12）；
 * - order 覆写为声明序（2026-10-20 双段序轴）：框架常规项 ≥0 升序、管理面负数入
 *   底部固定区（pin 侧边栏底部，ascending 双段排序）、方案项从 200 起编，共用一条序轴；
 *   同 order 按根 path 字母序；
 * - 未匹配路由（框架/后端）原样保留（同一对象引用），入参不突变；
 * - solRoutes 为空（端点失败/未登录降级空表）时原样返回——降级不阻断，路由照常。
 *
 * title 不在此覆写：entry.ts 是模块元数据唯一来源（module-loader 既有惯例），
 * title_key 随行下发仅供深检对比。
 */
export function mergeSolutionCategories(routes: AppRouteRecordRaw[], solRoutes: SolutionRouteRow[]): AnnotatedRoute[] {
	if (solRoutes.length === 0) {
		return routes;
	}
	const byPath = new Map(solRoutes.map(r => [r.path, r]));
	return routes.map((route) => {
		const row = route.path ? byPath.get(route.path) : undefined;
		if (!row) {
			return route;
		}
		return {
			...route,
			handle: {
				...route.handle,
				category: row.category,
				order: row.order,
				hideInMenu: row.category === "hidden" || !row.enabled || (route.handle.hideInMenu ?? false),
			},
		};
	});
}
