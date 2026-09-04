import { defineApi, z } from "@react-antd-module/contract";

/**
 * demo 模块契约（模块目标试点，Task 5.2）。
 *
 * 纯前端工程无后端：`ram dev` 下由契约驱动 mock（Task 4.2）按 data schema
 * 生成示例数据兜底——本文件即 demo 页列表的「后端」。
 */
export const getTodoList = defineApi({
	apiPrefix: "/demo",
	route: "/todos",
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
	description: "演示待办列表",
});
