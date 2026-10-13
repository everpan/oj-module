import { defineApi, z } from "@oj-module/runtime/contract";

/**
 * notification 模块契约（uni-dev 形态，apiPrefix 字面等于 "/notification"，AC-D9）。
 * 通知读写端点——前端经 ctx.register.notificationsApi 全量接管内置通知 API（D9 + G4）：
 * 读 + 单条已读 + 全部已读 + 清空，四端点全必填；另含发射原语端点 push/push-broadcast/del。
 */

/** 通知项（id 为命名空间串："u:<id>" 按人 / "b:<id>" 广播） */
const notificationItem = z.object({
	id: z.string(),
	scope: z.enum(["user", "broadcast"]),
	avatar: z.string(),
	date: z.string(),
	isRead: z.boolean().optional(),
	message: z.string(),
	title: z.string(),
	link: z.string().nullable().optional(),
	category: z.enum(["notice", "pm", "mention"]).optional(),
});

/* 通知列表 */
export const fetchNotifications = defineApi({
	apiPrefix: "/notification",
	route: "/notifications",
	data: z.array(notificationItem),
	description: "通知列表（按人 + 广播合并）",
});

/* 单条已读 */
export const markRead = defineApi({
	apiPrefix: "/notification",
	route: "/notifications/read",
	method: "POST",
	body: z.object({
		id: z.string(),
	}),
	description: "单条通知已读",
});

/* 全部已读 */
export const markAllRead = defineApi({
	apiPrefix: "/notification",
	route: "/notifications/read-all",
	method: "POST",
	description: "全部通知已读",
});

/* 清空通知 */
export const clearAll = defineApi({
	apiPrefix: "/notification",
	route: "/notifications/clear",
	method: "POST",
	description: "清空通知",
});

/* 推按人通知（发射原语 HTTP 入口） */
export const push = defineApi({
	apiPrefix: "/notification",
	route: "/push",
	method: "POST",
	body: z.object({
		userId: z.union([z.string(), z.number()]).optional(),
		title: z.string(),
		message: z.string(),
		link: z.string().optional(),
		avatar: z.string().optional(),
		category: z.enum(["notice", "pm", "mention"]).optional(),
	}),
	description: "推按人通知",
});

/* 广播通知（全员可见，一行存储） */
export const pushBroadcast = defineApi({
	apiPrefix: "/notification",
	route: "/push-broadcast",
	method: "POST",
	body: z.object({
		title: z.string(),
		message: z.string(),
		link: z.string().optional(),
		avatar: z.string().optional(),
		category: z.enum(["notice", "pm", "mention"]).optional(),
	}),
	description: "广播通知",
});

/* 删除通知（按人项校验归属，非本人 403；广播项仅删本人回执） */
export const del = defineApi({
	apiPrefix: "/notification",
	route: "/del",
	method: "POST",
	body: z.object({
		id: z.string(),
		userId: z.union([z.string(), z.number()]).optional(),
	}),
	description: "删除通知",
});
