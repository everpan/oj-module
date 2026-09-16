import type { Options } from "ky";

import ky from "ky";
import { isLoginPathname } from "#src/router/extra-info";
import { useAuthStore } from "#src/store/auth";
import { currentHeaderProvider } from "#src/store/header-provider";
import { usePreferencesStore } from "#src/store/preferences";

import { AUTH_HEADER, LANG_HEADER, REFRESH_TOKEN_PATH } from "./constants";
import { handleErrorResponse } from "./error-response";
import { globalProgress } from "./global-progress";
import { goLogin } from "./go-login";
import { setHeaderSafe } from "./header-safe";
import { refreshTokenAndRetry } from "./refresh";
import { isAnonymousApi } from "./whitelist";

// 请求超时时间
const API_TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT) || 10000;

const defaultConfig: Options = {
	prefix: import.meta.env.VITE_API_BASE_URL,
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
				// D-M9：模块注册的惰性请求头（租户等）——追加式合并，未注册时请求照发
				const headerProvider = currentHeaderProvider();
				if (headerProvider) {
					for (const [name, value] of Object.entries(headerProvider())) {
						setHeaderSafe(request.headers, name, value);
					}
				}
			},
		],
		afterResponse: [
			async ({ request, options, response }) => {
				const ignoreLoading = options.ignoreLoading;
				if (!ignoreLoading) {
					globalProgress.done();
				}
				// request error
				if (!response.ok) {
					if (response.status === 401) {
						// 防止刷新 refresh-token 继续接收到的 401 错误，出现死循环
						if ([`/${REFRESH_TOKEN_PATH}`].some(url => request.url.endsWith(url))) {
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
