import type { NotificationsApiProvider } from "@react-antd-module/runtime";

import { defineModule } from "@react-antd-module/runtime";

import * as notificationClient from "./api/client";

/**
 * notification 壳模块（D11：补齐第 11 个模块，使清单完整）。
 *
 * 无页面路由；仅通过 onInit 接管通知拉取 API（D9）：把内置 root 级
 * `fetchNotifications` 收敛到本模块 `/notification` 前缀下的 oj 后端。
 */
export default defineModule({
	name: "notification",
	description: "通知模块（D9 注入通知拉取）",
	version: "0.0.1",
	peerRuntime: ">=0.0.0",
	routes: [],
	lifecycle: {
		async onInit(ctx) {
			notificationClient.bindRequest(ctx.utils.request);
			const provider: NotificationsApiProvider = {
				fetchNotifications: () => notificationClient.fetchNotifications(),
			};
			ctx.register.notificationsApi(provider);
		},
	},
});
