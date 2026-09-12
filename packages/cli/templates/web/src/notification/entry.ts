import type { NotificationsApiProvider } from "@oj-module/runtime";

import { defineModule } from "@oj-module/runtime";

import * as notificationClient from "./client/api";

/**
 * notification 模块（G5 模板形态，对齐 apps/playground-oj/web/src/notification）。
 *
 * 无页面路由；仅通过 onInit 全量接管通知 API（D9 + G4，四方法全必填）：
 * 把内置 root 级通知读/写收敛到本模块 `/notification` 前缀下的 oj 后端，
 * 通知铃的互动（单条已读/全部已读/清空）由此生效。
 */
export default defineModule({
	name: "notification",
	description: "通知模块（D9/G4 注入通知读写）",
	version: "0.0.2",
	peerRuntime: ">=0.0.0",
	routes: [],
	lifecycle: {
		async onInit(ctx) {
			ctx.register.apiPrefix("/notification");
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
