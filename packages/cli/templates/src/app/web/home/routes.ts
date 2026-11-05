import type { AppRouteRecordRaw } from "@oj-module/runtime";

import { HomeOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

const Home = lazy(() => import("./pages/index"));

/**
 * 首页根 `/home`。
 *
 * 为什么必须有：shell 预构建产物把 `VITE_BASE_HOME_PATH` 定为 `/home`
 * （登录成功回跳、logo 点击、tabbar 首页、403/404 回首页都指向它）。
 * 工程缺 `/home` 路由时这些跳转会落到错误边界。
 *
 * 结构对齐 playground-oj/web/src/home；页面用统计卡片 + 折线/柱/饼图
 * 演示依赖矩阵（react-countup / dayjs / antd / @ant-design/icons / react-i18next
 * 由宿主 importmap 提供单例；echarts 属模块自打包的重型依赖，走按需注册，
 * 见 `pages/components/echarts-setup.ts`）。
 * 图表数据为静态演示值——真实业务走模块契约 + `ojm api` 生成的 client。
 */
export const routes: AppRouteRecordRaw[] = [
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
					// 首页是 /home 根的 index 子路由，运行时匹配到的叶子路由 id 为 `/home/`（带尾斜杠），
					// 而菜单项 key 是父级 `/home`，selectedKeys 取叶子 id 导致高亮对不上——
					// 复刻 react-antd-admin 时「首页」菜单项不亮。用 currentActiveMenu 显式声明高亮 /home
					// （框架既定机制：页面指定高亮哪个菜单），对齐 playground / react-antd-admin 的选中态。
					currentActiveMenu: "/home",
				},
			},
		],
	},
];
