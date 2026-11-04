import type { AppRouteRecordRaw, ModuleContext } from "@oj-module/runtime";

import { HistoryOutlined, KeyOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

import { createPublishClient } from "./__client";

const PublishPage = lazy(() => import("./pages"));
const ReleaseHistoryPage = lazy(() => import("./pages/history"));

/**
 * 「方案市场」下的两个子页（单模单根：菜单只有 `/oj-market` 一个根）。
 *
 * 路径是**相对父路由**声明的：`publish` → `/oj-market/publish`，`history` → `/oj-market/history`。
 * 发布管理不挂 handle.roles：申请发布凭证是普通登录用户的能力，超管多出来的只是
 * 「看到所有租户的凭证」，由后端按角色决定返回范围，前端不重复判权。
 */
export const routes: AppRouteRecordRaw[] = [
	{
		path: "publish",
		Component: PublishPage,
		handle: {
			title: "publish:menu.publish",
			icon: createElement(KeyOutlined),
		},
	},
	{
		path: "history",
		Component: ReleaseHistoryPage,
		handle: {
			title: "publish:menu.history",
			icon: createElement(HistoryOutlined),
		},
	},
];

/** 构造即接线：登记契约前缀 /publish + 绑定 scoped request，页面直接 import 的函数才有通道 */
export function onInit(ctx: ModuleContext): void {
	createPublishClient(ctx);
}
