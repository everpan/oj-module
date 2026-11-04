/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"publishCredentialGet": {
		query: z.object({
	"page": z.number().min(1).optional(),
	"limit": z.number().min(1).max(200).optional(),
	"tenant": z.string().optional()
}),
		data: z.object({
	"list": z.array(z.object({
	"id": z.number(),
	"product": z.string(),
	"key_id": z.string(),
	"username": z.string(),
	"display_name": z.string().nullable().optional(),
	"token_hint": z.string(),
	"status": z.enum(["active", "used", "revoked", "expired"]),
	"expires_at": z.number(),
	"used_at": z.number().nullable().optional(),
	"created_at": z.number(),
	"owner_tenant": z.string().optional()
})),
	"total": z.number()
}),
	},
	"publishCredentialPost": {
		body: z.object({
	"product": z.string()
}),
		data: z.object({
	"token": z.string(),
	"key_id": z.string(),
	"product": z.string(),
	"token_hint": z.string().optional(),
	"expires_at": z.number()
}),
	},
	"publishCredentialRevokePost": {
		body: z.object({
	"id": z.number()
}),
		data: z.object({
	"ok": z.boolean()
}),
	},
	"publishCredentialExchangePost": {
		body: z.object({
	"token": z.string()
}),
		data: z.object({
	"key_id": z.string(),
	"product": z.string(),
	"username": z.string(),
	"display_name": z.string().nullable().optional()
}),
	},
};
