import type { ComponentType } from "react";

import type { AppRouteRecordRaw, RouteMeta } from "../types";

import { Outlet } from "react-router";

import { getRegisteredLayout } from "../../layout/layout-registry";

/** 布局解析（v1 P2.2/D9 + G1 重写，PRD §4）：纯注册表，内建名由宿主 bootstrap 登记；未命中 warn-once 回落 Outlet */
const warnedUnknownLayouts = new Set<string>();

export function resolveLayoutComponent(handle?: Partial<RouteMeta>): ComponentType {
	const name = handle?.layout;
	if (!name)
		return Outlet;
	const registered = getRegisteredLayout(name);
	if (registered)
		return registered;
	if (!warnedUnknownLayouts.has(name)) {
		warnedUnknownLayouts.add(name);
		console.warn(
			`[layout] 未知名布局 "${name}"：无宿主/模块登记，回落 Outlet。`,
		);
	}
	return Outlet;
}
/**
 * 递归按 handle.layout 注入布局（v1 P2.7/US-8 重写 + **U7 修复**，PRD §4）。
 * 父级路由：layout 作为其 Component（v1 同）；直挂 Component 的叶子（U7，
 * upstream-requests.md:34,85）：layout 提为其父（path 保留），原页面降为 index
 * 叶子渲染于原 path；"none"/未声明不包裹。纯函数不改原对象；handle 留在
 * 包裹层（flatten 键 = 原 path，keepAlive/菜单语义不变）。
 */
export function resolveRouteLayouts(routes: AppRouteRecordRaw[]): AppRouteRecordRaw[] {
	const out = routes.map((route) => {
		const children = route.children?.length ? resolveRouteLayouts(route.children) : undefined;
		const resolved: Record<string, unknown> = children ? { ...route, children } : { ...route };

		const page = (route as { Component?: ComponentType }).Component;
		const layoutName = route.handle?.layout;
		const layout = layoutName ? getRegisteredLayout(layoutName) : undefined;
		if (layoutName && layoutName !== "none" && layout) {
			if (page && !children) {
				// 叶子包裹（U7）
				delete resolved.Component;
				delete resolved.children;
				delete resolved.index;
				resolved.Component = layout;
				resolved.children = [{ index: true, Component: page }];
			}
			else if (!page && children) {
				// 父级包裹（v1 同形）
				resolved.Component = layout;
			}
		}

		return resolved;
	});
	return out as unknown as AppRouteRecordRaw[];
}
