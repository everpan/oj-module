import { defineModule } from "@oj-module/runtime";

import { lazy } from "react";

/**
 * 登录模块（由 runtime 内置登录页模块化而来，替代内置完整实现）。
 *
 * 契约（docs/prd/202609021142-login-module-design.md §3.1）：
 * - path 必须是框架契约路径 `/login`；
 * - handle.login: true 声明「我是登录页」，存在时内置兜底被剔除；
 * - handle.layout: "fullscreen" 由框架注入全屏外壳（品牌区/工具区/页脚），
 *   模块只写内容区，零框架内部依赖。
 *
 * 登录链走默认 auth provider（store/auth → api/user → auth/login），
 * 与内置兜底行为一致，故不注册自定义 authProvider。
 * 路由标题用模块 namespace（login:menu.*，i18n 一致性门禁约定）；
 * 表单内文案复用宿主命名空间（authority.* / form.* / common.*）。
 */
export default defineModule({
	name: "login",
	description: "登录模块（完整版：密码/验证码/注册/找回密码表单）",
	version: "0.1.0",
	routes: [
		{
			path: "/login",
			handle: {
				layout: "fullscreen",
				login: true,
				hideInMenu: true,
				title: "login:menu.login",
			},
			children: [
				{
					index: true,
					Component: lazy(() => import("./pages/login")),
					handle: { title: "login:menu.login" },
				},
			],
		},
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
});
