import type { AppRouteRecordRaw, ModuleContext, UploadApiProvider } from "@oj-module/runtime";
import { ProfileCardIcon, RiAccountCircleLine, useAuthStore } from "@oj-module/runtime";

import { createElement, lazy } from "react";

import { createPersonalCenterClient } from "./__client/api";

const MyProfile = lazy(() => import("./pages/my-profile"));

/** 个人中心根 `/personal-center`：runtime 用户菜单固定导航 `/personal-center/my-profile`，缺则点击落空。 */
export const routes: AppRouteRecordRaw[] = [
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
		],
	},
];

/**
 * P4-3：接管头像上传端点（D9）。antd Upload 直连 action，headers 在上传瞬间
 * 取当前 token 注入 Bearer（token 存 runtime auth store，跨渲染期读 getState）。
 */
export async function onInit(ctx: ModuleContext) {
	// 构造即接线：登记契约前缀 /personal-center + 绑定 scoped request，
	// 页面直接 import 的 personalCenterProfilePost 才有可用的请求通道
	createPersonalCenterClient(ctx);
	const provider: UploadApiProvider = {
		action: "/api/personal-center/upload",
		headers: (): Record<string, string> => {
			const token = useAuthStore.getState().token;
			return token ? { Authorization: `Bearer ${token}` } : {};
		},
	};
	ctx.register.uploadApi(provider);
}
