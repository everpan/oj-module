import type { NotificationsApiProvider } from "@oj-module/runtime";

import { defineModule } from "@oj-module/runtime";

import * as notificationClient from "./client/api";

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
			// 登记本模块的 API 前缀：此后 ctx.utils.request 被圈在 /notification 下——
			// 请求自动走 /api/notification/...；越界调别家模块/root 级接口、或 "../"
			// 向外穿越，都会在发请求前被客户端拒绝（前缀收敛，D11）。
			// 必须与契约里 defineApi 的 apiPrefix 一致，生成 client 的相对路由才拼得对。
			ctx.register.apiPrefix("/notification");
			// 把圈好前缀的 request 交给生成 client，之后的接口调用都带 /notification 前缀
			notificationClient.bindRequest(ctx.utils.request);
			const provider: NotificationsApiProvider = {
				fetchNotifications: () => notificationClient.fetchNotifications(),
				markRead: id => notificationClient.markRead({ id: Number(id) }).then(() => {}),
				markAllRead: () => notificationClient.markAllRead().then(() => {}),
				clearAll: () => notificationClient.clearAll().then(() => {}),
			};
			ctx.register.notificationsApi(provider);
		},
	},
});
