import { defineApi, z } from "@oj-module/runtime/contract";

/**
 * system 模块契约（uni-dev 形态，apiPrefix 字面等于 "/system"，AC-D9）。
 *
 * 角色 + 菜单类端点——与框架内置（runtime src/api/system）线协议对齐，
 * 仅前缀从根级收敛到 /system（D9 注入的目标落点）。前端 system 模块经
 * ctx.register.systemApi 接管这些端点（见 P4）。
 */

/** 角色状态：1 启用 0 停用 */
const status = z.union([z.literal(1), z.literal(0)]);

/** 角色条目 */
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

/** 菜单项（与框架内置 MenuItemType 线协议对齐；parentId 为字符串） */
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

/* 获取角色列表（分页） */
export const fetchRoleList = defineApi({
	apiPrefix: "/system",
	route: "/role-list",
	query: z.object({
		name: z.string().optional(),
		code: z.string().optional(),
		status: status.optional(),
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
	apiPrefix: "/system",
	route: "/role-item",
	method: "POST",
	body: roleForm,
	data: roleForm,
	ignoreLoading: true,
	description: "新增角色",
});

/* 修改角色 */
export const fetchUpdateRoleItem = defineApi({
	apiPrefix: "/system",
	route: "/role-item",
	method: "PUT",
	body: roleForm,
	data: roleForm,
	ignoreLoading: true,
	description: "修改角色",
});

/* 删除角色（请求体为角色 id） */
export const fetchDeleteRoleItem = defineApi({
	apiPrefix: "/system",
	route: "/role-item",
	method: "DELETE",
	body: z.number(),
	data: z.number(),
	ignoreLoading: true,
	description: "删除角色",
});

/* 获取菜单权限列表（扁平，前端转树） */
export const fetchRoleMenu = defineApi({
	apiPrefix: "/system",
	route: "/role-menu",
	data: z.array(menuItem),
	ignoreLoading: true,
	description: "菜单权限列表（扁平，前端转树）",
});

/* 按角色 id 查绑定的菜单 id 列表 */
export const fetchMenuByRoleId = defineApi({
	apiPrefix: "/system",
	route: "/menu-by-role-id",
	query: z.object({ id: z.number() }),
	data: z.array(z.number()),
	description: "按角色 id 查绑定的菜单 id 列表",
});

/* 菜单列表 */
export const fetchMenuList = defineApi({
	apiPrefix: "/system",
	route: "/menu-list",
	data: z.object({
		list: z.array(menuItem),
		total: z.number(),
		current: z.number().optional(),
	}),
	ignoreLoading: true,
	description: "菜单列表",
});

/* 新增菜单 */
export const fetchAddMenuItem = defineApi({
	apiPrefix: "/system",
	route: "/menu-item",
	method: "POST",
	body: menuItem,
	data: z.string(),
	ignoreLoading: true,
	description: "新增菜单",
});

/* 修改菜单 */
export const fetchUpdateMenuItem = defineApi({
	apiPrefix: "/system",
	route: "/menu-item",
	method: "PUT",
	body: menuItem,
	data: z.string(),
	ignoreLoading: true,
	description: "修改菜单",
});

/* 删除菜单（请求体为菜单 id） */
export const fetchDeleteMenuItem = defineApi({
	apiPrefix: "/system",
	route: "/menu-item",
	method: "DELETE",
	body: z.number(),
	data: z.string(),
	ignoreLoading: true,
	description: "删除菜单",
});
