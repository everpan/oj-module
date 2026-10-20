import type { MenuProps } from "antd";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMatches, useNavigate } from "react-router";

import { useCurrentRoute } from "#src/hooks/use-current-route";
import { removeTrailingSlash } from "#src/router/utils/remove-trailing-slash";
import { useAccessStore } from "#src/store/access";

import { useLayout } from "../hooks";
import { findDeepestFirstItem, findRootMenuByPath, translateMenus } from "./utils";

export function useMenu() {
	/* 双段菜单（2026-10-20）：wholeMenus 主区 + bottomMenus 底部固定区。
	 * 底槽菜单面仅 layout-sidebar（侧边导航）单独渲染 bottomNavItems；
	 * 其余形态（双列导航/移动端/全局搜索/顶部导航）合并回落列表末尾，
	 * 保证底部条目不消失、第二列子菜单正常列出。 */
	const wholeMenus = useAccessStore(state => state.wholeMenus);
	const bottomMenus = useAccessStore(state => state.bottomMenus);
	const { isMixedNav, isTwoColumnNav } = useLayout();
	const navigate = useNavigate();
	const { t } = useTranslation();
	const translatedMenus = translateMenus(wholeMenus, t);
	const translatedBottomMenus = translateMenus(bottomMenus, t);
	const bottomBandMenuItems = useMemo(
		() => [...translatedMenus, ...translatedBottomMenus],
		[translatedMenus, translatedBottomMenus],
	);

	const { pathname } = useCurrentRoute();
	const matches = useMatches();
	/**
	 * 混合菜单模式下需要拆分 menu 的 items
	 */
	const shouldSplitMenuItems = useMemo(
		() => isMixedNav || isTwoColumnNav,
		[isMixedNav, isTwoColumnNav],
	);

	/**
	 * 混合导航模式下，侧边导航的顶级菜单 key
	 */
	const sideNavMenuKeyInSplitMode = useMemo(() => {
		if (!shouldSplitMenuItems)
			return "";

		// Try to find active menu from currentActiveMenu first
		const activeMenuPath = matches.findLast(routeItem =>
			routeItem.handle?.currentActiveMenu,
		)?.handle?.currentActiveMenu;

		// Fallback to current pathname if no currentActiveMenu found
		const targetPath = activeMenuPath ? removeTrailingSlash(activeMenuPath) : removeTrailingSlash(pathname);

		const { rootMenuPath } = findRootMenuByPath(bottomBandMenuItems, targetPath);
		return rootMenuPath ?? "";
	}, [shouldSplitMenuItems, pathname, matches, bottomBandMenuItems]);

	/* 混合菜单模式下需要拆分 menu 的 items */
	const splitSideNavItems = useMemo(
		() => {
			const foundMenu = bottomBandMenuItems.find(item => item?.key === sideNavMenuKeyInSplitMode);
			if (!foundMenu) {
				return [];
			}
			return foundMenu?.children ?? [foundMenu];
		},
		[sideNavMenuKeyInSplitMode, bottomBandMenuItems],
	);

	/**
	 * 头部菜单（含底部区条目回落到末尾：顶部导航/双列第一列无底槽）
	 */
	const topNavItems = useMemo(() => {
		if (!shouldSplitMenuItems) {
			return bottomBandMenuItems;
		}
		return bottomBandMenuItems.map((item) => {
			return {
				...item,
				/* children 为空数组，无法触发 menu 的 onSelect 事件 */
				children: undefined,
			};
		});
	}, [shouldSplitMenuItems, bottomBandMenuItems]);

	/**
	 * 侧边菜单（仅主区：底部固定区由侧边栏底槽单独渲染）
	 */
	const sideNavItems = useMemo(() => {
		return shouldSplitMenuItems ? splitSideNavItems : translatedMenus;
	}, [shouldSplitMenuItems, splitSideNavItems, translatedMenus]);

	/**
	 * 底部固定区菜单（主区之后、SiderTrigger 之上渲染）
	 */
	const bottomNavItems = translatedBottomMenus;

	/**
	 * 菜单点击事件处理
	 */
	const handleMenuSelect = (key: string, mode: MenuProps["mode"]) => {
		if (key === removeTrailingSlash(pathname)) {
			return;
		}
		/* 1. 非混合导航模式 2. 混合导航模式下的侧边导航 */
		if (!shouldSplitMenuItems || mode !== "horizontal") {
			// eslint-disable-next-line regexp/no-unused-capturing-group
			if (/http(s)?:/.test(key)) {
				window.open(key);
			}
			else {
				navigate(key);
			}
		}
		else {
			/* 混合导航模式下的顶部导航 */
			const rootMenu = bottomBandMenuItems.find(item => item?.key === key);
			const targetMenu = findDeepestFirstItem(rootMenu?.children ?? []);
			/* 点击顶部的导航默认跳转到菜单下的第一个子项 */
			if (!targetMenu) {
				navigate(key);
			}
			else {
				navigate(targetMenu.key);
			}
		}
	};

	return {
		handleMenuSelect,
		sideNavMenuKeyInSplitMode,
		topNavItems,
		sideNavItems,
		bottomNavItems,
	};
}
