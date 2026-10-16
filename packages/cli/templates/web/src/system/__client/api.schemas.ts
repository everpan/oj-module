/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"systemLoginMethodsGet": {
		data: z.object({
	"methods": z.array(z.string())
}),
	},
	"systemOplogGet": {
		query: z.object({
	"action": z.string().optional(),
	"username": z.string().optional(),
	"module": z.string().optional(),
	"limit": z.number().min(1).max(200).optional()
}),
		data: z.object({
	"list": z.array(z.object({
	"id": z.number(),
	"create_time": z.number(),
	"user_id": z.number(),
	"username": z.string(),
	"action": z.string(),
	"module": z.string(),
	"version": z.string().nullable(),
	"target": z.string().nullable(),
	"detail": z.string().nullable(),
	"level": z.number()
})),
	"total": z.number(),
	"truncated": z.boolean()
}),
	},
	"systemPermissionsGet": {
		data: z.array(z.object({
	"code": z.string(),
	"module": z.string(),
	"title_key": z.string().nullable(),
	"deprecated": z.boolean()
})),
	},
	"systemRolesGet": {
		data: z.array(z.object({
	"name": z.string(),
	"module": z.string(),
	"title": z.string().nullable(),
	"description": z.string().nullable(),
	"builtin": z.boolean(),
	"deprecated": z.boolean(),
	"holders": z.number(),
	"permissions": z.array(z.string())
})),
	},
	"systemRolesPost": {
		body: z.object({
	"name": // @oj-warn: pattern="^custom\\.[a-z0-9][a-z0-9-]*$" 为 Rust regex，未在前端执行（跨语言语义漂移/ReDoS 风险）
	z.string(),
	"title": z.string().min(1),
	"permissions": z.array(z.string()).optional()
}),
		data: z.object({
	"name": z.string(),
	"module": z.string()
}),
	},
	"systemRolesDelete": {
		query: z.object({
	"name": z.string().min(1)
}),
	},
	"systemRolesBindingsPut": {
		query: z.object({
	"name": z.string().min(1)
}),
		body: z.object({
	"permissions": z.array(z.string())
}),
	},
	"systemSettingsGet": {
		data: z.array(z.object({
	"group": z.string(),
	"items": z.array(z.object({
	"key": z.string(),
	"module": z.string(),
	"group": z.string(),
	"type": z.string(),
	"value": z.string().nullable(),
	"default_value": z.string().nullable(),
	"label_key": z.string().nullable(),
	"options": z.string().nullable(),
	"secret": z.boolean(),
	"update_time": z.number()
}))
})),
	},
	"systemSettingsPut": {
		body: z.object({
	"key": z.string().min(1),
	"value": z.string()
}),
	},
	"systemUsersGet": {
		data: z.array(z.object({
	"id": z.number(),
	"username": z.string(),
	"display_name": z.string().nullable(),
	"email": z.string().nullable(),
	"is_forbidden": z.boolean(),
	"must_change": z.boolean(),
	"roles": z.array(z.string())
})),
	},
	"systemUsersPost": {
		body: z.object({
	"username": z.string().min(1),
	"password": z.string().min(6),
	"displayName": z.string().optional(),
	"email": z.string().optional()
}),
		data: z.object({
	"id": z.number()
}),
	},
	"systemUsersForbiddenPut": {
		query: z.object({
	"uid": z.number()
}),
		body: z.object({
	"forbidden": z.boolean()
}),
	},
	"systemUsersPasswordPut": {
		query: z.object({
	"uid": z.number()
}),
		body: z.object({
	"password": z.string().min(6)
}),
	},
	"systemUsersRolesPut": {
		query: z.object({
	"uid": z.number()
}),
		body: z.object({
	"roles": z.array(z.string())
}),
	},
};
