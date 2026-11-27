import type { AuthType, LoginInfo } from "#src/api/user/types";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchLogin, fetchLogout } from "#src/api/user";
import { useAccessStore } from "#src/store/access";
import { getAuthProvider } from "#src/store/auth-provider";
import { useTabsStore } from "#src/store/tabs";

import { syncTenantWithToken, useTenantStore } from "#src/store/tenant";
import { useUserStore } from "#src/store/user";
import { getAppNamespace } from "#src/utils/get-app-namespace";

const initialState = {
	token: "",
	refreshToken: "",
};

type AuthState = AuthType;

interface AuthAction {
	login: (loginPayload: LoginInfo) => Promise<void>
	logout: () => Promise<void>
	reset: () => void
};

export const useAuthStore = create<AuthState & AuthAction>()(

	persist((set, get) => ({
		...initialState,

		login: async (loginPayload) => {
			/**
			 * 模块接管认证时（P5）：provider 只负责换取凭证，写库仍由 runtime
			 * 统一做，避免模块直接碰 store 造成两套写入路径。
			 * provider 路径不做 success/字段校验、不弹错误：校验与错误 UX 由 provider
			 * 自管（见 auth-provider.ts 契约），runtime 仅透传 rejection、统一写库。
			 */
			const provider = getAuthProvider();
			const auth = provider ? await provider.login(loginPayload) : await fetchLogin(loginPayload);
			// 令牌 tenant 才是服务端认可的租户：必须先对齐再写 token——
			// solution-routes 等 token 订阅者在 set() 后会立即发请求，晚对齐会带旧租户头。
			syncTenantWithToken(auth.token);
			set(auth);
		},

		logout: async () => {
			/**
			 * 1. 退出登录（provider 优先，未注册回落内置契约）
			 * 2. 清空 token 等其他信息 —— 放 finally：后端不可用时本地也必须清
			 *    （此前 await fetchLogout() 一抛错，reset() 完全不执行，
			 *    playground 这类无后端场景点了退出登录毫无反应）
			 */
			try {
				const provider = getAuthProvider();
				if (provider)
					await provider.logout();
				else
					await fetchLogout({ refreshToken: get().refreshToken });
			}
			finally {
				get().reset();
				// 只在显式登出时清租户：401 跳登录（goLogin → reset）要保留租户，
				// 否则租户本地账号重新登录时会按 default 租户找用户而 401。
				useTenantStore.getState().clear();
			}
		},

		reset: () => {
			/**
			 * 清空 token
			 */
			set({
				...initialState,
			});
			/**
			 * 清空用户信息
			 * @see {@link https://github.com/pmndrs/zustand?tab=readme-ov-file#read-from-state-in-actions | Read from state in actions}
			 */
			useUserStore.getState().reset();

			/**
			 * 清空权限信息
			 * @see https://github.com/pmndrs/zustand?tab=readme-ov-file#readingwriting-state-and-reacting-to-changes-outside-of-components
			 */
			useAccessStore.getState().reset();

			/**
			 * 清空标签页
			 */
			useTabsStore.getState().resetTabs();

			/**
			 * 清空 keepAlive 缓存
			 * 在 container-layout 组件中，根据 openTabs 自动刷新 keepAlive 缓存
			 */
		},

	}), { name: getAppNamespace("access-token") }),

);
