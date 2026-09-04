import { FileTextOutlined, HomeOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { defineModule } from "@react-antd-module/runtime";
import { createElement } from "react";
import { Navigate } from "react-router";

import { bindRequest } from "./api/client";
import DemoAboutPage from "./pages/about";
import DemoDetailPage from "./pages/detail";
import DemoPage from "./pages/index";

/**
 * 垂直切片演示模块。
 *
 * 关键：本文件只 import 三类东西——
 *   1. `@react-antd-module/runtime`（框架唯一入口）
 *   2. 共享依赖（react / antd / @ant-design/icons），由宿主 importmap 提供
 *   3. 模块自身的相对路径
 * 不出现任何 `#src/*` 或框架内部路径。
 */
export default defineModule({
	name: "demo",
	description: "垂直切片演示模块",
	version: "0.1.0",
	// 宿主 runtime 尚未发版（workspace 内为 0.0.0），故声明为开放范围而非
	// `^0.0.0`——后者在 semver 下等价于「恰好 0.0.0」，宿主一升级就会误判不兼容
	peerRuntime: ">=0.0.0",
	routes: [
		{
			path: "/demo",
			// 父路由声明 layout：框架按 handle.layout 包裹（D9），
			// 页面由子路由渲染。缺了它页面会裸奔（无 header/sidebar/tabbar），
			// 且 KeepAlive 挂在 ContainerLayout 内，keepAlive 也会失效
			handle: {
				layout: "container",
				order: 100,
				title: "demo:menu.demo",
				icon: createElement(HomeOutlined),
			},
			children: [
				{
					// 组落地页：菜单生成器不为 index 子路由建菜单项（框架按
					// 「唯一 index 子 = 父项即页面」折叠），有兄弟子路由时落地页
					// 须落具名 path 才有侧边栏入口；/demo 直达重定向过去
					index: true,
					element: createElement(Navigate, { to: "/demo/todos", replace: true }),
					handle: { title: "demo:menu.demo" },
				},
				{
					path: "todos",
					Component: DemoPage,
					handle: {
						title: "demo:menu.todos",
						icon: createElement(HomeOutlined),
						keepAlive: true,
					},
				},
				{
					path: "detail",
					Component: DemoDetailPage,
					handle: {
						title: "demo:menu.detail",
						icon: createElement(FileTextOutlined),
						keepAlive: true,
					},
				},
				{
					path: "about",
					Component: DemoAboutPage,
					handle: {
						title: "demo:menu.about",
						icon: createElement(InfoCircleOutlined),
					},
				},
			],
		},
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	lifecycle: {
		onInit: async (ctx) => {
			// D11 前缀收敛 + AC-D8：生成 client 的请求能力由宿主注入
			ctx.register.apiPrefix("/demo");
			bindRequest(ctx.utils.request);
		},
	},
});
