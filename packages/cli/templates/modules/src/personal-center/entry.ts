import type { AppRouteRecordRaw, ModuleDefinition, UploadApiProvider } from "@oj-module/runtime";
import { ProfileCardIcon, RiAccountCircleLine, RiUserSettingsLine, useAuthStore } from "@oj-module/runtime";

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
	version: "0.1.0",
	routes,
	i18n: {
		"zh-CN": () => import("./locales/zh-CN.json"),
		"en-US": () => import("./locales/en-US.json"),
	},
	lifecycle: {
		// P4-3：接管头像上传端点（D9）。antd Upload 直连 action，headers 在上传瞬间
		// 取当前 token 注入 Bearer（token 存 runtime auth store，跨渲染期读 getState）。
		async onInit(ctx) {
			const provider: UploadApiProvider = {
				action: "/api/personal-center/upload",
				headers: (): Record<string, string> => {
					const token = useAuthStore.getState().token;
					return token ? { Authorization: `Bearer ${token}` } : {};
				},
			};
			ctx.register.uploadApi(provider);
		},
	},
};

export default mod;
