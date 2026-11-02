/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"webGetAsyncRoutesGet": {
		data: z.array(z.object({
	"path": z.string().optional(),
	"component": z.string().optional(),
	"children": z.array(z.object({

})).optional()
})),
	},
	"webHelloGet": {
		data: z.object({
	"message": z.string(),
	"user": z.number().nullable()
}),
	},
	"webUserInfoGet": {
		data: z.object({
	"id": z.string(),
	"avatar": z.string(),
	"username": z.string(),
	"displayName": z.string(),
	"email": z.string(),
	"phoneNumber": z.string(),
	"description": z.string(),
	"roles": z.array(z.string()),
	"mustChange": z.boolean(),
	"permissions": z.array(z.string())
}),
	},
};
