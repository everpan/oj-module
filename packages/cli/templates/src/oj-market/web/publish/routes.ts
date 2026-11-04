import type { AppRouteRecordRaw, ModuleContext } from "@oj-module/runtime";

import { KeyOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

import { createPublishClient } from "./__client";

const PublishPage = lazy(() => import("./pages"));

/**
 * 发布管理根 `/publish`（独立一级菜单）。
 *
 * 与「审核类」页面不同，这里**不挂 handle.roles**：申请发布凭证是普通登录用户的能力，
 * 超管多出来的只是「看到所有租户的记录」，由后端按角色决定返回范围，前端不重复判权。
 */
export const routes: AppRouteRecordRaw[] = [
	{
		path: "/publish",
		handle: {
			layout: "container",
			order: 115,
			title: "publish:menu.publish",
			icon: createElement(KeyOutlined),
		},
		children: [
			{
				index: true,
				Component: PublishPage,
				handle: {
					title: "publish:menu.publish",
					icon: createElement(KeyOutlined),
				},
			},
		],
	},
];

/** 构造即接线：登记契约前缀 /publish + 绑定 scoped request，页面直接 import 的函数才有通道 */
export function onInit(ctx: ModuleContext): void {
	createPublishClient(ctx);
}
