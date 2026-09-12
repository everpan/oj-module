import type { ReactNode } from "react";
import type { IndexRouteObject, NonIndexRouteObject, createBrowserRouter as RemixRouter } from "react-router";

export interface IndexRouteMeta extends Omit<IndexRouteObject, "id"> {
	redirect?: string
	handle: RouteMeta
}
export interface NonIndexRouteMeta extends Omit<NonIndexRouteObject, "id"> {
	redirect?: string
	handle: RouteMeta
	children?: AppRouteRecordRaw[]
}

export type AppRouteRecordRaw = IndexRouteMeta | NonIndexRouteMeta;

export interface RouteMeta {
	/**
	 * 路由标题，通常用于页面标题或者侧边栏菜单显示
	 */
	title: ReactNode

	/**
	 * 菜单图标，用于侧边栏菜单项的图标显示
	 */
	icon?: ReactNode

	/**
	 * 菜单排序，用于控制侧边栏菜单的显示顺序
	 */
	order?: number

	/**
	 * 用于配置页面的权限，只有拥有对应权限的用户才能访问页面，不配置则不需要权限。
	 */
	roles?: string[]

	/**
	 * 页面内按钮级别的权限，用于控制页面内按钮的显示和隐藏
	 */
	permissions?: string[]

	/**
	 * 设置页面是否开启缓存，开启后页面会缓存，不会重新加载，仅在标签页启用时有效。
	 * @default true
	 */
	keepAlive?: boolean

	/**
	 * 布局包裹方式（P2.2，设计文档 D9）。显式声明，不做隐式推导。
	 * - `"container"`：套完整 chrome（header / sidebar / tabbar / content）
	 * - `"parent"`：套父级布局（自身含 Outlet，用于嵌套菜单场景）
	 * - `"fullscreen"`：套全屏外壳（视口 + 品牌区 + 角落工具 + 页脚，无 chrome），登录页用（P1）
	 * - `"none"`：不套任何布局，页面/子路由直接渲染
	 * - 其他字符串：模块经 `ctx.register.layout` 登记的名字（含覆盖内建名）。
	 *   模板联合保留内建名补全，未知名运行时 warn-once 并回落 Outlet（G1，评审 P2-6）
	 * @default "container"（迁移期向后兼容，目标在 P2.7 补全显式声明后改为 `"none"`）
	 */
	layout?: "container" | "parent" | "fullscreen" | "none" | (string & {})

	/**
	 * 登录页标记（login 模块化，P1）：声明在 `path: "/login"` 的模块路由上，
	 * 供 resolveLoginRoute 识别并剔除内置兜底。仅模块路由受信，后端路由忽略。
	 */
	login?: boolean

	/**
	 * 内置兜底标记（login 模块化，P1）：框架内置登录页专用，
	 * 存在外部 login 模块路由时被 resolveLoginRoute 剔除。
	 */
	internal?: boolean

	/**
	 * 是否在菜单中隐藏，用于控制某些路由不在侧边栏菜单中显示
	 */
	hideInMenu?: boolean

	/**
	 * iframe链接，如果路由需要在iframe中加载外部页面时使用
	 */
	iframeLink?: string

	/**
	 * 外部链接，点击后直接在新标签页中打开
	 */
	externalLink?: string

	/**
	 * 用于配置页面是否忽略权限，直接可以访问
	 */
	ignoreAccess?: boolean

	/**
	 * @description 指定当前激活的菜单，适用于动态路由情景下激活父菜单
	 * @example 从父路由 '/user/info' 导航到子路由 '/user/info/1' 时，可以手动手动指定以高亮显示父菜单 '/user/info'
	 */
	currentActiveMenu?: string

	/**
	 * 当前路由为请求后端接口得到的
	 */
	backstage?: boolean
}

export type ReactRouterType = ReturnType<typeof RemixRouter>;
export type RouterSubscriber = Parameters<ReactRouterType["subscribe"]>[0];
export type RouterState = ReactRouterType["state"];
export type RouterNavigate = ReactRouterType["navigate"];

// 使用类型别名提取公共类型
export type RouteFileModule = Record<string, { default: AppRouteRecordRaw[] }>;
