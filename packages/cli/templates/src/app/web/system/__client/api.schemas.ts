/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"systemDepartmentsGet": {
		data: z.array(z.object({
	"id": z.number(),
	"origin": z.string(),
	"originId": z.string(),
	"parentId": z.number().nullable(),
	"name": z.string().nullable(),
	"nameEn": z.string().nullable().optional(),
	"orderNo": z.number(),
	"syncVisible": z.boolean(),
	"deleted": z.boolean(),
	"memberCount": z.number()
})),
	},
	"systemDepartmentsPost": {
		body: z.object({
	"name": z.string().min(1),
	"parentId": z.number().nullable().optional(),
	"nameEn": z.string().nullable().optional(),
	"orderNo": z.number().optional()
}),
		data: z.object({
	"id": z.number()
}),
	},
	"systemDepartmentsPut": {
		query: z.object({
	"id": z.number()
}),
		body: z.object({
	"name": z.string().min(1).optional(),
	"nameEn": z.string().nullable().optional(),
	"orderNo": z.number().optional()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemDepartmentsDelete": {
		query: z.object({
	"id": z.number()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemDepartmentsDetachPost": {
		query: z.object({
	"id": z.number()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemDepartmentsMembersGet": {
		query: z.object({
	"id": z.number()
}),
		data: z.array(z.object({
	"userId": z.number(),
	"deptId": z.number(),
	"orderNo": z.number(),
	"isLeader": z.boolean(),
	"isMain": z.boolean(),
	"username": z.string(),
	"displayName": z.string().nullable().optional()
})),
	},
	"systemDepartmentsMembersPost": {
		query: z.object({
	"id": z.number()
}),
		body: z.object({
	"userId": z.number(),
	"isLeader": z.boolean().optional(),
	"isMain": z.boolean().optional(),
	"orderNo": z.number().optional()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemDepartmentsMembersPut": {
		query: z.object({
	"id": z.number(),
	"userId": z.number()
}),
		body: z.object({
	"isLeader": z.boolean().optional(),
	"isMain": z.boolean().optional(),
	"orderNo": z.number().optional()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemDepartmentsMembersDelete": {
		query: z.object({
	"id": z.number(),
	"userId": z.number()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemDepartmentsMovePut": {
		query: z.object({
	"id": z.number()
}),
		body: z.object({
	"parentId": z.number().nullable()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemLoginMethodsGet": {
		data: z.object({
	"methods": z.array(z.string()),
	"site_title": z.string()
}),
	},
	"systemOplogGet": {
		query: z.object({
	"action": z.string().optional(),
	"username": z.string().optional(),
	"module": z.string().optional(),
	"page": z.number().min(1).optional(),
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
	"systemOplogPost": {
		body: z.object({
	"action": z.string().min(1),
	"module": z.string().min(1),
	"version": z.string().optional(),
	"target": z.string().optional(),
	"level": z.number().optional()
}),
		data: z.object({
	"ok": z.boolean()
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
	"title_key": z.string().nullable(),
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
		data: z.null(),
	},
	"systemRolesBindingsPut": {
		query: z.object({
	"name": z.string().min(1)
}),
		body: z.object({
	"permissions": z.array(z.string())
}),
		data: z.null(),
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
		data: z.null(),
	},
	"systemUsersGet": {
		data: z.array(z.object({
	"id": z.number(),
	"username": z.string(),
	"display_name": z.string().nullable(),
	"email": z.string().nullable(),
	"position": z.string().nullable(),
	"employee_no": z.string().nullable().optional(),
	"phone_number": z.string().nullable().optional(),
	"departments": z.array(z.object({
	"id": z.number(),
	"name": z.string().nullable(),
	"isMain": z.boolean()
})),
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
	"systemUsersDelete": {
		query: z.object({
	"uid": z.number()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemUsersForbiddenPut": {
		query: z.object({
	"uid": z.number()
}),
		body: z.object({
	"forbidden": z.boolean()
}),
		data: z.null(),
	},
	"systemUsersPasswordPut": {
		query: z.object({
	"uid": z.number()
}),
		body: z.object({
	"password": z.string().min(6)
}),
		data: z.null(),
	},
	"systemUsersProfilePut": {
		query: z.object({
	"uid": z.number()
}),
		body: z.object({
	"displayName": z.string().nullable().optional(),
	"email": z.string().nullable().optional(),
	"position": z.string().nullable().optional()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"systemUsersRolesPut": {
		query: z.object({
	"uid": z.number()
}),
		body: z.object({
	"roles": z.array(z.string())
}),
		data: z.null(),
	},
	"systemBotBindingGet": {
		data: z.array(z.object({
	"provider": z.string(),
	"external_sub": z.string(),
	"user_id": z.string(),
	"last_used_at": z.number(),
	"created_by": z.string(),
	"created_at": z.number()
})),
	},
	"systemBotBindingPost": {
		body: z.object({
	"provider": z.string().min(1),
	"external_sub": z.string().min(1),
	"user_id": z.string().min(1)
}),
		data: z.object({
	"op": z.enum(["insert", "update"])
}),
	},
	"systemBotBindingDelete": {
		query: z.object({
	"provider": z.string().min(1),
	"external_sub": z.string().min(1)
}),
		data: z.object({
	"deleted": z.number()
}),
	},
	"systemBotBindingImportPost": {
		body: z.object({
	"csv": z.string()
}),
		data: z.object({
	"imported": z.number(),
	"skipped": z.array(z.string()),
	"total": z.number()
}),
	},
	"systemBotCleanupPost": {
		body: z.object({
	"confirm": z.union([z.literal(true)])
}),
		data: z.object({
	"svc_tokens": z.number(),
	"bindings": z.number(),
	"audit_rows": z.number()
}),
	},
	"systemOboAuditGet": {
		query: z.object({
	"svc": z.string().optional(),
	"ok": z.string().optional(),
	"pageSize": z.number().min(1).optional(),
	"current": z.number().min(1).optional()
}),
		data: z.object({
	"list": z.array(z.object({
	"id": z.number(),
	"svc": z.string(),
	"provider": z.string(),
	"external_sub": z.string(),
	"user_id": z.string(),
	"ok": z.number(),
	"reason": z.string(),
	"ts": z.number()
})),
	"total": z.number(),
	"pageSize": z.number(),
	"current": z.number()
}),
	},
	"systemServiceTokenGet": {
		data: z.array(z.object({
	"jti": z.string(),
	"name": z.string(),
	"scopes": z.array(z.string()),
	"created_by": z.string(),
	"created_at": z.number(),
	"expires_at": z.number(),
	"status": z.string(),
	"grace_until": z.number()
})),
	},
	"systemServiceTokenPost": {
		body: z.object({
	"name": z.string().min(1),
	"scopes": z.array(z.enum(["read", "write", "destructive"])).optional(),
	"ttl_days": z.number().int().min(0).max(90).optional()
}),
		data: z.object({
	"token": z.string(),
	"jti": z.string()
}),
	},
	"systemServiceTokenDelete": {
		query: z.object({
	"jti": z.string().min(1)
}),
		data: z.object({
	"revoked": z.number()
}),
	},
};
