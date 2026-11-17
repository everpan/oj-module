import type { Options } from "ky";

import ky from "ky";
import { isLoginPathname } from "#src/router/extra-info";
import { useAuthStore } from "#src/store/auth";
import { currentHeaderProvider } from "#src/store/header-provider";
import { usePreferencesStore } from "#src/store/preferences";
import { currentTenant, TENANT_HEADER } from "#src/store/tenant";

import { resolveApiBase } from "#src/utils/api-base";
import { AUTH_HEADER, LANG_HEADER, REFRESH_TOKEN_PATH } from "./constants";
import { handleErrorResponse } from "./error-response";
import { globalProgress } from "./global-progress";
import { goLogin } from "./go-login";
import { setHeaderSafe } from "./header-safe";
import { refreshTokenAndRetry } from "./refresh";
import { isAnonymousApi } from "./whitelist";

// 租户头豁免清单：命中者**不**注入 X-TENANT-ID（强绑定下这些是无 token 链路，
// 前端不注头、改由请求体自报 tenant，handler 内 db.asTenant 补身份）。清单与
// config.yaml 的 tenant.anonymous_paths 对齐（含 `/**` 通配：匹配该路径及其下所有子路径）。
const tenantlessApiPaths = [
	"/system/login-methods",
	"/auth/wecom/login",
	"/auth/wecom/callback",
	"/auth/wecom/ticket",
	"/auth/wecom/event",
	"/publish/credential/exchange",
	"/oj-market/catalog/**",
	"/oj-market/cdn/upload",
	"/oj-market/yank",
	"/auth/login",
	"/auth/ldap-login",
	"/auth/logout",
	"/auth/refresh",
	"/oj-market/converge",
];

/** 与 isAnonymousApi 平行：返回 true 表示本次请求不应注入 X-TENANT-ID 头。 */
export function isTenantlessApi(url: string): boolean {
	return tenantlessApiPaths.some((p) => {
		if (p.endsWith("/**")) {
			const prefix = p.slice(0, -2); // 保留末尾 "/"
			return url.endsWith(prefix) || url.startsWith(prefix);
		}
		return url.endsWith(p);
	});
}

// 请求超时时间
const API_TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT) || 10000;

const defaultConfig: Options = {
	// API 前缀部署期可配（window.__OJ_API_BASE__，见 utils/api-base.ts），构建期 VITE_API_BASE_URL 只是缺省
	prefix: resolveApiBase(),
	timeout: API_TIMEOUT,
	retry: {
		// 当请求失败时，最多重试次数
		limit: 3,
	},
	hooks: {
		beforeRequest: [
			({ request, options }) => {
				const ignoreLoading = options.ignoreLoading;
				if (!ignoreLoading) {
					globalProgress.start();
				}
				// 不需要携带 token 的请求
				const isWhiteRequest = isAnonymousApi(request.url);
				if (!isWhiteRequest) {
					const { token } = useAuthStore.getState();
					setHeaderSafe(request.headers, AUTH_HEADER, `Bearer ${token}`);
				}
				// 语言等所有的接口都需要携带
				setHeaderSafe(request.headers, LANG_HEADER, usePreferencesStore.getState().language);
				// 租户头由运行时直接注入（不经模块 provider）：宿主 shell 的 hydrateUser /
				// solution-routes 都在任何模块 onInit 之前发请求，靠模块注册必然晚一步
				// （冷启动实测两个 400 missing tenant header）。见 store/tenant.ts 头注释。
				// 无 token 链路（登录/刷新/登出/ldap-login 与 oj-market 匿名面）在强绑定下
				// 不注头——前端从请求体自报 tenant，handler 内 db.asTenant 补身份；若仍注头
				// 则头必须与 token claim 一致，而这类请求无 token，故直接豁免注入。
				if (!isTenantlessApi(request.url)) {
					setHeaderSafe(request.headers, TENANT_HEADER, currentTenant());
				}
				// D-M9：模块注册的惰性请求头——追加式合并，未注册时请求照发
				const headerProvider = currentHeaderProvider();
				if (headerProvider) {
					for (const [name, value] of Object.entries(headerProvider())) {
						setHeaderSafe(request.headers, name, value);
					}
				}
			},
		],
		// 无响应失败（网络错/超时/abort）的唯一计数出口：ky 这类失败不跑
		// afterResponse，只跑 beforeError。不在这里归还 start() 的计数就会泄漏——
		// 页面静置后再激活时某个数据请求在网络层失败，globalSpin 永久 true，
		// 菜单内容照常渲染但 Spin 蒙版无法消除（0.2.95 的 forceFinish 只覆盖 401 路径）。
		// 传 options 作幂等键：HTTP 错误先跑 afterResponse 已 done，这里再调会被去重，
		// 不会多减导致并发下提前关蒙版。beforeError 钩子须回传 error 原样。
		beforeError: [
			({ options, error }) => {
				if (!options.ignoreLoading) {
					globalProgress.done(options);
				}
				return error;
			},
		],
		afterResponse: [
			async ({ request, options, response }) => {
				const ignoreLoading = options.ignoreLoading;
				if (!ignoreLoading) {
					globalProgress.done(options);
				}
				// request error
				if (!response.ok) {
					if (response.status === 401) {
						// 防止刷新链自死循环：① refresh 端点自身的 401（刷新串过期）；
						// ② 刷新后的重放请求再次 401（新 token 仍不被接收，如会话被吊销）。
						// 二者都带 skipAuthRefresh 显式标记——不再只靠 URL endsWith：后者在
						// 查询串/尾斜杠/部署 base 变化下会漏判，让请求重入刷新链自等待，页面永久 loading。
						if (options.skipAuthRefresh || [`/${REFRESH_TOKEN_PATH}`].some(url => request.url.endsWith(url))) {
							goLogin();
							return response;
						}
						// If the token is expired, refresh it and try again.
						const { refreshToken } = useAuthStore.getState();
						// If there is no refresh token, it means that the user has not logged in.
						if (!refreshToken) {
							// 如果页面的路由已经重定向到登录页，则不用跳转直接返回结果
							// （basename 感知：原始 location.pathname 含 BASE_URL，P0 修复）
							if (isLoginPathname(location.pathname)) {
								return response;
							}
							else {
								goLogin();
								return response;
							}
						}

						return refreshTokenAndRetry(request, options, refreshToken);
					}
					else {
						// silentError：错误体由调用方自行消化（如市场「未配置地址」这类
						// 预期空态，页面已有文案），不再叠一层全局 toast。
						if (options.silentError)
							return response;
						return handleErrorResponse(response);
					}
				}
				// request success
				return response;
			},
		],
	},
};

export const request = ky.create(defaultConfig);
