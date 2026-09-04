import type { AppRouteRecordRaw, ModuleDefinition } from "@react-antd-module/runtime";
import { ProfileCardIcon, RiAccountCircleLine, RiUserSettingsLine } from "@react-antd-module/runtime";

import { createElement, lazy } from "react";

const MyProfile = lazy(() => import("./pages/my-profile"));
const Settings = lazy(() => import("./pages/settings"));

const routes: AppRouteRecordRaw[] = [
	{
		path: "/personal-center",
		handle: {
			layout: "container",
			order: 110,
			title: "personal-center:menu.personalCenter",
			icon: createElement(RiAccountCircleLine),
		},
		children: [
			{
				path: "/personal-center/my-profile",
				Component: MyProfile,
				handle: {
					title: "personal-center:menu.profile",
					icon: createElement(ProfileCardIcon),
				},
			},
			{
				path: "/personal-center/settings",
				Component: Settings,
				handle: {
					title: "personal-center:menu.settings",
					icon: createElement(RiUserSettingsLine),
				},
			},
		],
	},
];

const mod: ModuleDefinition = {
	name: "personal-center",
	description: "个人中心模块",
	version: "1.0.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
};

export default mod;
