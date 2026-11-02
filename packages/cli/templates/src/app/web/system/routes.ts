import type { AppRouteRecordRaw, ModuleContext } from "@oj-module/runtime";

import { SettingOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

import { createSystemClient } from "./__client/api";

const Users = lazy(() => import("./pages/users"));
const UserRoles = lazy(() => import("./pages/users/roles"));
const Departments = lazy(() => import("./pages/departments"));
const Roles = lazy(() => import("./pages/roles"));
const Oplog = lazy(() => import("./pages/oplog"));
const Settings = lazy(() => import("./pages/settings"));
const LoginMethods = lazy(() => import("./pages/login-methods"));
const WecomAdmin = lazy(() => import("./pages/wecom"));

/**
 * `/system` 根的角色门禁（对齐后端 assertSystemAdmin，access.ts:87）——
 * superadmin **或** admin 均可，两者必须同时保留：D12（2026-10-22）起账号名=角色名，
 * admin 与 superadmin 是两个独立账号（seed.sql），只留 ["admin"] 会把 superadmin
 * 挡在门外（注册期过滤 → 路由消失 → 登录后 404 兜底）。改这两个值前先跑
 * tests/system-guard.regression.spec.ts。
 */
const SYSTEM_ROLES = ["admin", "superadmin"];

/**
 * 系统管理根 `/system`：框架管理面（用户/成员资格/角色权限/操作日志/站点设置/登录方式），
 * 数据源为 oj 后端 /api/system/*（模板 api 模块）。__client 由 `ojm api` 生成。
 *
 * 路由级门禁（B16）挂在根上：非系统管理员整棵子树不注入、菜单不可见（等价于原先的
 * 模块级 requiredRoles——聚合后模块级会把 /home 一起挡掉，故必须下移到根路由）；
 * API 级 403 由 assertSystemAdmin + service 层硬 enforcement 兜底。
 */
export const routes: AppRouteRecordRaw[] = [
	{
		path: "/system",
		handle: {
			icon: createElement(SettingOutlined),
			title: "system:menu.system",
			// 负 order = 底部固定区：系统管理 pin 在侧边栏底部（2026-10-20 序轴约定）
			order: -100,
			layout: "container",
			roles: SYSTEM_ROLES,
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
				path: "/system/departments",
				Component: Departments,
				handle: { title: "system:menu.departments" },
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
				// 站点设置（证书/站点级开关）：仅超管可见可访问
				path: "/system/settings",
				Component: Settings,
				handle: { title: "system:menu.settings", roles: ["superadmin"] },
			},
			{
				path: "/system/login-methods",
				Component: LoginMethods,
				handle: { title: "system:menu.loginMethods" },
			},
			{
				// 企微代开发后台（服务商运营面）：仅超管可见（路由级 roles + 页面内二次判定）
				path: "/system/wecom",
				Component: WecomAdmin,
				handle: { title: "system:menu.wecom", roles: ["superadmin"] },
			},
		],
	},
];

/** 构造即接线：登记 /system 前缀 + 绑定 scoped request（D11 前缀收敛）。 */
export async function onInit(ctx: ModuleContext) {
	createSystemClient(ctx);
}
