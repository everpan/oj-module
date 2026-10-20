import type { AppRouteRecordRaw } from "#src/router/types";

/**
 * 按照路由中 order 升序来排序路由（双段序轴，2026-10-20）：
 *   - order >= 0：主菜单区，升序在前；
 *   - order < 0 ：底部固定区，升序在后（-2 在 -1 上面）——渲染层
 *     （layout-sidebar / layout-mixed-sidebar 第二列）把这一段 pin 在
 *     侧边栏底部，其余菜单形态按列表末尾回落；
 *   - 未声明 order：沿用数组下标兜底（下标 + 2）。order: 0 是合法值，
 *     用 ?? 判定（历史实现用 ||，0 会被误当「未设置」改写成兜底值）。
 */
export function ascending(arr: AppRouteRecordRaw[]) {
	const normalized = arr.map((routeItem, routeIndex) => ({
		...routeItem,
		handle: {
			...routeItem.handle,
			// 当 order 不存在时，根据顺序自动创建
			order: routeItem?.handle?.order ?? routeIndex + 2,
		},
	}));
	const byOrder = (a: AppRouteRecordRaw, b: AppRouteRecordRaw) => {
		const delta = (a.handle.order ?? 0) - (b.handle.order ?? 0);
		// order 相同按根 path 字母序稳定排列（2026-10-20 用户裁决），
		// 避免同 order 条目受登记顺序漂移影响
		if (delta !== 0)
			return delta;
		return (a.path ?? "").localeCompare(b.path ?? "");
	};
	return [
		...normalized.filter(routeItem => (routeItem.handle.order ?? 0) >= 0).sort(byOrder),
		...normalized.filter(routeItem => (routeItem.handle.order ?? 0) < 0).sort(byOrder),
	];
}
