import type { AuthType, UserInfoType } from "@react-antd-module/runtime";
import { defineModule } from "@react-antd-module/runtime";
import { lazy } from "react";

/**
 * AC-D16：模块自有接口信封 = oj {code,msg,data}（全站唯一信封）。
 * 未从 runtime 主入口导出，故在模块内声明最小信封，不为此扩 runtime 出口。
 */
interface OjEnvelope<T> {
	code: number
	msg?: string
	data?: T
}

/**
 * 登录模块参考实现（login 模块化，P4）。
 *
 * 契约（docs/prd/202609021142-login-module-design.md §3.1）：
 * - path 必须是框架契约路径 `/login`；
 * - handle.login: true 声明「我是登录页」，存在时内置兜底被剔除；
 * - handle.layout: "fullscreen" 由框架注入全屏外壳（品牌区/工具区/页脚），
 *   模块只写内容区，零框架内部依赖。
 */
export default defineModule({
	name: "login",
	description: "登录模块参考实现（替换内置登录页）",
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
	lifecycle: {
		async onInit(ctx) {
			// 必须先登记 apiPrefix，scoped request 才会收敛到 /login 命名空间；
			// 否则请求报「未登记 API 前缀」错（见 scoped.ts）。
			ctx.register.apiPrefix("/login");
			ctx.register.authProvider({
				async login(payload) {
					// 业务失败（非 2xx）由 request 层统一吐司并抛 HTTPError，此处只见成功信封
					const env = await ctx.utils.request.post("login/login", { json: payload }).json<OjEnvelope<AuthType>>();
					if (!env.data)
						throw new Error(env.msg || "登录失败");
					return env.data;
				},
				async logout() {
					await ctx.utils.request.post("login/logout").json();
				},
				async getUserInfo() {
					const env = await ctx.utils.request.get("login/user-info").json<OjEnvelope<UserInfoType>>();
					return env.data as UserInfoType;
				},
			});
		},
	},
});
