// RBAC 域 api（阶段 C 前端数据源；AC-D16 信封约定同 api/user：fetch* 直返业务 data）。
// 端点对应模板 api：/api/system/*（管理域）与 /api/_platform/contacts（登录即可）。
import type {
	AuthSessionPayload,
	LoginMethods,
	RbacContact,
	RbacOplogPage,
	RbacPermission,
	RbacRole,
	RbacSettingGroup,
	RbacUser,
} from "./types";

import { request } from "#src/utils/request";

export * from "./types";

/** oj 信封（线格式） */
interface OjEnvelope<T> {
	code: number
	msg?: string
	data?: T
}

function get<T>(url: string): Promise<T> {
	return request.get(url).json<OjEnvelope<T>>().then(env => env.data as T);
}

function post<T>(url: string, json?: unknown): Promise<T> {
	return request.post(url, { json }).json<OjEnvelope<T>>().then(env => env.data as T);
}

function put<T>(url: string, json?: unknown): Promise<T> {
	return request.put(url, { json }).json<OjEnvelope<T>>().then(env => env.data as T);
}

function del<T>(url: string): Promise<T> {
	return request.delete(url).json<OjEnvelope<T>>().then(env => env.data as T);
}

// ---- 角色管理（C2） ----
export const fetchRbacRoleList = () => get<RbacRole[]>("system/roles");
export const fetchRbacPermissionList = () => get<RbacPermission[]>("system/permissions");
export const fetchRbacCreateRole = (body: { name: string, title: string, permissions?: string[] }) => post("system/roles", body);
export const fetchRbacUpdateBindings = (name: string, permissions: string[]) => put(`system/roles/bindings?name=${encodeURIComponent(name)}`, { permissions });
export const fetchRbacDeleteRole = (name: string) => del(`system/roles?name=${encodeURIComponent(name)}`);

// ---- 账号管理（C1） ----
export const fetchRbacUserList = () => get<RbacUser[]>("system/users");
export const fetchRbacCreateUser = (body: { username: string, password: string, displayName?: string, email?: string }) => post("system/users", body);
export const fetchRbacUpdateUserRoles = (uid: number, roles: string[]) => put(`system/users/roles?uid=${uid}`, { roles });
export const fetchRbacAdminResetPassword = (uid: number, password: string) => put(`system/users/password?uid=${uid}`, { password });
export const fetchRbacSetForbidden = (uid: number, forbidden: boolean) => put(`system/users/forbidden?uid=${uid}`, { forbidden });

// ---- 操作日志（C3） ----
export function fetchRbacOplog(query: { action?: string, username?: string, module?: string, limit?: number }) {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v != null && v !== "")
			sp.set(k, String(v));
	}
	return get<RbacOplogPage>(`system/oplog?${sp.toString()}`);
}

// 写端：解决方案模块记录自身操作（module 取自身模块名；登录态即可，权限数据隔离由后端按 module 收敛）。
export const fetchRbacOplogPost = (body: RbacOplogWrite) => post<{ ok: boolean }>("system/oplog", body);

// ---- 系统设置（C4） ----
export const fetchRbacSettings = () => get<RbacSettingGroup[]>("system/settings");
export const fetchRbacUpdateSetting = (key: string, value: string) => put("system/settings", { key, value });

// ---- 通讯录（C6 选人组件） ----
export function fetchRbacContacts(keyword: string, limit?: number) {
	return get<RbacContact[]>(`_platform/contacts?keyword=${encodeURIComponent(keyword)}${limit ? `&limit=${limit}` : ""}`);
}
export const fetchRbacContactDetail = (id: number) => get<RbacContact & { email: string | null, avatar_base64: string | null }>(`_platform/contacts/detail?id=${id}`);

// ---- 登录方式发现（C5；匿名端点） ----
export const fetchLoginMethods = () => get<LoginMethods>("system/login-methods");

// ---- 登录链（B 期后端同形载荷；受限改密后端点为 auth/password） ----
export const fetchChangePassword = (body: { old_password: string, new_password: string }) => put<AuthSessionPayload>("auth/password", body);

// ---- LDAP 登录（D1/AC1-12；匿名端点，载荷与本地登录同形） ----
export const fetchLdapLogin = (body: { username: string, password: string }) => post<AuthSessionPayload>("auth/ldap-login", body);
