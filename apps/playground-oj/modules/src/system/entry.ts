import type { AppRouteRecordRaw, ModuleDefinition } from "@react-antd-module/runtime";

import { ApartmentOutlined, MenuOutlined, SettingOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { createElement, lazy } from "react";

const User = lazy(() => import("./pages/user"));
const Dept = lazy(() => import("./pages/dept"));
const Role = lazy(() => import("./pages/role"));
const Menu = lazy(() => import("./pages/menu"));

const routes: AppRouteRecordRaw[] = [
	{
		path: "/system",
		handle: {
			icon: createElement(SettingOutlined),
			title: "system:menu.system",
			order: 100,
			roles: ["admin"],
			layout: "container",
		},
		children: [
			{
				path: "/system/user",
				Component: User,
				handle: {
					icon: createElement(UserOutlined),
					title: "system:menu.user",
					roles: ["admin"],
					permissions: [
						"permission:button:add",
						"permission:button:update",
						"permission:button:delete",
					],
				},
			},
			{
				path: "/system/role",
				Component: Role,
				handle: {
					icon: createElement(TeamOutlined),
					title: "system:menu.role",
					roles: ["admin"],
					permissions: [
						"permission:button:add",
						"permission:button:update",
						"permission:button:delete",
					],
				},
			},
			{
				path: "/system/menu",
				Component: Menu,
				handle: {
					icon: createElement(MenuOutlined),
					title: "system:menu.menu",
					roles: ["admin"],
					permissions: [
						"permission:button:add",
						"permission:button:update",
						"permission:button:delete",
					],
				},
			},
			{
				path: "/system/dept",
				Component: Dept,
				handle: {
					keepAlive: false,
					icon: createElement(ApartmentOutlined),
					title: "system:menu.dept",
					roles: ["admin"],
					permissions: [
						"permission:button:add",
						"permission:button:update",
						"permission:button:delete",
					],
				},
			},
		],
	},
];

const mod: ModuleDefinition = {
	name: "system",
	description: "系统管理模块",
	version: "1.0.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	config: {
		requiredRoles: ["admin"],
	},
};

export default mod;
