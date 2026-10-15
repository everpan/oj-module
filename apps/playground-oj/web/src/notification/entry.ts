import type { NotificationsApiProvider } from "@oj-module/runtime";

import { defineModule } from "@oj-module/runtime";

import { createNotificationClient } from "./__client/api";

/**
 * notification 壳模块（D11：补齐第 11 个模块，使清单完整）。
 *
 * 无页面路由；仅通过 onInit 全量接管通知 API（D9 + G4，四方法全必填）：
 * 把内置 root 级通知读/写收敛到本模块 `/notification` 前缀下的 oj 后端。
 */
export default defineModule({
	name: "notification",
	description: "通知模块（D9/G4 注入通知读写）",
	version: "0.0.2",
	peerRuntime: ">=0.0.0",
	routes: [],
	lifecycle: {
		async onInit(ctx) {
			// 构造即接线：createNotificationClient 登记契约前缀 /notification
			// （唯一真源在 __client/api.ts 的 API_PREFIX）+ 绑定圈好前缀的 scoped
			// request（越界/穿越发请求前即拒绝，前缀收敛 D11），返回的 client
			// 方法都自动带 /api/notification/ 前缀。
			const notificationClient = createNotificationClient(ctx);
			const provider: NotificationsApiProvider = {
				fetchNotifications: () => notificationClient.notificationNotificationsGet(),
				// id 现已为命名空间串（"u:<id>" / "b:<id>"），原样透传，勿再 Number
				markRead: id => notificationClient.notificationNotificationsReadPost({ id: String(id) }).then(() => {}),
				markAllRead: () => notificationClient.notificationNotificationsReadAllPost().then(() => {}),
				clearAll: () => notificationClient.notificationNotificationsClearPost().then(() => {}),
				// —— 发射端（跨模块原语，经 HTTP 落到后端通知模块）——
				push: input => notificationClient
					.notificationPushPost({ userId: input.userId, title: input.title, message: input.message, link: input.link, avatar: input.avatar, category: input.category })
					.then(r => String((r as { id: string }).id)),
				pushBroadcast: input => notificationClient
					.notificationPushBroadcastPost({ title: input.title, message: input.message, link: input.link, avatar: input.avatar, category: input.category })
					.then(r => String((r as { id: string }).id)),
				del: (id, userId) => notificationClient.notificationDelPost({ id: String(id), userId }).then(() => {}),
			};
			ctx.register.notificationsApi(provider);
		},
	},
});
