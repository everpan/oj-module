/* eslint-disable */
// 生成物：ram api 从契约生成，勿手改（改动请改契约文件后重跑 ram api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "zod";

export const schemas = {
	fetchAddRoleItem: {
		body: z.object({
	id: z.number().optional(),
	name: z.string(),
	code: z.string(),
	status: z.union([z.literal(1), z.literal(0)]),
	remark: z.string().optional(),
	menus: z.array(z.number()).optional(),
}),
		data: z.object({
	id: z.number().optional(),
	name: z.string(),
	code: z.string(),
	status: z.union([z.literal(1), z.literal(0)]),
	remark: z.string().optional(),
	menus: z.array(z.number()).optional(),
}),
	},
	fetchDeleteRoleItem: {
		body: z.number(),
		data: z.number(),
	},
	fetchMenuByRoleId: {
		query: z.object({
	id: z.number(),
}),
		data: z.array(z.number()),
	},
	fetchRoleList: {
		query: z.object({
	name: z.string().optional(),
	code: z.string().optional(),
	status: z.union([z.literal(1), z.literal(0)]).optional(),
	current: z.number().optional(),
	pageSize: z.number().optional(),
}),
		data: z.object({
	list: z.array(z.object({
		id: z.number(),
		createTime: z.number(),
		updateTime: z.number(),
		name: z.string(),
		code: z.string(),
		status: z.union([z.literal(1), z.literal(0)]),
		remark: z.string(),
	})),
	total: z.number(),
	pageSize: z.number(),
	current: z.number(),
}),
	},
	fetchRoleMenu: {
		data: z.array(z.object({
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
})),
	},
	fetchUpdateRoleItem: {
		body: z.object({
	id: z.number().optional(),
	name: z.string(),
	code: z.string(),
	status: z.union([z.literal(1), z.literal(0)]),
	remark: z.string().optional(),
	menus: z.array(z.number()).optional(),
}),
		data: z.object({
	id: z.number().optional(),
	name: z.string(),
	code: z.string(),
	status: z.union([z.literal(1), z.literal(0)]),
	remark: z.string().optional(),
	menus: z.array(z.number()).optional(),
}),
	},
};
