import type { AppRouteRecordRaw, ModuleDefinition } from "@react-antd-module/runtime";
import {
	AppstoreOutlined,
	IssuesCloseOutlined,
	MinusSquareOutlined,
	StopOutlined,
} from "@ant-design/icons";

import { ServerErrorIcon } from "@react-antd-module/runtime";
import { createElement, lazy } from "react";

const exceptionPath = "/exception";
const exception403Path = "/exception/403";
const exception404Path = "/exception/404";
const exception500Path = "/exception/500";
const exceptionUnknownComponentPath = "/exception/not-found-component";

const Exception403 = lazy(() => import("./pages/403"));
const Exception404 = lazy(() => import("./pages/404"));
const Exception500 = lazy(() => import("./pages/500"));
const ExceptionUnknownComponent = lazy(() => import("./pages/unknown-component"));

const routes: AppRouteRecordRaw[] = [
	{
		path: exceptionPath,
		handle: {
			layout: "container",
			order: 90,
			title: "exception:menu.exception",
			icon: createElement(IssuesCloseOutlined),
		},
		children: [
			{
				path: exception403Path,
				Component: Exception403,
				handle: {
					title: "exception:menu.exception_403",
					icon: createElement(StopOutlined),
				},
			},
			{
				path: exception404Path,
				Component: Exception404,
				handle: {
					title: "exception:menu.exception_404",
					icon: createElement(MinusSquareOutlined),
				},
			},
			{
				path: exception500Path,
				Component: Exception500,
				handle: {
					title: "exception:menu.exception_500",
					icon: createElement(ServerErrorIcon),
				},
			},
			{
				path: exceptionUnknownComponentPath,
				Component: ExceptionUnknownComponent,
				handle: {
					title: "exception:menu.exceptionUnknownComponent",
					icon: createElement(AppstoreOutlined),
				},
			},
		],
	},
];

const mod: ModuleDefinition = {
	name: "exception",
	description: "异常页面模块",
	version: "1.0.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
};

export default mod;
