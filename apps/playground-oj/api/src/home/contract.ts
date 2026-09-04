import { defineApi, z } from "@react-antd-module/contract";

/**
 * home 模块契约（uni-dev 形态，apiPrefix 字面等于 "/home"，AC-D9）。
 * 与运行时内置 home/pie、home/line 线协议对齐，前缀收敛到 /home。
 */

/** 饼图单项：value 数值 + code 维度键 */
const pieData = z.object({
	value: z.number(),
	code: z.string(),
});

/* 饼图数据 */
export const fetchPie = defineApi({
	apiPrefix: "/home",
	route: "/pie",
	query: z.object({
		by: z.union([z.string(), z.number()]),
	}),
	data: z.array(pieData),
	description: "首页饼图数据",
});

/* 折线图数据（按时间范围） */
export const fetchLine = defineApi({
	apiPrefix: "/home",
	route: "/line",
	method: "POST",
	body: z.object({
		range: z.string(),
	}),
	data: z.array(z.number()),
	description: "首页折线图数据",
});
