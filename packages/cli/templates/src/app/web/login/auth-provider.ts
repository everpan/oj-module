import type { AuthProvider, AuthType } from "@oj-module/runtime";

import { fetchLogin, fetchLogout, fetchUserInfo, request, useAuthStore } from "@oj-module/runtime";

/**
 * 登录模块的认证 provider（P5 接缝）。
 *
 * 为什么必须注册：`useAuthStore.login()` 只认两条路——provider 或内置 `auth/login`。
 * 企微登录拿到的是**票据**而不是口令，走不了内置路；而 store 的写入（token 持久化、
 * 之后 guard 拉用户信息）必须只有一个入口，所以由本 provider 接管并把其余方式
 * **原样委托**回内置实现（`fetchLogin/fetchLogout/fetchUserInfo`，行为零变化）。
 *
 * 契约（见 runtime `store/auth-provider.ts`）：provider 对返回值自负责，失败请直接
 * reject——runtime 原样透传，错误提示归登录页。
 */
export const authProvider: AuthProvider = {
	async login(payload): Promise<AuthType> {
		if (payload.method !== "wecom")
			return fetchLogin(payload);

		const ticket = payload.ticket?.trim() ?? "";
		if (!ticket)
			throw new Error("缺少企业微信登录票据，请从企业微信重新进入");

		// 服务端只认 `{ ticket }`（schema 校验 minLength 32）：它由 302 落地点带过来，
		// 只在内存里存在一瞬间，不落 localStorage。
		//
		// throwHttpErrors:false —— ky 默认把非 2xx 抛成 HTTPError，message 是
		// "Request failed with status code 401"，登录页只能原样贴给用户看。
		// 这里自己读信封，把后端 `fail(401, "登录票据无效或已使用")` 的 msg 透上去。
		const res = await request.post("auth/wecom/ticket", { json: { ticket }, throwHttpErrors: false });
		const env = await res
			.json<{ code: number, msg?: string, data?: { access_token?: string, refresh_token?: string } }>()
			.catch(() => undefined);
		if (!res.ok)
			throw new Error(env?.msg || `企业微信登录失败（HTTP ${res.status}）`);
		return {
			token: env?.data?.access_token ?? "",
			refreshToken: env?.data?.refresh_token ?? "",
		};
	},

	async logout(): Promise<void> {
		// 服务端吊销是「尽力而为」：本地登出（runtime 的 finally → reset）才是真相，
		// 网络/服务端超时（如反代 `proxy_read_timeout` 短于上游）不应让退出卡死或抛
		// 未捕获异常（点击退出 → Uncaught TimeoutError）。失败仅记日志，不向上抛。
		try {
			await fetchLogout({ refreshToken: useAuthStore.getState().refreshToken });
		}
		catch (e) {
			console.warn("[auth-provider] logout 服务端吊销失败（本地会话已清空）：", e);
		}
	},

	getUserInfo: () => fetchUserInfo(),
};
