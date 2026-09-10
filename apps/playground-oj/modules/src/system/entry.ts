import type { AppRouteRecordRaw, ModuleDefinition, SystemApiProvider } from "@react-antd-module/runtime";

import { ApartmentOutlined, MenuOutlined, SettingOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { createElement, lazy } from "react";

import * as systemClient from "./api/client";

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
	lifecycle: {
		// D9 注入：把 system 角色/菜单类端点从 runtime 根级收敛到 /system 前缀下，
		// 经生成的 uni-dev client 派发；消费点（role/menu 页）经 getSystemApiProvider
		// 委托，未注册时回落内置实现。先到先得，模块卸载时自动注销。
		async onInit(ctx) {
			ctx.register.apiPrefix("/system");
			systemClient.bindRequest(ctx.utils.request);
			// D9 边界：provider 各方法按本模块契约（playground-oj system）严格定型，
			// 整体以 SystemApiProvider 接入。框架自带 FetchRoleMenuData 仍是 3 字段投影、
			// MenuItemType.status 为字面量 1，本模块返回 18 字段全量菜单，故在此吸收边界类型差。
			const provider = {
				fetchRoleList: (q: Parameters<typeof systemClient.fetchRoleList>[0]) => systemClient.fetchRoleList(q),
				fetchAddRoleItem: (b: Parameters<typeof systemClient.fetchAddRoleItem>[0]) => systemClient.fetchAddRoleItem(b),
				fetchUpdateRoleItem: (b: Parameters<typeof systemClient.fetchUpdateRoleItem>[0]) => systemClient.fetchUpdateRoleItem(b),
				fetchDeleteRoleItem: (b: Parameters<typeof systemClient.fetchDeleteRoleItem>[0]) => systemClient.fetchDeleteRoleItem(b),
				fetchRoleMenu: () => systemClient.fetchRoleMenu(),
				fetchMenuByRoleId: (q: Parameters<typeof systemClient.fetchMenuByRoleId>[0]) => systemClient.fetchMenuByRoleId(q),
				fetchMenuList: () => systemClient.fetchMenuList(),
				fetchAddMenuItem: (d: Parameters<typeof systemClient.fetchAddMenuItem>[0]) => systemClient.fetchAddMenuItem(d),
				fetchUpdateMenuItem: (d: Parameters<typeof systemClient.fetchUpdateMenuItem>[0]) => systemClient.fetchUpdateMenuItem(d),
				fetchDeleteMenuItem: (id: Parameters<typeof systemClient.fetchDeleteMenuItem>[0]) => systemClient.fetchDeleteMenuItem(id),
			} as unknown as SystemApiProvider;
			ctx.register.systemApi(provider);
		},
	},
};

export default mod;
