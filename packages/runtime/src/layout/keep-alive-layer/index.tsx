import { KeepAlive, useKeepAliveRef } from "keepalive-for-react";
import { useEffect, useMemo } from "react";
import { useLocation, useOutlet } from "react-router";

import { getAllRoutePathKeys, getKeepAliveExcludeKeys } from "#src/module-loader";
import { usePreferencesStore } from "#src/store/preferences";
import { useTabsStore } from "#src/store/tabs";

/**
 * KeepAlive 固定层（P2.1）。
 *
 * 设计要点（设计文档 §4.4 / B13 / R9）：
 * - 从 `ContainerLayout → LayoutContent` 上移为 shell 固定层组件，缓存逻辑不再耦合
 *   某个具体布局组件；后续布局去中心化（handle.layout）不会影响缓存是否生效。
 * - `exclude` 改由 module-loader 汇总各模块 `handle.keepAlive` 计算
 *   （`getKeepAliveExcludeKeys`），而非 access store 的 flatRouteList。
 * - 只包裹「页面 outlet」本身：顶部 chrome（header / sidebar / tabbar）在 KeepAlive
 *   之外渲染，因此整站 chrome 不进入缓存，避免切回路由时 chrome 状态错位。
 *
 * 注意：这里刻意不把 KeepAlive 直接包在 LayoutRoot 的 <Outlet/> 外层，否则会把
 * chrome 一起缓存，违背「整站 chrome 不消失 / 状态不错位」的约束。
 */
export default function KeepAliveLayer() {
	const { pathname, search } = useLocation();
	const outlet = useOutlet();
	const aliveRef = useKeepAliveRef();

	const isRefresh = useTabsStore(state => state.isRefresh);
	const openTabs = useTabsStore(state => state.openTabs);
	const tabbarEnable = usePreferencesStore(state => state.tabbarEnable);
	const transitionName = usePreferencesStore(state => state.transitionName);
	const transitionEnable = usePreferencesStore(state => state.transitionEnable);

	/**
	 * to distinguish different pages to cache
	 */
	const cacheKey = useMemo(() => {
		return pathname + search;
	}, [pathname, search]);

	/**
	 * 关闭当前 / 右侧 / 左侧 / 其他 / 全部标签页时，清除对应缓存
	 */
	useEffect(() => {
		const cacheNodes = aliveRef.current?.getCacheNodes?.();
		cacheNodes?.forEach((node) => {
			if (!openTabs.has(node.cacheKey)) {
				aliveRef.current?.destroy(node.cacheKey);
			}
		});
	}, [openTabs, aliveRef]);

	/**
	 * 关闭多 tab 功能时，清空所有非当前页面缓存
	 */
	useEffect(() => {
		if (!tabbarEnable) {
			const cacheNodes = aliveRef.current?.getCacheNodes?.();
			cacheNodes?.forEach((node) => {
				if (node.cacheKey !== cacheKey) {
					aliveRef.current?.destroy(node.cacheKey);
				}
			});
		}
	}, [tabbarEnable, aliveRef, cacheKey]);

	/* KeepAlive 的刷新 */
	useEffect(() => {
		if (tabbarEnable && isRefresh) {
			aliveRef.current?.refresh();
		}
	}, [isRefresh, aliveRef, tabbarEnable]);

	/* 路由设置 keepAlive = false 则不缓存页面 */
	const keepAliveExclude = useMemo(() => {
		/**
		 * 不开启多 tab 时不需要 KeepAlive，把所有路由放进 exclude 仅保留切换动画
		 */
		if (!tabbarEnable) {
			return getAllRoutePathKeys();
		}
		return getKeepAliveExcludeKeys();
	}, [tabbarEnable]);

	return (
		<KeepAlive
			max={20}
			transition
			duration={300}
			cacheNodeClassName={transitionEnable ? `keepalive-${transitionName}` : undefined}
			exclude={keepAliveExclude}
			activeCacheKey={cacheKey}
			aliveRef={aliveRef}
		>
			{outlet}
		</KeepAlive>
	);
}
