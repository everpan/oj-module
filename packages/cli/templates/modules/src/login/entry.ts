import { defineModule } from "@oj-module/runtime";
import { lazy } from "react";

/**
 * 登录模块：提供 `/login` 路由与内容区。
 *
 * shell 宿主只消费模块路由（`getRoutes()`），**不挂 runtime 的内置 baseRoutes**，
 * 因此缺少本模块时 `/login` 无路由可跳（登出/回跳登录会落空）。本模块补上该路由：
 * 登录链路仍回落到 runtime 默认链（`fetchLogin` → 后端内置 `auth/login` +
 * 守卫 `getUserInfo` → `web/user-info`），模块只负责「内容区」。
 *
 * `handle.login: true` 让框架识别为登录页（`resolveLoginRoute` 校验路径必须是
 * `/login`）；`handle.layout: "fullscreen"` 由框架注入全屏外壳。
 */
export default defineModule({
	name: "login",
	description: "登录模块（内容区由模块提供，外壳由框架提供）",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [
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
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
});
