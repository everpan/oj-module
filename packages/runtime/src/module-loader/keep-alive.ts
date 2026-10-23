import type { AppRouteRecordRaw } from "#src/router/types";
import type { ModuleDefinition } from "./types";

/** 汇总一组模块定义里的全部路由（供扁平化与 exclude 计算） */
function collectAllRoutes(definitions: ModuleDefinition[]): AppRouteRecordRaw[] {
	const routes: AppRouteRecordRaw[] = [];
	for (const definition of definitions) {
		routes.push(...definition.routes);
	}
	return routes;
}

/**
 * 绝对路径求解：绝对 path 原样；相对 path 拼父层；index（无 path）即父层本身。
 * 规则同 addRouteIdByPath / generateMenuItemsFromRoutes / rewriteAdminPaths 的
 * resolveAbs——解决方案模块一律相对路径声明（安装时方可加 prefix 于顶层），
 * 运行时绝对路径由此规则涌现，exclude key 必须落进同一空间才能与
 * activeCacheKey（= pathname）匹配。
 */
function resolveAbsPath(path: string | undefined, parentAbs: string): string {
	if (!path)
		return parentAbs;
	return path.startsWith("/") ? path : `${parentAbs.replace(/\/+$/, "")}/${path}`;
}

/**
 * 纯函数：从一组路由中收集 `handle.keepAlive === false` 的路由 key。
 * key = 路由绝对路径，与 activeCacheKey（= pathname）匹配。
 *
 * 这是 P2.1 把 exclude 计算从 access store 的 `flatRouteList` 反转到
 * module-loader 的核心：缓存是否排除只取决于「模块声明」，不再依赖某条路由
 * 是否套了 ContainerLayout（见设计文档 B13 / R9）。
 */
export function collectKeepAliveExcludes(routes: AppRouteRecordRaw[]): string[] {
	const out: string[] = [];
	const walk = (items: AppRouteRecordRaw[], parentAbs: string) => {
		for (const item of items) {
			const abs = resolveAbsPath(item.path, parentAbs);
			// index 路由的缓存键 = 父层绝对路径（activeCacheKey 无尾斜杠，
			// 不能沿用 flattenRoutes 的 `${parent}/` 形态）
			const key = item.index ? parentAbs : abs;
			if (item.handle?.keepAlive === false)
				out.push(key);
			if (item.children?.length)
				walk(item.children, abs);
		}
	};
	walk(routes, "");
	return out;
}

/**
 * 纯函数：收集所有路由 key（关闭多 tab 时用于整体排除，仅保留切换动画）。
 * 与 collectKeepAliveExcludes 同一套绝对 key 口径（tab 关闭分支的 exclude
 * 自此真正有意义），按出现序去重。
 */
export function collectAllRoutePaths(routes: AppRouteRecordRaw[]): string[] {
	const seen = new Set<string>();
	const walk = (items: AppRouteRecordRaw[], parentAbs: string) => {
		for (const item of items) {
			const abs = resolveAbsPath(item.path, parentAbs);
			seen.add(item.index ? parentAbs : abs);
			if (item.children?.length)
				walk(item.children, abs);
		}
	};
	walk(routes, "");
	return [...seen];
}

/** 基于一组模块定义计算 exclude key（供单元测试） */
export function getKeepAliveExcludes(definitions: ModuleDefinition[]): string[] {
	return collectKeepAliveExcludes(collectAllRoutes(definitions));
}

/** 基于一组模块定义计算全部路由 key（供单元测试） */
export function getAllRoutePaths(definitions: ModuleDefinition[]): string[] {
	return collectAllRoutePaths(collectAllRoutes(definitions));
}
