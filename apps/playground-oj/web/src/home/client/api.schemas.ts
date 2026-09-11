/* eslint-disable */
// 生成物：ojm api 从契约生成，勿手改（改动请改契约文件后重跑 ojm api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@oj-module/runtime";

export const schemas = {
	fetchLine: {
		body: z.object({
	range: z.string(),
}),
		data: z.array(z.number()),
	},
	fetchPie: {
		query: z.object({
	by: z.union([z.string(), z.number()]),
}),
		data: z.array(z.object({
	value: z.number(),
	code: z.string(),
})),
	},
};
