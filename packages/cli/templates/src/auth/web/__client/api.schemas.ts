/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"authPasswordPut": {
		body: z.object({
	"old_password": z.string().min(1),
	"new_password": z.string().min(6)
}),
	},
	"authWecomAdminAppsGet": {
		data: z.array(z.object({
	"suite_id": z.string(),
	"corp_id": z.string(),
	"agent_id": z.string(),
	"auth_corp_id": z.string(),
	"env": z.string(),
	"corp_name": z.string().nullable().optional(),
	"status": z.enum(["active", "disabled"]),
	"auth_mode": z.number(),
	"installed_at": z.number(),
	"update_time": z.number()
})),
	},
	"authWecomAdminStatusPost": {
		body: z.object({
	"corpId": z.string().min(1),
	"agentId": z.string().min(1),
	"status": z.enum(["active", "disabled"])
}),
		data: z.object({
	"updated": z.number(),
	"revokedSessions": z.number()
}),
	},
	"authWecomAdminInstallGet": {
		data: z.object({
	"installUrl": z.string(),
	"callbackUrl": z.string(),
	"expiresIn": z.number()
}),
	},
	"authWecomTicketPost": {
		body: z.object({
	"ticket": z.string().min(32).max(128)
}),
	},
	"authWecomSyncStartPost": {
		body: z.object({
	"agent": z.string().optional()
}),
		data: z.object({
	"connected": z.boolean(),
	"authMode": z.number(),
	"profileStatus": z.string().nullable(),
	"status": z.enum(["idle", "running", "done", "failed", "cancelled"]),
	"phase": z.enum(["departments", "members", "reconcile"]),
	"stats": z.object({
	"departments": z.number(),
	"members": z.number(),
	"skipped": z.number(),
	"reconciled": z.boolean()
}),
	"progress": z.object({
	"done": z.number(),
	"total": z.number()
}),
	"errCode": z.string().nullable(),
	"errDetail": z.object({
	"errcode": z.number().optional(),
	"phase": z.enum(["departments", "members", "reconcile"]).optional(),
	"deptId": z.string().optional(),
	"at": z.number().optional()
}).nullable(),
	"startedAt": z.number(),
	"finishedAt": z.number(),
	"updateTime": z.number()
}),
	},
	"authWecomSyncStatusGet": {
		query: z.object({
	"agent": z.string().optional()
}),
		data: z.object({
	"connected": z.boolean(),
	"authMode": z.number(),
	"profileStatus": z.string().nullable(),
	"status": z.enum(["idle", "running", "done", "failed", "cancelled"]),
	"phase": z.enum(["departments", "members", "reconcile"]),
	"stats": z.object({
	"departments": z.number(),
	"members": z.number(),
	"skipped": z.number(),
	"reconciled": z.boolean()
}),
	"progress": z.object({
	"done": z.number(),
	"total": z.number()
}),
	"errCode": z.string().nullable(),
	"errDetail": z.object({
	"errcode": z.number().optional(),
	"phase": z.enum(["departments", "members", "reconcile"]).optional(),
	"deptId": z.string().optional(),
	"at": z.number().optional()
}).nullable(),
	"startedAt": z.number(),
	"finishedAt": z.number(),
	"updateTime": z.number()
}),
	},
	"authWecomSyncCancelPost": {
		body: z.object({
	"agent": z.string().optional()
}),
		data: z.object({
	"connected": z.boolean(),
	"authMode": z.number(),
	"profileStatus": z.string().nullable(),
	"status": z.enum(["idle", "running", "done", "failed", "cancelled"]),
	"phase": z.enum(["departments", "members", "reconcile"]),
	"stats": z.object({
	"departments": z.number(),
	"members": z.number(),
	"skipped": z.number(),
	"reconciled": z.boolean()
}),
	"progress": z.object({
	"done": z.number(),
	"total": z.number()
}),
	"errCode": z.string().nullable(),
	"errDetail": z.object({
	"errcode": z.number().optional(),
	"phase": z.enum(["departments", "members", "reconcile"]).optional(),
	"deptId": z.string().optional(),
	"at": z.number().optional()
}).nullable(),
	"startedAt": z.number(),
	"finishedAt": z.number(),
	"updateTime": z.number()
}),
	},
};
