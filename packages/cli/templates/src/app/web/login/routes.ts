import type { AppRouteRecordRaw, ModuleContext } from "@oj-module/runtime";

import { getRedirectPath, resolveSiteBase, useAuthStore, useTenantStore } from "@oj-module/runtime";
import { lazy } from "react";

import { authProvider } from "./auth-provider";
import { parseWecomLanding } from "./wecom";

/**
 * onInit 阶段「企微票据换会话」失败的原因。登录页首帧读一次：非空就直接显示表单与错误，
 * 不再进「认证中」态，也不再自动重发授权（避免废票 → 重授权 → 再失败的循环）。
 */
let wecomBootError = "";

export function getWecomBootError(): string {
	return wecomBootError;
}

/**
 * 企微回跳落地（`/login?wecom_ticket=…`）的换票**提前到首帧 render 之前**。
 *
 * 原来放在 LoginPage 的 useEffect 里：路由先把登录页（全屏外壳 + 品牌位 + 「认证中」）
 * 画出来，等一个 POST 换完票、token 落 store 后才 Navigate 到首页——工作台进入时
 * 登录页明显闪一下。模块 onInit 在宿主建路由之前被 await，在这里换完票即把 URL 改成
 * 首页（见下方 shell 无 AuthGuard 的说明），路由首帧就落在 /home，登录页一次都不挂载。
 *
 * 失败不阻断启动：保持 /login，错误记下来交给登录页首帧显示表单与错误，用户可改用
 * 本地登录 / 重新授权；一次性票据在成功改 URL 时一并从地址栏与历史里抹掉。
 */
async function exchangeWecomTicketOnBoot(): Promise<void> {
	const landing = parseWecomLanding(window.location.search);
	if (!landing)
		return;
	try {
		// 租户由 tenant.ts::bootstrapTenant 在模块作用域从 ?tenant= 落地；这里补一次，
		// 让换票请求的 X-TENANT-ID 与票据租户严格一致（服务端会比对两者）。
		if (landing.tenant)
			useTenantStore.getState().setTenant(landing.tenant);
		await useAuthStore.getState().login({
			username: "",
			password: "",
			method: "wecom",
			ticket: landing.ticket,
		});
		// 宿主 shell 链**没有 AuthGuard**（免登录演示能力绕开 LayoutRoot），所以「已登录」
		// 不会自动把 /login 跳走。宿主在 loadAll（即本 onInit）之后才 createBrowserRouter，
		// 此刻先把 URL 换成首页，路由首帧就落在 /home，登录页一次都不挂载。
		// runtime 自有链带 AuthGuard，这处 replace 也无害（守卫同样跳首页）。
		const base = resolveSiteBase().replace(/\/+$/, "");
		window.history.replaceState(null, "", `${base}${getRedirectPath(window.location.search)}`);
	}
	catch (e) {
		// 失败保持 /login：bootError 交给登录页首帧显示表单与错误，不再闪「认证中」
		wecomBootError = e instanceof Error ? e.message : String(e);
	}
}

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
	// 必须在 provider 注册之后、首帧 render 之前：企微回跳的票据在这里换完，
	// 登录页就不会先闪一下再跳首页（见 exchangeWecomTicketOnBoot 注释）。
	await exchangeWecomTicketOnBoot();
}
