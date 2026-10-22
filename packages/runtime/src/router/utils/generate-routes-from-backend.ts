import type { AppRouteRecordRaw } from "#src/router/types";
import { createElement, lazy } from "react";
import { Outlet } from "react-router";
import { Iframe } from "#src/components/iframe";
import { menuIcons } from "#src/icons/menu-icons";
import { isString } from "#src/utils/is";
import { addRouteIdByPath } from "./add-route-id-by-path";
import { resolveLayoutComponent } from "./resolve-layout";

const UnknownComponent = lazy(() => import("#src/components/unknown-component"));

/**
 * @zh 异步获取页面组件（仅框架自身 pages；模块页面由模块各自通过 defineModule/manifest 注册，框架不收录）
 * @en Async load page components (framework pages only; module pages are registered by each module via defineModule/manifest, so the framework does NOT glob them)
 */
const pageModules = import.meta.glob([
	"/packages/runtime/src/pages/**/*.tsx",
]);

/**
 * @zh 根据路由获取框架页面组件路径（仅 src/pages；模块页面不在此解析）
 * @en Get framework page component path by route (src/pages only; module pages are resolved elsewhere)
 */
export function getComponentPathByRoute(route: AppRouteRecordRaw & { component?: string }) {
	const routePath = route.path ?? "/";

	// P7.15 / 评审 I24：清理 4ed730d 留下的死分支（两分支同值）。
	// 命中校验已无意义——未命中的路径由调用方落 UnknownComponent
	if (route.component) {
		return `/packages/runtime/src/pages${route.component}`;
	}
	return `/packages/runtime/src/pages${routePath}/index.tsx`;
}

/**
 * @zh 根据后端路由配置生成前端路由
 * @en Generate frontend routes based on backend route configurations
 */
export async function generateRoutesFromBackend(backendRoutes: Array<AppRouteRecordRaw>) {
	const pageModulePaths = Object.keys(pageModules);
	if (!backendRoutes?.length)
		return [];

	/**
	 * @zh 动态加载并设置路由组件
	 * @en Dynamically load and set route components
	 * @param route 路由配置对象
	 * @param componentPath 组件文件路径
	 */
	const loadRouteComponent = async (route: AppRouteRecordRaw, componentPath: string) => {
		const modulePath = componentPath;
		const moduleIndex = pageModulePaths.findIndex(path => path === modulePath);

		if (moduleIndex !== -1) {
			const lazyComponent = pageModules[pageModulePaths[moduleIndex]];
			route.Component = lazy(lazyComponent as any);
		}
		else {
			console.warn(`[Frontend component not found]: ${componentPath}`);
			route.Component = UnknownComponent;
		}
	};

	/**
	 * 转换路由配置
	 * @param route 原始路由配置
	 * @param parentComponentPath 父级组件路径（用于嵌套路由）
	 * @returns 转换后的路由配置
	 */
	const transformRoute = async (route: AppRouteRecordRaw, parentComponentPath?: string): Promise<AppRouteRecordRaw> => {
		const transformedRoute: AppRouteRecordRaw = {
			...route,
			handle: {
				...route.handle,
				backstage: true,
			},
		};

		// P3.3：后端 JSON 只能下发图标名，在此边界统一编译为组件；
		// menu-icons 字符串映射仅存在于这一处，模块路由不走此处
		const iconName = transformedRoute.handle?.icon;
		if (isString(iconName)) {
			if (menuIcons[iconName]) {
				transformedRoute.handle.icon = createElement(menuIcons[iconName]);
			}
			else {
				console.warn(`[backstage-route]: icon "${iconName}" not found in icons/menu-icons.ts`);
				transformedRoute.handle.icon = undefined;
			}
		}

		// 处理 index 路由（继承父级路径）
		if (transformedRoute.index === true && parentComponentPath) {
			await loadRouteComponent(transformedRoute, parentComponentPath);
		}
		// 处理 iframe 路由
		else if (transformedRoute.handle?.iframeLink) {
			transformedRoute.Component = Iframe;
		}
		// 处理外部链接路由
		else if (transformedRoute.handle?.externalLink) {
			// 外部链接不需要组件
		}
		// 处理有子路由的情况
		else if (transformedRoute.children?.length) {
			transformedRoute.Component = parentComponentPath ? Outlet : resolveLayoutComponent(transformedRoute.handle);
		}
		// 处理普通路由
		else {
			await loadRouteComponent(transformedRoute, getComponentPathByRoute(transformedRoute));
		}

		// 递归处理子路由
		if (transformedRoute.children?.length) {
			transformedRoute.children = await Promise.all(
				transformedRoute.children.map(child =>
					transformRoute(child, getComponentPathByRoute(transformedRoute)),
				),
			);
		}

		return transformedRoute;
	};

	/**
	 * 标准化路由配置，确保每个路由都有子路由
	 */
	const normalizeRouteStructure = (route: AppRouteRecordRaw): AppRouteRecordRaw => {
		if (!route.children?.length) {
			return {
				...route,
				children: [{
					index: true,
					handle: { ...route.handle },
				}],
			} as AppRouteRecordRaw;
		}
		return route;
	};

	// 处理路由配置
	const normalizedRoutes = backendRoutes.map(normalizeRouteStructure);
	const transformedRoutes = await Promise.all(
		normalizedRoutes.map(route => transformRoute(route)),
	);

	return addRouteIdByPath(transformedRoutes);
}
