/* eslint-disable */
// 生成物：ram api 从契约生成，勿手改（改动请改契约文件后重跑 ram api）
// AC-D15：仅供 DEV 校验动态 import，生产构建不进产物
import { z } from "@react-antd-module/runtime";

export const schemas = {
	getTodoList: {
		query: z.object({
	keyword: z.string().optional(),
}),
		data: z.object({
	list: z.array(z.object({
		id: z.number(),
		title: z.string(),
		done: z.boolean(),
	})),
	total: z.number(),
}),
	},
};
