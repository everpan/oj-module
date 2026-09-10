import type { AppRouteRecordRaw } from "#src/router/types";
import type { AuthType, LoginInfo, UserInfoType } from "./types";

import { request } from "#src/utils/request";
import { REFRESH_TOKEN_PATH } from "#src/utils/request/constants";

export * from "./types";

/**
 * AC-D16：全站唯一信封 = oj `{code,msg,data}`（code=0 成功，HTTP 状态=code）。
 * fetch* 直返业务 data，失败路径由 ky HTTPError + error-response 统一吐司；
 * 旧的 normalize/mapAuth 信封归一层已删除。
 * 保留的唯一边界映射：auth 载荷 snake_case（access_token）→ camelCase（token），
 * 属字段映射而非信封归一，3 行收口在 fetch 函数内。
 * auth 载荷形状以 devkit 手册 §8 为准：
 * data = { access_token, refresh_token, expires_in(秒), user:{id, roles} }，
 * refresh 响应同形且旧 refresh 立即失效（轮换）——expires_in/user 目前未消费。
 */

/** oj 信封（线格式） */
interface OjEnvelope<T> {
	code: number
	msg?: string
	data?: T
}

/** auth 载荷线格式 → 应用模型（字段映射，非信封归一） */
function mapAuthPayload(data?: { access_token?: string, refresh_token?: string }): AuthType {
	return {
		token: data?.access_token ?? "",
		refreshToken: data?.refresh_token ?? "",
	};
}

export function fetchLogin(data: LoginInfo): Promise<AuthType> {
	return request
		.post("auth/login", { json: data })
		.json<OjEnvelope<{ access_token?: string, refresh_token?: string }>>()
		.then(env => mapAuthPayload(env.data));
}

export function fetchLogout(data?: { readonly refreshToken?: string }): Promise<void> {
	return request.post("auth/logout", { json: { refresh_token: data?.refreshToken ?? "" } }).json().then(() => {});
}

export function fetchAsyncRoutes(): Promise<AppRouteRecordRaw[]> {
	return request
		.get("web/get-async-routes")
		.json<OjEnvelope<AppRouteRecordRaw[]>>()
		.then(env => env.data ?? []);
}

export function fetchUserInfo(): Promise<UserInfoType> {
	return request
		.get("web/user-info")
		.json<OjEnvelope<UserInfoType>>()
		.then(env => env.data as UserInfoType);
}

export function fetchRefreshToken(data: { readonly refreshToken: string }): Promise<AuthType> {
	return request
		.post(REFRESH_TOKEN_PATH, { json: { refresh_token: data.refreshToken } })
		.json<OjEnvelope<{ access_token?: string, refresh_token?: string }>>()
		.then(env => mapAuthPayload(env.data));
}
