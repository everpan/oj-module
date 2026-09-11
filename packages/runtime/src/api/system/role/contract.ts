import { defineApi, z } from "@oj-module/runtime/contract";

/**
 * 框架内部 system/role 契约（AC-D1 试点，internal 目标）。
 *
 * 线协议与 fake/system.fake.ts 对齐（契约先行，fake 按契约实现）：
 * - 端点名与历史导出函数同名（fetch*），index.ts 纯 re-export，消费方零改动
 * - apiPrefix "/"：框架内部根级端点（role-list 等无前缀段）
 */

/** 角色状态：1 启用 0 停用 */
const status = z.union([z.literal(1), z.literal(0)]);

/** 角色条目（与 types.ts 的 RoleItemType 同构） */
const roleItem = z.object({
	id: z.number(),
	createTime: z.number(),
	updateTime: z.number(),
	name: z.string(),
	code: z.string(),
	status,
	remark: z.string(),
});

/** 新增/修改提交的表单体（menus 为分配的菜单 id 列表） */
const roleForm = z.object({
	id: z.number().optional(),
	name: z.string(),
	code: z.string(),
	status,
	remark: z.string().optional(),
	menus: z.array(z.number()).optional(),
});

/**
 * 菜单项（role-menu 返回的扁平列表，前端 handleTree 转树）。
 * 与 api/system/menu/types.ts 的 MenuItemType 同构（18 字段全量），
 * 供 D9 注入的模块返回完整菜单树（含权限/图标等），消费方零改动。
 */
const menuItem = z.object({
	parentId: z.string(),
	id: z.number(),
	menuType: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
	name: z.string(),
	path: z.string(),
	component: z.string(),
	order: z.number(),
	icon: z.string(),
	currentActiveMenu: z.string(),
	iframeLink: z.string(),
	keepAlive: z.number(),
	externalLink: z.string(),
	hideInMenu: z.number(),
	ignoreAccess: z.number(),
	permission: z.string(),
	status: z.number(),
	createTime: z.number(),
	updateTime: z.number(),
});

/* 获取角色列表 */
export const fetchRoleList = defineApi({
	apiPrefix: "/",
	route: "/role-list",
	query: z.object({
		name: z.string().optional(),
		code: z.string().optional(),
		status: status.optional(),
		/* ProTable 分页参数随查询串上送 */
		current: z.number().optional(),
		pageSize: z.number().optional(),
	}),
	data: z.object({
		list: z.array(roleItem),
		total: z.number(),
		pageSize: z.number(),
		current: z.number(),
	}),
	ignoreLoading: true,
	description: "角色列表（分页）",
});

/* 新增角色 */
export const fetchAddRoleItem = defineApi({
	apiPrefix: "/",
	route: "/role-item",
	method: "POST",
	body: roleForm,
	data: roleForm,
	ignoreLoading: true,
	description: "新增角色",
});

/* 修改角色 */
export const fetchUpdateRoleItem = defineApi({
	apiPrefix: "/",
	route: "/role-item",
	method: "PUT",
	body: roleForm,
	data: roleForm,
	ignoreLoading: true,
	description: "修改角色",
});

/* 删除角色（请求体为角色 id） */
export const fetchDeleteRoleItem = defineApi({
	apiPrefix: "/",
	route: "/role-item",
	method: "DELETE",
	body: z.number(),
	data: z.number(),
	ignoreLoading: true,
	description: "删除角色",
});

/* 获取菜单 */
export const fetchRoleMenu = defineApi({
	apiPrefix: "/",
	route: "/role-menu",
	data: z.array(menuItem),
	ignoreLoading: true,
	description: "菜单权限列表（扁平，前端转树）",
});

/* 角色绑定的菜单 id */
export const fetchMenuByRoleId = defineApi({
	apiPrefix: "/",
	route: "/menu-by-role-id",
	query: z.object({ id: z.number() }),
	data: z.array(z.number()),
	description: "按角色 id 查绑定的菜单 id 列表",
});
