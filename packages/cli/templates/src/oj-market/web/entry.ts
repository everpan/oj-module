import type { ModuleContext, ModuleI18n } from "@oj-module/runtime";

import { AppstoreOutlined } from "@ant-design/icons";
import { defineModule, OutsidePageIcon } from "@oj-module/runtime";
import { createElement } from "react";
import MarketApp from "./pages/MarketApp";
import { onInit as publishOnInit, routes as publishRoutes } from "./publish/routes";
import { onInit as marketOnInit } from "./routes";

// 方案市场前端模块（第一方专用，R29：消费 /api/oj-market/* 编排面，第三方方案不得仿照此调用面）。
// 菜单标题走 i18next 命名空间语法 "<moduleName>:menu.<key>"（i18n 资源在 locales/，安装时随包注册）。
//
// **单模单根**（2026-11-05）：菜单只有一个「方案市场」根，下挂三个子页——
//   方案清单（index）/ 发布管理（publish）/ 发布历史（history）。
// 「发布管理」与「发布历史」都归市场：发布身份是市场的准入面，页面随市场模块同版本发布、
// 同生命周期下线；子页路径是相对父路由声明的，实际 URL 为 /oj-market、/oj-market/publish、
// /oj-market/history。
const i18nNamespaces: Record<string, ModuleI18n> = {
	// 发布页沿用原命名空间：`t("publish:…")` / 菜单 `publish:menu.publish` 零改动
	publish: {
		"zh-CN": () => import("./publish/locales/zh-CN.json"),
		"en-US": () => import("./publish/locales/en-US.json"),
	},
};

export default defineModule({
	name: "oj-market",
	description: "oj 方案市场应用——方案清单 / 发布管理 / 发布历史（第一方专用，R29）",
	version: "0.2.5",
	routes: [
		{
			path: "/oj-market",
			handle: {
				layout: "container",
				order: 200,
				title: "oj-market:menu.main",
				icon: createElement(OutsidePageIcon),
			},
			children: [
				{
					index: true,
					Component: MarketApp,
					handle: {
						title: "oj-market:menu.list",
						icon: createElement(AppstoreOutlined),
					},
				},
				...publishRoutes,
			],
		},
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	i18nNamespaces,
	lifecycle: {
		/** 市场编排面 client + 发布页契约前缀 /publish 在这里接线（两侧互不影响） */
		async onInit(ctx: ModuleContext) {
			marketOnInit(ctx);
			publishOnInit(ctx);
		},
	},
});
