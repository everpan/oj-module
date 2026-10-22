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
};
