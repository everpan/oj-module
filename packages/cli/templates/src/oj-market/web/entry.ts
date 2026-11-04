import type { ModuleContext, ModuleI18n } from "@oj-module/runtime";
import { defineModule, OutsidePageIcon } from "@oj-module/runtime";
import { createElement } from "react";
import MarketApp from "./pages/MarketApp";
import { onInit as publishOnInit, routes as publishRoutes } from "./publish/routes";

// 方案市场前端模块（第一方专用，R29：消费 /api/_platform/market/* 编排面，第三方方案不得仿照此调用面）。
// 菜单标题走 i18next 命名空间语法 "<moduleName>:menu.<key>"（i18n 资源在 locales/，安装时随包注册）。
//
// 「发布管理」（`/publish`）也在这里：发布身份是市场的准入面，页面随市场模块同版本发布、
// 同生命周期下线。它是本模块的第二个根（`/oj-market` 与 `/publish` 首段不同 → 多根），
// 按 routes 里的绝对路径原样注册，URL 与菜单 key 都与迁入前一致。
const i18nNamespaces: Record<string, ModuleI18n> = {
	// 发布页沿用原命名空间：`t("publish:…")` / 菜单 `publish:menu.publish` 零改动
	publish: {
		"zh-CN": () => import("./publish/locales/zh-CN.json"),
		"en-US": () => import("./publish/locales/en-US.json"),
	},
};

export default defineModule({
	name: "oj-market",
	description: "oj 方案市场应用——卡片展示/安装/卸载/历史 + 发布管理（第一方专用，R29）",
	version: "0.1.0",
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
					handle: { title: "oj-market:menu.main" },
				},
			],
		},
		...publishRoutes,
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	i18nNamespaces,
	lifecycle: {
		/** 发布页的契约前缀 /publish + scoped request 在这里接线（与市场自身的 client 互不影响） */
		async onInit(ctx: ModuleContext) {
			publishOnInit(ctx);
		},
	},
});
