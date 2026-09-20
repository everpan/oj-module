import type { AppRouteRecordRaw } from "../router/types";
import type { ModuleDefinition } from "../types";

import { flattenRoutes } from "../router/utils/flatten-routes";

/** 汇总一组模块定义里的全部路由（供扁平化与 exclude 计算） */
function collectAllRoutes(definitions: ModuleDefinition[]): AppRouteRecordRaw[] {
	const routes: AppRouteRecordRaw[] = [];
	for (const definition of definitions) {
		routes.push(...definition.routes);
	}
	return routes;
}

/**
 * 纯函数：收集 `handle.keepAlive === false` 的路由 key。键与 flattenRoutes 一致，
 * 与 KeepAlive 的 activeCacheKey（= pathname）精确匹配。缓存是否排除只取决于
 * 「模块声明」（v1 B13/R9 直蒸）。
 */
export function collectKeepAliveExcludes(routes: AppRouteRecordRaw[]): string[] {
	const flat = flattenRoutes(routes);
	return Object.entries(flat).reduce<string[]>((acc, [key, value]) => {
		if (value.handle?.keepAlive === false) {
			acc.push(key);
		}
		return acc;
	}, []);
}

/** 纯函数：收集所有路由 key（关闭多 tab 时整体排除，仅保留切换动画） */
export function collectAllRoutePaths(routes: AppRouteRecordRaw[]): string[] {
	return Object.keys(flattenRoutes(routes));
}

/** 基于一组模块定义计算 exclude key */
export function getKeepAliveExcludes(definitions: ModuleDefinition[]): string[] {
	return collectKeepAliveExcludes(collectAllRoutes(definitions));
}

/** 基于一组模块定义计算全部路由 key */
export function getAllRoutePaths(definitions: ModuleDefinition[]): string[] {
	return collectAllRoutePaths(collectAllRoutes(definitions));
}
