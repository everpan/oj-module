// RBAC 域类型（与模板 api 的 service 输出对齐，snake_case 线格式）。
export interface RbacRole {
	name: string
	module: string
	title: string | null
	description: string | null
	builtin: boolean
	deprecated: boolean
	holders: number
	permissions: string[]
}

export interface RbacPermission {
	code: string
	module: string
	title_key: string | null
	deprecated: boolean
}

export interface RbacUser {
	id: number
	username: string
	display_name: string | null
	email: string | null
	is_forbidden: boolean
	must_change: boolean
	roles: string[]
}

export interface RbacOplogEntry {
	id: number
	create_time: number
	user_id: number
	username: string
	action: string
	module: string
	version: string | null
	target: string | null
	detail: string | null
	level: number
}

export interface RbacOplogPage {
	list: RbacOplogEntry[]
	total: number
	truncated: boolean
}

export interface RbacContact {
	id: number
	username: string
	display_name: string | null
}

export interface RbacSettingItem {
	key: string
	module: string
	group: string
	type: string
	value: string | null
	default_value: string | null
	label_key: string | null
	options: string | null
	secret: boolean
	update_time: number
}

export interface RbacSettingGroup {
	group: string
	items: RbacSettingItem[]
}

export interface LoginMethods {
	methods: Array<"local" | "ldap" | "sso">
}

/** 操作日志写端入参（POST /api/system/oplog；module 为调用方自身模块名）。脱敏红线：detail 不得含口令/密钥/token。 */
export interface RbacOplogWrite {
	action: string
	module: string
	version?: string
	target?: string
	detail?: unknown
	level?: number
}

/** 登录响应（auth/login、auth/refresh、auth/password 同形） */
export interface AuthSessionPayload {
	access_token: string
	refresh_token: string
	expires_in: number
	restricted: boolean
	user: {
		id: number
		username: string
		display_name: string | null
		avatar_base64: string | null
		must_change: boolean
		roles: string[]
	}
}
