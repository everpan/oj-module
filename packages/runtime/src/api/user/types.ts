import type { AppRouteRecordRaw } from "#src/router/types";

export interface AuthType {
	token: string
	refreshToken: string
}

export interface LoginInfo {
	username: string
	password: string
	/**
	 * 登录方式：local=本地口令（默认），ldap=目录登录；sso 走重定向不参与本载荷。
	 * 仅用于把 POST 路由到正确后端端点（auth/login vs auth/ldap-login），默认 local。
	 */
	method?: "local" | "ldap" | "sso"
}

export interface UserInfoType {
	id: string
	avatar: string
	username: string
	email: string
	phoneNumber: string
	description: string
	roles: Array<string>
	/** 权限码列表（后端下发；模块级 requiredPermissions 门禁消费，P7.12） */
	permissions?: Array<string>
	/** 首登须改密（AC1-27；后端 web/user-info 下发） */
	mustChange?: boolean
	// 路由可以在此处动态添加
	menus?: AppRouteRecordRaw[]
}

export interface AuthListProps {
	label: string
	name: string
	auth: string[]
}
