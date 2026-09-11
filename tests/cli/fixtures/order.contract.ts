import { defineApi, z } from "@react-antd-module/runtime/contract";

export const OrderItem = z.object({
	id: z.number(),
	order_no: z.string(),
	status: z.enum(["open", "closed"]),
});

export const getOrderList = defineApi({
	apiPrefix: "/order",
	route: "/list",
	query: z.object({ page: z.number().int().min(1), size: z.number().max(100) }),
	data: z.object({ list: z.array(OrderItem), total: z.number() }),
});

export const getOrderDetail = defineApi({
	apiPrefix: "/order",
	route: "/item/{id}",
	method: "GET",
	params: z.object({ id: z.number().int() }),
	data: OrderItem,
});

export const downloadOrderFile = defineApi({
	apiPrefix: "/order",
	route: "/file/{*path}",
	response: "raw",
});
