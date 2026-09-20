import type { ReactNode } from "react";
import type { IndexRouteObject, NonIndexRouteObject } from "react-router";

/** 路由元信息（handle），v1 同名同义 */
export interface RouteMeta {
	/** 路由标题（页面标题 / 菜单显示） */
	title: ReactNode
	icon?: ReactNode
	/** 菜单排序 */
	order?: number
	/** 页面级角色权限（满足其一才可访问；不配置则不需要） */
	roles?: string[]
	permissions?: string[]
	/** 页面缓存；false 时进 KeepAlive exclude @default true */
	keepAlive?: boolean
	/**
	 * 布局包裹方式（显式声明，不做隐式推导）：
	 * "container" 完整 chrome / "parent" 父级布局 / "fullscreen" 全屏外壳 /
	 * "none" 不套 / 其余字符串 = 宿主或模块经注册表登记的名字（未知名 warn-once 回落 Outlet）
	 */
	layout?: "container" | "parent" | "fullscreen" | "none" | (string & {})
	/** 登录页标记（仅模块路由受信）；internal = 内置兜底（被外部 login 路由剔除） */
	login?: boolean
	internal?: boolean
	hideInMenu?: boolean
	/** iframe 加载 / 新标签打开的外部链接 */
	iframeLink?: string
	externalLink?: string
	ignoreAccess?: boolean
	/** 动态路由情景下指定当前激活菜单 */
	currentActiveMenu?: string
	/** 路由来自后端接口 */
	backstage?: boolean
}

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
