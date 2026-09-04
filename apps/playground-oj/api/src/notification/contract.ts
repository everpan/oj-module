import { defineApi, z } from "@react-antd-module/contract";

/**
 * notification 模块契约（uni-dev 形态，apiPrefix 字面等于 "/notification"，AC-D9）。
 * 通知拉取端点——前端经 ctx.register.notificationsApi 接管内置 fetchNotifications（见 P4）。
 */

/** 通知项 */
const notificationItem = z.object({
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
