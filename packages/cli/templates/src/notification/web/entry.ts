import type { AppRouteRecordRaw, NotificationsApiProvider } from "@oj-module/runtime";

import { BellOutlined } from "@ant-design/icons";
import { defineModule } from "@oj-module/runtime";

import { createElement, lazy } from "react";

import { createNotificationClient } from "./__client/api";

const NotificationCenter = lazy(() => import("./pages/center"));

/**
 * 通知中心页（N3）：全量消息 + 类型 Tab，铃铛弹层「查看全部」跳转至此。
 * hideInMenu——入口在铃铛，不占侧边导航。
 * 布局挂父路由 handle（resolveRouteLayouts 只给「无 Component 有 children」的
 * 父路由注入 layout，页面组件写父级上布局会被忽略、裸渲染无 chrome）。
 */
const routes: AppRouteRecordRaw[] = [
	{
		path: "/notification-center",
		handle: {
			layout: "container",
			title: "notification:menu.notificationCenter",
			icon: createElement(BellOutlined),
			hideInMenu: true,
		},
		children: [
			{
				index: true,
				Component: NotificationCenter,
				handle: {
					title: "notification:menu.notificationCenter",
					icon: createElement(BellOutlined),
				},
			},
		],
	},
];

/**
 * notification 模块（G5 模板形态）：通知聚合的唯一前端消费面。
 *
 * onInit 全量接管通知 API（D9 + G4）：把通知读/写收敛到本模块 `/notification`
 * 前缀下的 oj 后端，通知铃的互动（单条已读/全部已读/清空）由此生效；发射端
 * 三方法（push/pushBroadcast/del）使本模块同时作为跨模块通知原语的接收端
 * （前端 facade 委托至此）。
 */
export default defineModule({
	name: "notification",
	description: "通知模块（D9/G4 注入通知读写 + 通知中心页）",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	lifecycle: {
		async onInit(ctx) {
			// 构造即接线：createNotificationClient 登记契约前缀 /notification
			// （唯一真源在 __client/api.ts 的 API_PREFIX）+ 绑定圈好前缀的 scoped
			// request（越界/穿越发请求前即拒绝，前缀收敛 D11），返回的 client
			// 方法都自动带 /api/notification/ 前缀。
			const notificationClient = createNotificationClient(ctx);
			const provider: NotificationsApiProvider = {
				// 端点函数名由 oj operationId 派生（camelCase 子路径 + 方法），
				// 见 __client/api.ts；provider 方法名（fetchNotifications/markRead…）不变。
				fetchNotifications: () => notificationClient.notificationNotificationsGet(),
				// id 为命名空间串（"u:<id>" / "b:<id>"），原样透传
				markRead: id => notificationClient.notificationNotificationsReadPost({ id: String(id) }).then(() => {}),
				markAllRead: () => notificationClient.notificationNotificationsReadAllPost().then(() => {}),
				clearAll: () => notificationClient.notificationNotificationsClearPost().then(() => {}),
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
