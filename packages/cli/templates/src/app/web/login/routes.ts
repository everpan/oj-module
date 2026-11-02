import type { AppRouteRecordRaw, ModuleContext } from "@oj-module/runtime";

import { useAuthStore, useTenantStore } from "@oj-module/runtime";
import { lazy } from "react";

import { authProvider } from "./auth-provider";

/**
 * 登录根 `/login`（+ 强制改密 `/change-password`）。
 *
 * shell 宿主只消费模块路由（`getRoutes()`），**不挂 runtime 的内置 baseRoutes**，
 * 因此缺少该根时 `/login` 无路由可跳（登出/回跳登录会落空）。本根补上路由：
 * 登录链路仍回落到 runtime 默认链（`fetchLogin` → 后端内置 `auth/login` +
 * 守卫 `getUserInfo` → `web/user-info`），本根只负责「内容区」。
 *
 * `handle.login: true` 让框架识别为登录页（`resolveLoginRoute` 校验路径必须是
 * `/login`）；`handle.layout: "fullscreen"` 由框架注入全屏外壳。
 */
export const routes: AppRouteRecordRaw[] = [
	{
		path: "/login",
		handle: {
			layout: "fullscreen",
			login: true,
			hideInMenu: true,
			title: "login:page.title",
		},
		children: [
			{
				index: true,
				Component: lazy(() => import("./pages/login")),
				handle: { title: "login:page.title" },
			},
		],
	},
	{
		// 首登/重置后强制改密（must_change 悬挂期唯一可用写端）；
		// 管理面 403 msg=password change required 时也引导至此
		path: "/change-password",
		handle: {
			layout: "fullscreen",
			hideInMenu: true,
			title: "login:page.changePwd.title",
		},
		children: [
			{
				index: true,
				Component: lazy(() => import("./pages/change-password")),
				handle: { title: "login:page.changePwd.title", hideInMenu: true },
			},
		],
	},
];

/**
 * 认证 provider：仅接管「企微票据换会话」，其余方式原样委托内置链（见 auth-provider.ts）。
 * 注册时机必须在任何登录动作之前——onInit 先于路由渲染。
 */
export async function onInit(ctx: ModuleContext) {
	ctx.register.authProvider(authProvider);
	// 登出必须清租户：否则下一个用户会带着上一个用户的租户头（跨租户请求 fail-closed 403，
	// 但单租户部署会静默落到别人的 default 视图）。token 由非空转空即视为登出。
	//
	// 租户上下文的请求头由**运行时**注入（`runtime/store/tenant.ts`），本根不注册
	// headerProvider——宿主 shell 的 hydrateUser / solution-routes 都在任何模块 onInit
	// 之前就发请求，模块注册必然晚一步（2026-10-30 冷启动 e2e 实测两个 400）。
	useAuthStore.subscribe((state, prev) => {
		if (prev.token && !state.token)
			useTenantStore.getState().clear();
	});
}
