/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	"personalCenterProfilePost": {
		body: z.object({
	"username": z.string().optional(),
	"email": z.string().optional(),
	"phoneNumber": z.string().optional(),
	"description": z.string().optional()
}),
		data: z.null(),
	},
	"personalCenterUploadPost": {
		data: z.string(),
	},
};
