import type { AppRouteRecordRaw, ModuleDefinition } from "@react-antd-module/runtime";

import { HomeOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

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
};

export default mod;
