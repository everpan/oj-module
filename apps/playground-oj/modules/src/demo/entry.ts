import { HomeOutlined } from "@ant-design/icons";
import { defineModule } from "@react-antd-module/runtime";
import { createElement } from "react";

import DemoPage from "./pages/index";

/**
 * demo 前端模块：本文件是模块元数据唯一来源（name/version/routes/i18n）。
 * 只允许 import 三类东西：runtime、共享依赖（宿主 importmap 提供）、自身相对路径。
 */
export default defineModule({
	name: "demo",
	description: "uni-dev 演示模块",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [
		{
			path: "/demo",
			handle: {
				layout: "container",
				order: 100,
				title: "demo:menu.demo",
				icon: createElement(HomeOutlined),
			},
			children: [
				{
					index: true,
					Component: DemoPage,
					handle: {
						title: "demo:menu.demo",
						icon: createElement(HomeOutlined),
						keepAlive: true,
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
