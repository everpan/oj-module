import type { ComponentType } from "react";
import type { AppRouteRecordRaw, RouteMeta } from "#src/router/types";

import { Outlet } from "react-router";
import ContainerLayout from "#src/layout/container-layout";
import FullscreenLayout from "#src/layout/fullscreen-layout";
import { getRegisteredLayout } from "#src/layout/layout-registry";
import ParentLayout from "#src/layout/parent-layout";

/**
 * 布局注册表（OCP，P1 由 switch 改为注册表）：新增布局只加注册项，不改解析函数。
 *
 * - `"parent"` → ParentLayout（自身含 Outlet，用于嵌套菜单场景）
 * - `"container"` → ContainerLayout（整站 chrome：header / sidebar / tabbar / footer）
 * - `"fullscreen"` → FullscreenLayout（全屏外壳：视口 + 品牌区 + 工具区 + 页脚，无 chrome）
 * - `"none"` / 未声明 → Outlet（无 chrome，页面 / 子路由直接渲染）
 *
 * 模块登记优先于内建表（G1）：模块可注册新名或覆盖内建名。
 */
const layoutRegistry: Record<string, ComponentType> = {
	parent: ParentLayout,
	container: ContainerLayout,
	fullscreen: FullscreenLayout,
};

/** 未知名布局名的 warn-once 去重集（resolveLayoutComponent 会被反复调用，不去重会刷屏） */
const warnedUnknownLayouts = new Set<string>();

/**
 * 根据路由 `handle.layout` 解析所用布局组件（P2.2，设计文档 D9；G1 模块登记优先）。
 *
 * 未声明即 `none` 是 D9 的目标态（P2.7 dogfooding 验证后自迁移期默认 `container` 翻转）：
 * 布局必须显式声明，框架不做隐式推导；后端下发的父级路由需在 handle 中携带 layout。
 *
 * 非内建且模块注册表未命中的名字 warn-once 一次并回落 Outlet——
 * 后端下发了模块布局名而提供方模块未加载时，这条 warn 是唯一线索（评审 A6）。
 */
export function resolveLayoutComponent(handle?: Partial<RouteMeta>): ComponentType {
	const name = handle?.layout;
	if (!name)
		return Outlet;
	const registered = getRegisteredLayout(name);
	if (registered)
		return registered;
	if (layoutRegistry[name])
		return layoutRegistry[name];
	if (!warnedUnknownLayouts.has(name)) {
		warnedUnknownLayouts.add(name);
		console.warn(
			`[layout] 未知名布局 "${name}"：既非内建（container/parent/fullscreen），`
			+ "也无模块登记，回落 Outlet。",
		);
	}
	return Outlet;
}

/**
 * 递归为缺少 Component 的父级路由按 `handle.layout` 注入布局组件（P2.7，US-8）。
 *
 * 模块路由不再直接 import ContainerLayout / ParentLayout，由框架在
 * module-loader 出口统一包裹；已有 Component 的路由（页面组件）不受影响。
 * 纯函数：返回新路由树，不修改模块 definition 中的原对象。
 */
export function resolveRouteLayouts(routes: AppRouteRecordRaw[]): AppRouteRecordRaw[] {
	return routes.map((route) => {
		const resolved = !route.Component && route.children?.length
			? { ...route, Component: resolveLayoutComponent(route.handle) }
			: route;
		return resolved.children?.length
			? { ...resolved, children: resolveRouteLayouts(resolved.children) }
			: resolved;
	});
}
