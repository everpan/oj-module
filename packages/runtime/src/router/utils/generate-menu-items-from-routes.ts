import type { MenuItemType } from "#src/layout/layout-menu/types";
import type { AppRouteRecordRaw } from "#src/router/types";

import { createElement } from "react";
import { Link } from "react-router";

/**
 * 解析菜单 key 为绝对路径。
 *
 * react-router 允许子路由使用相对 path（如父 "/demo" 下的 "detail"），但菜单
 * 点击导航 navigate(key) 需要绝对路径——相对 key（"detail"）会被按当前路由
 * 解析（/system/dept 下点击 → /system/detail），落 404。
 */
function resolveMenuKey(path: string | undefined, parentPath: string): string {
	if (!path)
		return parentPath;
	// 以 "/" 开头已是绝对路径；否则拼接父路径（父尾斜杠归一，避免 "//"）
	return path.startsWith("/") ? path : `${parentPath.replace(/\/+$/, "")}/${path}`;
}

/**
 * 根据路由列表生成菜单项数组
 *
 * @param routeList 路由列表，类型为 AppRouteRecordRaw 数组
 * @param parentPath 父路由绝对路径（递归用，顶层为 "/"）
 * @returns 返回菜单项数组，数组元素类型为 MenuItemType
 */
export function generateMenuItemsFromRoutes(
	routeList: AppRouteRecordRaw[],
	parentPath = "/",
): MenuItemType[] {
	return routeList.reduce<MenuItemType[]>((acc, item) => {
		const handle = item.handle;
		const label = handle?.title;
		const externalLink = handle?.externalLink;
		const icon = handle?.icon;
		const absolutePath = resolveMenuKey(item.path, parentPath);

		const menuItem: MenuItemType = {
			key: absolutePath,
			label: externalLink
				? createElement(
					Link,
					{
						// 阻止事件冒泡，防止触发菜单的点击事件
						onClick: (e) => {
							e.stopPropagation();
						},
						to: externalLink,
						target: "_blank",
						rel: "noopener noreferrer",
					},
					label,
				)
				: (
					label
				),
		};
		// P3.3：icon 契约为 ReactNode，直接透传；
		// 后端字符串图标已在 generateRoutesFromBackend 边界编译
		if (icon) {
			menuItem.icon = icon;
		}
		// 0.2.16 R2：归组自描述——把 handle 的 module/category/order 透传到菜单项，
		// 使 groupSolutionMenus 不再依赖宿主 DB 行。
		if (handle?.module)
			menuItem.module = handle.module;
		if (handle?.category)
			menuItem.category = handle.category;
		if (handle?.order !== undefined)
			menuItem.order = handle.order;
		if (Array.isArray(item.children) && item.children.length > 0) {
			// 过滤掉非首页，且不显示在菜单中的路由
			const noIndexRoute = item.children.filter(route => !route.index && !route?.handle?.hideInMenu && route?.handle?.category !== "hidden");
			if (noIndexRoute.length > 0) {
				menuItem.children = generateMenuItemsFromRoutes(noIndexRoute, absolutePath);
			}
		}
		// 0.2.16 R2：hidden 优先——handle.category==="hidden" 与显式 hideInMenu 等价，均不进菜单
		if (handle?.hideInMenu || handle?.category === "hidden") {
			return acc;
		}
		return [...acc, menuItem];
	}, []);
}
