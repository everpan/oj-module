import type { AppRouteRecordRaw } from "../types";

/** 路由扁平化：键为路由 path，值为路由对象（index 路由键 = 父 path + "/"） */
export function flattenRoutes(routes: AppRouteRecordRaw[]) {
	const result: Record<string, AppRouteRecordRaw> = {};

	function traverse(items: AppRouteRecordRaw[], parent?: AppRouteRecordRaw) {
		items.forEach((item) => {
			if (item.index && parent?.path) {
				result[`${parent.path}/`] = item;
			}
			if (item.path) {
				result[item.path] = item;
			}
			if (item.children && item.children.length > 0) {
				traverse(item.children, item);
			}
		});
	}

	traverse(routes);
	return result;
}
