import type { ComponentType } from "react";
import type { AppRouteRecordRaw, RouteMeta } from "../types";
/**
 * 根据路由 `handle.layout` 解析所用布局组件（P2.2，设计文档 D9；G1 模块登记优先）。
 *
 * 未声明即 `none` 是 D9 的目标态（P2.7 dogfooding 验证后自迁移期默认 `container` 翻转）：
 * 布局必须显式声明，框架不做隐式推导；后端下发的父级路由需在 handle 中携带 layout。
 *
 * 非内建且模块注册表未命中的名字 warn-once 一次并回落 Outlet——
 * 后端下发了模块布局名而提供方模块未加载时，这条 warn 是唯一线索（评审 A6）。
 */
export declare function resolveLayoutComponent(handle?: Partial<RouteMeta>): ComponentType;
/**
 * 递归为缺少 Component 的父级路由按 `handle.layout` 注入布局组件（P2.7，US-8）。
 *
 * 模块路由不再直接 import ContainerLayout / ParentLayout，由框架在
 * module-loader 出口统一包裹；已有 Component 的路由（页面组件）不受影响。
 * 纯函数：返回新路由树，不修改模块 definition 中的原对象。
 */
export declare function resolveRouteLayouts(routes: AppRouteRecordRaw[]): AppRouteRecordRaw[];
