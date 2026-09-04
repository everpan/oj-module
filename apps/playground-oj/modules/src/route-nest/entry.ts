import type { AppRouteRecordRaw, ModuleDefinition } from "@react-antd-module/runtime";

import {
	NodeExpandOutlined,
	SisternodeOutlined,
	SubnodeOutlined,
} from "@ant-design/icons";
import { createElement, lazy } from "react";

const Menu1And1 = lazy(() => import("./pages/menu1/menu1-1"));
const Menu1And2 = lazy(() => import("./pages/menu1/menu1-2"));
const Menu2 = lazy(() => import("./pages/menu2"));

const routes: AppRouteRecordRaw[] = [
	{
		path: "/route-nest",
		handle: {
			order: 20,
			title: "route-nest:menu.nestMenus",
			icon: createElement(NodeExpandOutlined),
			layout: "container",
		},
		children: [
			{
				path: "/route-nest/menu1",
				handle: {
					title: "route-nest:menu.menu1",
					icon: createElement(SisternodeOutlined),
					layout: "parent",
				},
				children: [
					{
						path: "/route-nest/menu1/menu1-1",
						Component: Menu1And1,
						handle: {
							title: "route-nest:menu.menu1-1",
							icon: createElement(SubnodeOutlined),
						},
					},
					{
						path: "/route-nest/menu1/menu1-2",
						Component: Menu1And2,
						handle: {
							title: "route-nest:menu.menu1-2",
							icon: createElement(SubnodeOutlined),
						},
					},
				],
			},
			{
				path: "/route-nest/menu2",
				Component: Menu2,
				handle: {
					title: "route-nest:menu.menu2",
					icon: createElement(SubnodeOutlined),
				},
			},
		],
	},
];

const mod: ModuleDefinition = {
	name: "route-nest",
	description: "嵌套路由模块",
	version: "1.0.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
};

export default mod;
