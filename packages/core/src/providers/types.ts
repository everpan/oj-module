import type { AppRouteRecordRaw } from "../router/types";

/** 认证契约（v1 api/user/types 同形，蒸馏进 core 使 core 零 v1 依赖） */
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
	permissions?: Array<string>
	[key: string]: unknown
}

/** 认证 provider（v1 P5）：三者全必填全量接管；返回值 provider 自负责，login 失败直接 reject */
export interface AuthProvider {
	login: (payload: LoginInfo) => Promise<AuthType>
	logout: () => Promise<void>
	getUserInfo: () => Promise<UserInfoType>
}

/** 请求头 provider（v1 D-M9）：惰性求值自定义请求头；追加非替换，同名头后写为准 */
export type HeaderProvider = () => Record<string, string>;

/** 通知 provider（v1 D9+G4，仅契约类型——实现宿主注入）：四方法全必填 */
export interface NotificationsApiProvider {
	fetchNotifications: () => Promise<NotificationItem[]>
	markRead: (id: string | number) => Promise<void>
	markAllRead: () => Promise<void>
	clearAll: () => Promise<void>
}

export interface NotificationItem {
	id: string | number
	[key: string]: unknown
}

/** 上传 provider（v1 D9，仅契约类型） */
export interface UploadApiProvider {
	/** 上传 action URL；headers 每次上传动态取（如注入 Bearer） */
	action: string
	headers: () => Record<string, string>
}

/** 后端动态路由 provider——core 移除（路由贡献机制取代），类型仅供宿主侧兼容参考 */
export interface RoutesApiProvider {
	fetchAsyncRoutes: () => Promise<AppRouteRecordRaw[]>
}

/** 系统 API provider（v1 D9，仅契约类型）：角色/菜单类内置 API 全量接管 */
export interface SystemApiProvider {
	fetchRoleList: (query: unknown) => Promise<unknown>
	fetchAddRoleItem: (body: unknown) => Promise<unknown>
	fetchUpdateRoleItem: (body: unknown) => Promise<unknown>
	fetchDeleteRoleItem: (body: unknown) => Promise<unknown>
	fetchRoleMenu: () => Promise<unknown>
	fetchMenuByRoleId: (query: unknown) => Promise<unknown>
	fetchMenuList: (data: unknown) => Promise<unknown>
	fetchAddMenuItem: (data: unknown) => Promise<unknown>
	fetchUpdateMenuItem: (data: unknown) => Promise<unknown>
	fetchDeleteMenuItem: (id: number) => Promise<unknown>
}
