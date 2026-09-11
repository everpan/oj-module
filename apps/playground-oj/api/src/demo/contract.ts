import { defineApi, z } from "@oj-module/runtime/contract";

/**
 * demo 模块契约（uni-dev 形态，apiPrefix 字面等于 "/demo"，AC-D9）。
 * 由前端试点契约迁移而来：原 mock 驱动改为由 oj 后端实现（P4 落地 handler）。
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
