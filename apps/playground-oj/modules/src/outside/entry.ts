import type { AppRouteRecordRaw, ModuleDefinition } from "@react-antd-module/runtime";
import { AntDesignOutlined, ContainerOutlined } from "@ant-design/icons";

import { EmbeddedIcon, ExternalIcon, Iframe, OutsidePageIcon, RiReactjsLine } from "@react-antd-module/runtime";
import { createElement } from "react";
import { Outlet } from "react-router";

const routes: AppRouteRecordRaw[] = [
	{
		path: "/outside",
		handle: {
			layout: "container",
			icon: createElement(OutsidePageIcon),
			title: "outside:menu.outside",
			order: 40,
		},
		children: [
			{
				path: "/outside/embedded",
				Component: Outlet,
				handle: {
					icon: createElement(EmbeddedIcon),
					title: "outside:menu.embedded",
				},
				children: [
					{
						path: "/outside/embedded/ant-design",
						Component: Iframe,
						handle: {
							icon: createElement(AntDesignOutlined),
							title: "outside:menu.antd",
							iframeLink: "https://ant.design/",
						},
					},
					{
						path: "/outside/embedded/project-docs",
						Component: Iframe,
						handle: {
							icon: createElement(ContainerOutlined),
							title: "outside:menu.projectDocs",
							iframeLink: "https://condorheroblog.github.io/react-antd-admin/docs/",
						},
					},
				],
			},
			{
				path: "/outside/external-link",
				Component: Outlet,
				handle: {
					icon: createElement(ExternalIcon),
					title: "outside:menu.externalLink",
				},
				children: [
					{
						path: "/outside/external-link/react-docs",
						Component: Iframe,
						handle: {
							icon: createElement(RiReactjsLine),
							title: "outside:menu.reactDocs",
							externalLink: "https://react.dev/",
						},
					},
				],
			},
		],
	},
];

const mod: ModuleDefinition = {
	name: "outside",
	description: "外部链接模块",
	version: "1.0.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
};

export default mod;
