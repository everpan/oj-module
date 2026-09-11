import { HomeOutlined } from "@ant-design/icons";
import { defineModule } from "@react-antd-module/runtime";
import { createElement, lazy } from "react";

const Home = lazy(() => import("./pages/index"));

/**
 * 首页模块：提供 `/home` 路由。
 *
 * 为什么必须有：shell 预构建产物把 `VITE_BASE_HOME_PATH` 定为 `/home`
 * （登录成功回跳、logo 点击、tabbar 首页、403/404 回首页都指向它）。
 * 工程缺 `/home` 路由时这些跳转会落到错误边界。
 *
 * 结构对齐 apps/playground-oj/modules/src/home；页面用统计卡片 + 折线/柱/饼图
 * 演示宿主共享依赖矩阵（echarts / echarts-for-react / react-countup / dayjs /
 * antd / @ant-design/icons / react-i18next，均由宿主 importmap 提供单例）。
 * 图表数据为静态演示值——真实业务走模块契约 + `ram api` 生成的 client。
 */
export default defineModule({
	name: "home",
	description: "首页模块",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [
		{
			path: "/home",
			handle: {
				layout: "container",
				order: 1,
				title: "home:menu.home",
				icon: createElement(HomeOutlined),
			},
			children: [
				{
					index: true,
					Component: Home,
					handle: {
						title: "home:menu.home",
						icon: createElement(HomeOutlined),
					},
				},
			],
		},
	],
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
});
