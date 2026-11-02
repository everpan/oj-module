/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"authLoginPost": {
		body: z.object({
	"username": z.string().min(1),
	"password": z.string().min(1)
}),
		data: z.object({
	"access_token": z.string(),
	"refresh_token": z.string(),
	"expires_in": z.number(),
	"restricted": z.boolean(),
	"user": z.object({
	"id": z.number(),
	"username": z.string(),
	"display_name": z.string().nullable(),
	"avatar_base64": z.string().nullable(),
	"must_change": z.boolean(),
	"roles": z.array(z.string())
})
}),
	},
	"authLogoutPost": {
		body: z.object({
	"refresh_token": z.string().min(1)
}),
		data: z.null(),
	},
	"authRefreshPost": {
		body: z.object({
	"refresh_token": z.string().min(1)
}),
		data: z.object({
	"access_token": z.string(),
	"refresh_token": z.string(),
	"expires_in": z.number(),
	"restricted": z.boolean(),
	"user": z.object({
	"id": z.number(),
	"username": z.string(),
	"display_name": z.string().nullable(),
	"avatar_base64": z.string().nullable(),
	"must_change": z.boolean(),
	"roles": z.array(z.string())
})
}),
	},
	"authPasswordPut": {
		body: z.object({
	"old_password": z.string().min(1),
	"new_password": z.string().min(6)
}),
		data: z.object({
	"access_token": z.string(),
	"refresh_token": z.string(),
	"expires_in": z.number(),
	"restricted": z.boolean(),
	"user": z.object({
	"id": z.number(),
	"username": z.string(),
	"display_name": z.string().nullable(),
	"avatar_base64": z.string().nullable(),
	"must_change": z.boolean(),
	"roles": z.array(z.string())
})
}),
	},
	"authLdapLoginPost": {
		body: z.object({
	"username": z.string().min(1),
	"password": z.string().min(1)
}),
		data: z.object({
	"access_token": z.string(),
	"refresh_token": z.string(),
	"expires_in": z.number(),
	"restricted": z.boolean(),
	"user": z.object({
	"id": z.number(),
	"username": z.string(),
	"display_name": z.string().nullable(),
	"avatar_base64": z.string().nullable(),
	"must_change": z.boolean(),
	"roles": z.array(z.string())
})
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
	"credential_kind": z.enum(["suite", "corp"]),
	"auth_mode": z.number(),
	"installed_at": z.number(),
	"update_time": z.number()
})),
	},
	"authWecomAdminOverviewGet": {
		data: z.object({
	"kinds": z.array(z.enum(["suite", "corp"])),
	"configError": z.string().nullable(),
	"callbackUrl": z.string().nullable(),
	"corpId": z.string().nullable(),
	"agentId": z.string().nullable(),
	"corpCallbackConfigured": z.boolean()
}),
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
	"authWecomAdminConnectPost": {
		data: z.object({
	"corpId": z.string(),
	"agentId": z.string(),
	"departments": z.number(),
	"members": z.number()
}),
	},
	"authWecomAdminTenantAdminGet": {
		query: z.object({
	"corpId": z.string().min(1)
}),
		data: z.object({
	"corpId": z.string(),
	"username": z.string(),
	"exists": z.boolean(),
	"mustChange": z.boolean()
}),
	},
	"authWecomAdminTenantAdminPasswordPost": {
		body: z.object({
	"corpId": z.string().min(1),
	"password": z.string().min(6)
}),
		data: z.object({
	"corpId": z.string(),
	"username": z.string(),
	"exists": z.boolean(),
	"mustChange": z.boolean()
}),
	},
	"authWecomTicketPost": {
		body: z.object({
	"ticket": z.string().min(32).max(128)
}),
		data: z.object({
	"access_token": z.string(),
	"refresh_token": z.string(),
	"expires_in": z.number(),
	"restricted": z.boolean(),
	"user": z.object({
	"id": z.number(),
	"username": z.string(),
	"display_name": z.string().nullable(),
	"avatar_base64": z.string().nullable(),
	"must_change": z.boolean(),
	"roles": z.array(z.string())
})
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
	"agentId": z.string().nullable(),
	"credentialKind": z.union([z.literal("suite"), z.literal("corp"), z.literal(null)]).nullable(),
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
	"agentId": z.string().nullable(),
	"credentialKind": z.union([z.literal("suite"), z.literal("corp"), z.literal(null)]).nullable(),
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
	"agentId": z.string().nullable(),
	"credentialKind": z.union([z.literal("suite"), z.literal("corp"), z.literal(null)]).nullable(),
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
