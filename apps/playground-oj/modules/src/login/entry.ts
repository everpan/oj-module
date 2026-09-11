import { defineModule } from "@oj-module/runtime";
import { lazy } from "react";

/**
 * 登录模块（参考实现，P2-1 退化纯页面）：
 *
 * - 不再自注册 `authProvider`——登录链路回落到 runtime 默认链
 *   （`fetchLogin` → 内置 `auth/login` + 守卫 `getUserInfo` → `web/user-info`）。
 *   内置 `auth/login` 走 oj 的 `users` 表 bcrypt 校验；`web/user-info` 由本工程
 *   `api/src/web/user-info/api.ts` 实现（见 P2-2）。
 * - 模块只负责「内容区」：`path: "/login"` + `handle.login: true` 让框架识别并
 *   剔除内置兜底登录页；`handle.layout: "fullscreen"` 由框架注入全屏外壳。
 */
export default defineModule({
	name: "login",
	description: "登录模块参考实现（内容区由模块提供，外壳由框架提供）",
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
