import type { AppRouteRecordRaw } from "../types";

/**
 * 为路由补 id（默认 = 绝对路径），替代自动生成 id：
 * 菜单 key 生成同规则，保证 id 与菜单 key 同一空间（match.id 才能命中菜单项）。
 * index 路由 id = 父路径 + "/"。
 */
export function addRouteIdByPath(routes: AppRouteRecordRaw[], parentId = "") {
	return routes.map((route) => {
		const absolutePath = route.path && !route.path.startsWith("/")
			? `${parentId.replace(/\/+$/, "")}/${route.path}`
			: route.path;
		const newRoute = { ...route, id: route.index ? `${parentId}/` : absolutePath };

		if (newRoute.children && newRoute.children.length > 0) {
			newRoute.children = addRouteIdByPath(newRoute.children, absolutePath ?? parentId);
		}

		return newRoute;
	});
}
