import { defineApi, z } from "@oj-module/runtime/contract";

/**
 * notification 模块契约（uni-dev 形态，apiPrefix 字面等于 "/notification"，AC-D9）。
 * 通知读写端点——前端经 ctx.register.notificationsApi 全量接管内置通知 API（D9 + G4）：
 * 读 + 单条已读 + 全部已读 + 清空，四端点全必填。
 */

/** 通知项 */
const notificationItem = z.object({
	id: z.number(),
	avatar: z.string(),
	date: z.string(),
	isRead: z.boolean().optional(),
	message: z.string(),
	title: z.string(),
});

/* 通知列表 */
export const fetchNotifications = defineApi({
	apiPrefix: "/notification",
	route: "/notifications",
	data: z.array(notificationItem),
	description: "通知列表",
});

/* 单条已读 */
export const markRead = defineApi({
	apiPrefix: "/notification",
	route: "/notifications/read",
	method: "POST",
	body: z.object({
		id: z.number(),
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
