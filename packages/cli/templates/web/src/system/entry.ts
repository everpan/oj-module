import type { AppRouteRecordRaw } from "@oj-module/runtime";

import { SettingOutlined } from "@ant-design/icons";
import { defineModule } from "@oj-module/runtime";

import { createElement, lazy } from "react";

import { createSystemClient } from "./__client/api";

const Users = lazy(() => import("./pages/users"));
const UserRoles = lazy(() => import("./pages/users/roles"));
const Roles = lazy(() => import("./pages/roles"));
const Oplog = lazy(() => import("./pages/oplog"));
const Settings = lazy(() => import("./pages/settings"));
const LoginMethods = lazy(() => import("./pages/login-methods"));

const routes: AppRouteRecordRaw[] = [
	{
		path: "/system",
		handle: {
			icon: createElement(SettingOutlined),
			title: "system:menu.system",
			// 负 order = 底部固定区：系统管理 pin 在侧边栏底部（2026-10-20 序轴约定）
			order: -100,
			layout: "container",
		},
		children: [
			{
				path: "/system/users",
				Component: Users,
				handle: { title: "system:menu.users" },
			},
			{
				// 成员资格（superadmin 入口从用户管理页进入，菜单不出现）
				path: "/system/users/:uid/roles",
				Component: UserRoles,
				handle: { title: "system:menu.userRoles", hideInMenu: true },
			},
			{
				path: "/system/roles",
				Component: Roles,
				handle: { title: "system:menu.roles" },
			},
			{
				path: "/system/oplog",
				Component: Oplog,
				handle: { title: "system:menu.oplog" },
			},
			{
				path: "/system/settings",
				Component: Settings,
				handle: { title: "system:menu.settings" },
			},
			{
				path: "/system/login-methods",
				Component: LoginMethods,
				handle: { title: "system:menu.loginMethods" },
			},
		],
	},
];

/**
 * system 模块：框架管理面（用户/成员资格/角色权限/操作日志/站点设置/登录方式），
 * 数据源为 oj 后端 /api/system/*（模板 api 模块）。__client 不随模板分发——
 * init 后 `oj openapi -o openapi.json` + `ojm api` 生成（生成前本文件 ts 报红属预期，
 * devkit manual §2.2）。
 */
export default defineModule({
	name: "system",
	description: "系统管理模块（框架管理面）",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	// 路由级门禁（B16）：非系统管理员不注入 /system 路由、菜单不可见；
	// API 级 403 由 assertSystemAdmin + service 层硬 enforcement 兜底。
	// 角色口径对齐后端 assertSystemAdmin（access.ts:90）——superadmin **或**
	// admin 均可；seed 的 admin 账号只有 superadmin，写 ["admin"] 会把它自己挡在门外。
	config: { requiredRoles: ["admin", "superadmin"] },
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	lifecycle: {
		async onInit(ctx) {
			// 构造即接线：登记 /system 前缀 + 绑定 scoped request（D11 前缀收敛），
			// 页面直接 import 生成的端点函数（模块级单槽 req 已由本调用绑定）。
			createSystemClient(ctx);
		},
	},
});
