/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"platformMarketInstallPost": {
		body: z.object({
	"source": z.enum(["cdn", "file"]),
	"name": z.string(),
	"version": z.string().nullable().optional()
}),
		data: z.object({
	"task_id": z.string().optional()
}).catchall(z.unknown()),
	},
	"platformMarketInstallCancelPost": {
		body: z.object({
	"name": z.string()
}),
		data: z.object({
	"ok": z.boolean().optional(),
	"name": z.string().optional(),
	"requested": z.boolean().optional()
}).catchall(z.unknown()),
	},
	"platformMarketTaskGet": {
		query: z.object({
	"id": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"platformMarketEnablePost": {
		body: z.object({
	"name": z.string(),
	"enabled": z.boolean()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"platformMarketMetaGet": {
		data: z.object({
	"apiVersion": z.string().optional()
}).catchall(z.unknown()),
	},
	"platformMarketTrustGet": {
		data: z.object({

}).catchall(z.unknown()),
	},
	"platformMarketTrustPost": {
		body: z.object({
	"task_id": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"platformMarketTrustKeyPost": {
		body: z.object({
	"key_id": z.string(),
	"public_key": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"platformMarketTrustKeyDelete": {
		query: z.object({
	"key_id": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"platformMarketIndexGet": {
		data: z.array(z.object({

}).catchall(z.unknown())),
	},
	"platformMarketUninstallImpactGet": {
		query: z.object({
	"name": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"platformMarketUninstallPost": {
		body: z.object({
	"name": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"platformMarketHistoryGet": {
		data: z.array(z.object({

}).catchall(z.unknown())),
	},
	"platformOrgTreeGet": {
		query: z.object({
	"scope": z.enum(["self", "all"]).optional()
}),
		data: z.array(z.object({
	"id": z.number(),
	"parentId": z.number().nullable(),
	"name": z.string().nullable(),
	"nameEn": z.string().nullable().optional(),
	"orderNo": z.number(),
	"memberCount": z.number()
})),
	},
	"platformOrgDepartmentsGet": {
		query: z.object({
	"scope": z.enum(["self", "all"]).optional(),
	"parent": z.number().optional(),
	"keyword": z.string().optional(),
	"page": z.number().min(1).optional(),
	"size": z.number().min(1).max(200).optional()
}),
		data: z.object({
	"list": z.array(z.object({
	"id": z.number(),
	"parentId": z.number().nullable(),
	"name": z.string().nullable(),
	"nameEn": z.string().nullable().optional(),
	"orderNo": z.number(),
	"memberCount": z.number()
})),
	"total": z.number(),
	"page": z.number(),
	"size": z.number(),
	"truncated": z.boolean()
}),
	},
	"platformOrgMembersGet": {
		query: z.object({
	"scope": z.enum(["self", "all"]).optional(),
	"dept": z.number().optional(),
	"includeSub": z.string().optional(),
	"keyword": z.string().optional(),
	"page": z.number().min(1).optional(),
	"size": z.number().min(1).max(200).optional()
}),
		data: z.object({
	"list": z.array(z.object({
	"userId": z.number(),
	"username": z.string(),
	"displayName": z.string().nullable().optional(),
	"deptId": z.number(),
	"deptPath": z.array(z.string()),
	"isMain": z.boolean()
})),
	"total": z.number(),
	"page": z.number(),
	"size": z.number(),
	"truncated": z.boolean()
}),
	},
	"platformOrgUserGet": {
		query: z.object({
	"scope": z.enum(["self", "all"]).optional(),
	"uid": z.number().optional()
}),
		data: z.object({
	"userId": z.number(),
	"username": z.string(),
	"displayName": z.string().nullable().optional(),
	"position": z.string().nullable(),
	"mainDeptId": z.number().nullable(),
	"mainDeptPath": z.array(z.string()),
	"departments": z.array(z.object({
	"deptId": z.number(),
	"deptPath": z.array(z.string())
}))
}),
	},
	"platformOrgPickerGet": {
		query: z.object({
	"scope": z.enum(["self", "all"]).optional(),
	"keyword": z.string().min(2),
	"limit": z.number().min(1).max(50).optional()
}),
		data: z.object({
	"departments": z.array(z.object({
	"id": z.number(),
	"parentId": z.number().nullable(),
	"name": z.string().nullable(),
	"nameEn": z.string().nullable().optional(),
	"orderNo": z.number(),
	"memberCount": z.number()
})),
	"users": z.array(z.object({
	"userId": z.number(),
	"username": z.string(),
	"displayName": z.string().nullable().optional(),
	"deptId": z.number(),
	"deptPath": z.array(z.string()),
	"isMain": z.boolean()
}))
}),
	},
	"platformOrgResolvePost": {
		query: z.object({
	"scope": z.enum(["self", "all"]).optional()
}),
		body: z.object({
	"deptIds": z.array(z.number()).optional(),
	"userIds": z.array(z.number()).optional(),
	"includeSub": z.boolean().optional()
}),
		data: z.object({
	"userIds": z.array(z.number())
}),
	},
	"platformOrgIsMemberGet": {
		query: z.object({
	"scope": z.enum(["self", "all"]).optional(),
	"uid": z.number().optional(),
	"dept": z.number()
}),
		data: z.object({
	"isMember": z.boolean()
}),
	},
};
