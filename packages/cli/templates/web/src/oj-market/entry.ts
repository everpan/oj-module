import { defineModule } from "@oj-module/runtime";
import MarketApp from "./pages/MarketApp";

// 方案市场前端模块（第一方专用，R29：消费 /api/_platform/market/* 编排面，第三方方案不得仿照此调用面）。
// 菜单标题走 i18next 命名空间语法 "<moduleName>:menu.<key>"（i18n 资源在 locales/，安装时随包注册）。
export default defineModule({
	name: "oj-market",
	description: "oj 方案市场应用——卡片展示/安装/卸载/历史（第一方专用，R29）",
	version: "0.1.0",
	routes: [
		{
			path: "/oj-market",
			handle: { layout: "container", order: 200, title: "oj-market:menu.main" },
			children: [
				{
					index: true,
					Component: MarketApp,
					handle: { title: "oj-market:menu.main" },
				},
			],
		},
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
});
