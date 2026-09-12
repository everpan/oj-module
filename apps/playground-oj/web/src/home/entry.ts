import type { AppRouteRecordRaw, ModuleDefinition } from "@oj-module/runtime";

import { HomeOutlined } from "@ant-design/icons";
import { createElement, lazy } from "react";

import { createHomeClient } from "./client/api";

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
		// P4-1：home 图表走本模块契约（apiPrefix=/home）。构造即接线：登记前缀 +
		// 绑定 scoped request（AC-D8 能力持有者）；页面仍直接 import 本模块 client 的
		// 裸 export 函数（一模块一 client，request 槽即此处绑定）。
		async onInit(ctx) {
			createHomeClient(ctx);
		},
	},
};

export default mod;
