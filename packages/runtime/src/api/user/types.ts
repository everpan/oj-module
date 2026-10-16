import type { AppRouteRecordRaw } from "#src/router/types";

export interface AuthType {
	token: string
	refreshToken: string
}

export interface LoginInfo {
	username: string
	password: string
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
