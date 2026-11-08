/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"ojMarketInstallPost": {
		body: z.object({
	"source": z.enum(["cdn", "file"]),
	"name": z.string(),
	"version": z.string().nullable().optional(),
	"force": z.boolean().optional()
}),
		data: z.object({
	"task_id": z.string().optional()
}).catchall(z.unknown()),
	},
	"ojMarketInstallCancelPost": {
		body: z.object({
	"name": z.string()
}),
		data: z.object({
	"ok": z.boolean().optional(),
	"name": z.string().optional(),
	"requested": z.boolean().optional()
}).catchall(z.unknown()),
	},
	"ojMarketTaskGet": {
		query: z.object({
	"id": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketEnablePost": {
		body: z.object({
	"name": z.string(),
	"enabled": z.boolean()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketMetaGet": {
		data: z.object({
	"apiVersion": z.string().optional()
}).catchall(z.unknown()),
	},
	"ojMarketTrustGet": {
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketTrustPost": {
		body: z.object({
	"task_id": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketTrustKeyPost": {
		body: z.object({
	"key_id": z.string(),
	"public_key": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketTrustKeyDelete": {
		query: z.object({
	"key_id": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketIndexGet": {
		query: z.object({
	"page": z.number().min(1).optional(),
	"size": z.number().min(1).max(200).optional()
}),
		data: z.object({
	"list": z.array(z.object({

}).catchall(z.unknown())),
	"total": z.number(),
	"page": z.number(),
	"size": z.number()
}),
	},
	"ojMarketCatalogGet": {
		query: z.object({
	"page": z.number().min(1).optional(),
	"size": z.number().min(1).max(200).optional()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketCatalogDetailGet": {
		query: z.object({
	"name": z.string(),
	"version": z.string().optional()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketYankPost": {
		body: z.object({
	"product": z.string(),
	"version": z.string(),
	"reason": z.string().optional(),
	"by": z.string().optional(),
	"restore": z.boolean().optional()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketUninstallImpactGet": {
		query: z.object({
	"name": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketUninstallPost": {
		body: z.object({
	"name": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketHistoryGet": {
		data: z.array(z.object({

}).catchall(z.unknown())),
	},
	"ojMarketHistoryDelete": {
		query: z.object({
	"name": z.string(),
	"version": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
	"ojMarketReleasesGet": {
		query: z.object({
	"page": z.number().min(1).optional(),
	"limit": z.number().min(1).max(200).optional()
}),
		data: z.object({
	"list": z.array(z.object({

}).catchall(z.unknown())),
	"total": z.number(),
	"page": z.number(),
	"size": z.number()
}),
	},
	"ojMarketCdnUploadPost": {
		query: z.object({
	"name": z.string()
}),
		data: z.object({

}).catchall(z.unknown()),
	},
};
