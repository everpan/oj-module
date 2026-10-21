import type { AppRouteRecordRaw } from "#src/router/types";

/**
 * admin 路由真重写（0.2.17，单根模块约定 + menu.main 统一）：
 *
 * 将 `category==="admin"` 的路由子树「真重写」为 `/system/<模块 root path>/*`：
 * - 摘除其在原父树中的位置，hoist 到顶层（与模块 root 平级），使运行时 URL 真正变为
 *   `/system/<moduleRoot>/...`（而非仍挂 `/wiki` 下、仅菜单挪到 /system 的视觉假象）；
 * - `<模块 root path>` 取该模块根路由的绝对路径（单根约定下即顶层路由 path），
 *   admin 路径后缀（root 之后的部分）原样保留，故无论 admin 嵌套多深都能正确重写；
 * - 非突变：返回新路由数组，未变动分支复用原引用（react-router patchRoutes 接收）。
 *
 * 重写后的 admin 路由是根级绝对路径路由，由 groupSolutionMenus 在视觉层将其
 * 归组进 /system 菜单（子组 key `solgroup:admin:<module>`，label `<module>:menu.main`），
 * 本函数不改写宿主 /system 路由树本身。
 */
const SYSTEM_KEY = "/system";

/** 解析路由绝对路径（与 generate-menu-items-from-routes 同语义） */
function resolveAbs(path: string | undefined, parentAbs: string): string {
	if (!path)
		return parentAbs;
	return path.startsWith("/") ? path : `${parentAbs.replace(/\/+$/, "")}/${path}`;
}

export function rewriteAdminPaths(
	routes: AppRouteRecordRaw[],
	systemKey = SYSTEM_KEY,
): AppRouteRecordRaw[] {
	const hoisted: AppRouteRecordRaw[] = [];
	const kept = routes
		.map(r => processRoute(r, "/", systemKey, hoisted, undefined))
		.filter((r): r is AppRouteRecordRaw => r !== null);
	return [...kept, ...hoisted];
}

function processRoute(
	route: AppRouteRecordRaw,
	parentAbs: string,
	systemKey: string,
	hoisted: AppRouteRecordRaw[],
	moduleRootAbs: string | undefined,
): AppRouteRecordRaw | null {
	const abs = resolveAbs(route.path, parentAbs);
	const rootAbs = moduleRootAbs ?? abs; // 顶层路由即模块 root

	if (route.handle?.category === "admin") {
		// 真重写：/system + 模块 root 路径 + 原后缀（保留 admin 子树内的相对层级）
		const suffix = abs.slice(rootAbs.length) || "";
		const newAbs = `${systemKey}${rootAbs}${suffix}`;
		hoisted.push({ ...route, path: newAbs });
		return null; // 从原树摘除
	}

	if (!route.children || route.children.length === 0) {
		return { ...route };
	}

	const newChildren: AppRouteRecordRaw[] = [];
	for (const c of route.children) {
		const processed = processRoute(c, abs, systemKey, hoisted, rootAbs);
		if (processed !== null)
			newChildren.push(processed);
	}
	// 复用 tagModuleRoutes 的写法：先 spread 再赋值 children，规避 union 字面量类型问题
	const result: AppRouteRecordRaw = { ...route };
	result.children = newChildren;
	return result;
}
