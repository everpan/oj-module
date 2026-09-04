import type { AppRouteRecordRaw, ModuleDefinition } from "@react-antd-module/runtime";

import { HomeOutlined } from "@ant-design/icons";
import { createElement, lazy } from "react";

import * as homeClient from "./api/client";

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
		// P4-1：home 图表走本模块契约（apiPrefix=/home）。页面直接 import 本模块
		// client，这里把模块级 request 能力注入 client（AC-D8 能力持有者）。
		async onInit(ctx) {
			homeClient.bindRequest(ctx.utils.request);
		},
	},
};

export default mod;
