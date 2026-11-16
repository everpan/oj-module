import type { AppRouteRecordRaw } from "#src/router/types";
import type { AuthType, BatchUserInfoType, LoginInfo, UserInfoType } from "./types";

import { getRoutesApiProvider } from "#src/store/api-provider";
import { currentTenant } from "#src/store/tenant";
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
	// 按登录方式路由：ldap → auth/ldap-login（匿名，载荷同本地），其余 → auth/login。
	// 强绑定下登录类请求不注 X-TENANT-ID 头，改由请求体自报 tenant（handler 内 db.asTenant 补身份）。
	const path = data.method === "ldap" ? "auth/ldap-login" : "auth/login";
	return request
		.post(path, { json: { ...data, tenant: currentTenant() } })
		.json<OjEnvelope<{ access_token?: string, refresh_token?: string }>>()
		.then(env => mapAuthPayload(env.data));
}

export function fetchLogout(data?: { readonly refreshToken?: string }): Promise<void> {
	// 强绑定下登出不注 X-TENANT-ID 头，请求体自报 tenant。
	return request.post("auth/logout", { json: { refresh_token: data?.refreshToken ?? "", tenant: currentTenant() } }).json().then(() => {});
}

// G2：消费点委托（与 #src/api/notifications 同模式）。未注册 routesApi
// provider 时回落内置 web/get-async-routes。
export function fetchAsyncRoutes(): Promise<AppRouteRecordRaw[]> {
	const p = getRoutesApiProvider();
	if (p)
		return p.fetchAsyncRoutes();
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

/** 单次请求 ids 上限，与后端 MAX_BATCH_IDS（_platform/users/info）对齐。 */
const INFO_IDS_PER_REQUEST = 200;

/**
 * 批量按 id 取用户完整信息（登录即可，租户隔离）。反 N+1：一次/多次 IN 批量请求，
 * 而非逐行 fetchRbacContactDetail。缺失/跨租户 id 不返回；自动去重、分块、保持入参顺序。
 */
export function fetchUserInfosByIDs(ids: readonly (number | string)[]): Promise<BatchUserInfoType[]> {
	const normalized = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
	if (!normalized.length)
		return Promise.resolve([]);
	const chunks: number[][] = [];
	for (let i = 0; i < normalized.length; i += INFO_IDS_PER_REQUEST)
		chunks.push(normalized.slice(i, i + INFO_IDS_PER_REQUEST));
	return Promise
		.all(chunks.map(chunk =>
			request
				.get(`_platform/users/info?ids=${encodeURIComponent(chunk.join(","))}`)
				.json<OjEnvelope<BatchUserInfoType[]>>()
				.then(env => env.data ?? []),
		))
		.then(groups => groups.flat());
}

export function fetchRefreshToken(data: { readonly refreshToken: string }): Promise<AuthType> {
	// 强绑定下刷新不注 X-TENANT-ID 头，请求体自报 tenant。
	// skipAuthRefresh：refresh 自身的 401 绝不能重入刷新链——否则 isRefreshing 已 true，
	// 递归进订阅者队列自等待，外层 await 永不返回 → 页面永久 loading（页面久开后 refresh 过期即此路径）。
	return request
		.post(REFRESH_TOKEN_PATH, { json: { refresh_token: data.refreshToken, tenant: currentTenant() }, skipAuthRefresh: true })
		.json<OjEnvelope<{ access_token?: string, refresh_token?: string }>>()
		.then(env => mapAuthPayload(env.data));
}
