import type { AppRouteRecordRaw, ModuleDefinition } from "@react-antd-module/runtime";

import { CopyrightOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

const About = lazy(() => import("./pages/index"));

const routes: AppRouteRecordRaw[] = [
	{
		path: "/about",
		handle: {
			layout: "container",
			order: 120,
			title: "about:menu.about",
			icon: createElement(CopyrightOutlined),
		},
		children: [
			{
				index: true,
				Component: About,
				handle: {
					title: "about:menu.about",
					icon: createElement(CopyrightOutlined),
				},
			},
		],
	},
];

const mod: ModuleDefinition = {
	name: "about",
	description: "关于页面模块",
	version: "1.0.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
};

export default mod;
