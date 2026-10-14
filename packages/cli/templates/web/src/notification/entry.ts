import type { NotificationsApiProvider } from "@oj-module/runtime";

import { defineModule } from "@oj-module/runtime";

import { createNotificationClient } from "./__client/api";

/**
 * notification 模块（G5 模板形态，对齐 apps/playground-oj/web/src/notification）。
 *
 * 无页面路由；仅通过 onInit 全量接管通知 API（D9 + G4）：把内置 root 级通知读/写
 * 收敛到本模块 `/notification` 前缀下的 oj 后端，通知铃的互动（单条已读/全部已读/
 * 清空）由此生效；发射端三方法（push/pushBroadcast/del）使本模块同时作为跨模块
 * 通知原语的接收端（前端 facade 委托至此）。
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
				fetchNotifications: () => notificationClient.fetchNotifications(),
				// id 为命名空间串（"u:<id>" / "b:<id>"），原样透传
				markRead: id => notificationClient.markRead({ id: String(id) }).then(() => {}),
				markAllRead: () => notificationClient.markAllRead().then(() => {}),
				clearAll: () => notificationClient.clearAll().then(() => {}),
				push: input => notificationClient
					.push({ userId: input.userId, title: input.title, message: input.message, link: input.link, avatar: input.avatar, category: input.category })
					.then(r => String((r as { id: string }).id)),
				pushBroadcast: input => notificationClient
					.pushBroadcast({ title: input.title, message: input.message, link: input.link, avatar: input.avatar, category: input.category })
					.then(r => String((r as { id: string }).id)),
				del: (id, userId) => notificationClient.del({ id: String(id), userId }).then(() => {}),
			};
			ctx.register.notificationsApi(provider);
		},
	},
});
