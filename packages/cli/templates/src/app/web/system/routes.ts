import type { AppRouteRecordRaw, ModuleContext } from "@oj-module/runtime";

import { SettingOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

// 方案安装入口（Phase B T3）：平台内置编排面 /api/oj-market/*（api 随脚手架内置，R29
// 第一方专用）由 system 域代管。用生成物明示的 bindRequest 逃生门而非
// createOjMarketClient 工厂——后者 DEV 有跨模块认领告警（该 client 名义属 oj-market）。
import { bindRequest as bindMarketRequest } from "../../../oj-market/web/__client";
import { createSystemClient } from "./__client";

const Users = lazy(() => import("./pages/users"));
const UserRoles = lazy(() => import("./pages/users/roles"));
const Departments = lazy(() => import("./pages/departments"));
const Roles = lazy(() => import("./pages/roles"));
const Oplog = lazy(() => import("./pages/oplog"));
const Settings = lazy(() => import("./pages/settings"));
const WecomAdmin = lazy(() => import("./pages/wecom"));
const Mcp = lazy(() => import("./pages/mcp"));
const Bot = lazy(() => import("./pages/bot"));

/**
 * `/system` 根的角色门禁（对齐后端 assertSystemAdmin，access.ts:87）——
 * superadmin **或** admin 均可，两者必须同时保留：D12（2026-10-22）起账号名=角色名，
 * admin 与 superadmin 是两个独立账号（seed.sql），只留 ["admin"] 会把 superadmin
 * 挡在门外（注册期过滤 → 路由消失 → 登录后 404 兜底）。改这两个值前先跑
 * tests/system-guard.regression.spec.ts。
 */
const SYSTEM_ROLES = ["admin", "superadmin"];

/**
 * 系统管理根 `/system`：框架管理面。三级菜单（2026-11-08）——二级 `框架管理`
 * （/system/framework，纯分组无页面）下挂用户/成员资格/角色权限/操作日志/站点设置/登录方式，
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
				// 三级菜单（2026-11-08）：系统管理 → 框架管理 → 各功能页。
				// 中间层没有自己的页面，layout: "parent" 只提供子路由出口（与 route-nest 同构）。
				path: "/system/framework",
				handle: { title: "system:menu.framework", layout: "parent" },
				children: [
					{
						path: "/system/framework/users",
						Component: Users,
						handle: { title: "system:menu.users" },
					},
					{
						// 成员资格（superadmin 入口从用户管理页进入，菜单不出现）
						path: "/system/framework/users/:uid/roles",
						Component: UserRoles,
						handle: { title: "system:menu.userRoles", hideInMenu: true },
					},
					{
						path: "/system/framework/departments",
						Component: Departments,
						handle: { title: "system:menu.departments" },
					},
					{
						path: "/system/framework/roles",
						Component: Roles,
						handle: { title: "system:menu.roles" },
					},
					{
						path: "/system/framework/oplog",
						Component: Oplog,
						handle: { title: "system:menu.oplog" },
					},
					{
						// 站点设置（证书/站点级开关）：仅超管可见可访问
						path: "/system/framework/settings",
						Component: Settings,
						handle: { title: "system:menu.settings", roles: ["superadmin"] },
					},
					{
						// 企微代开发后台（服务商运营面）：仅超管可见（路由级 roles + 页面内二次判定）
						path: "/system/framework/wecom",
						Component: WecomAdmin,
						handle: { title: "system:menu.wecom", roles: ["superadmin"] },
					},
					{
						// MCP 服务管理（20261110-1027 §4.3）：本站已装方案的 mcp 工具目录只读展示
						path: "/system/framework/mcp",
						Component: Mcp,
						handle: { title: "system:menu.mcp", roles: ["superadmin"] },
					},
					{
						// 机器人接入管理端（mcp-bot-guide 线路 B）：svc 凭据 / 员工绑定 / 换签审计 / 接入指引
						path: "/system/framework/bot",
						Component: Bot,
						handle: { title: "system:menu.bot", roles: SYSTEM_ROLES },
					},
				],
			},
		],
	},
];

/**
 * 构造即接线：登记 /system 前缀 + 绑定 scoped request（D11 前缀收敛）；
 *  另登记 /oj-market（平台内置市场编排面，R29 第一方）并绑定其生成 client——
 *  方案市场默认安装（2026-11-07 策略变更）——安装/升级端点由方案市场页自身消费；
 *  原「方案安装」首装页已整建制退役（2026-11-07，退役钉 tests/solutions-entry.spec）。
 */
export async function onInit(ctx: ModuleContext) {
	createSystemClient(ctx);
	ctx.register.apiPrefix("/oj-market");
	bindMarketRequest(ctx.utils.request);
}
