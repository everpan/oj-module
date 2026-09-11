import type { AppRouteRecordRaw, ModuleDefinition } from "@oj-module/runtime";

import { HomeOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

import { bindRequest } from "./client/api";

const Home = lazy(() => import("./pages/index"));

const routes: AppRouteRecordRaw[] = [
	{
		path: "/home",
		handle: {
			layout: "container",
			order: 1,
			title: "home:menu.home",
			icon: createElement(HomeOutlined),
		},
		children: [
			{
				index: true,
				Component: Home,
				handle: {
					title: "home:menu.home",
					icon: createElement(HomeOutlined),
				},
			},
		],
	},
];

const mod: ModuleDefinition = {
	name: "home",
	description: "首页模块",
	version: "1.0.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	lifecycle: {
		async onInit(ctx) {
			// scoped request 边界：home 图表接口收敛在 /home 前缀内（D11）；
			// 绑定后 pages/components 才能经 api/client 发请求（AC-D8）
			ctx.register.apiPrefix("/home");
			bindRequest(ctx.utils.request);
		},
	},
};

export default mod;
