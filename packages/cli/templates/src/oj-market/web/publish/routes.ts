import type { AppRouteRecordRaw, ModuleContext } from "@oj-module/runtime";

import { AuditOutlined, CloudUploadOutlined, HistoryOutlined, KeyOutlined } from "@ant-design/icons";

import { createElement, lazy } from "react";

import { createPublishClient } from "./__client";

const PublishPage = lazy(() => import("./pages"));
const ReleaseHistoryPage = lazy(() => import("./pages/history"));
const TrustReviewPage = lazy(() => import("./pages/trust-review-page"));
const OfflineUploadPage = lazy(() => import("./pages/offline-upload-page"));

/**
 * 「方案市场」下的两个子页（单模单根：菜单只有 `/oj-market` 一个根）。
 *
 * 路径是**相对父路由**声明的：`publish` → `/oj-market/publish`，`history` → `/oj-market/history`。
 * 发布管理不挂 handle.roles：申请发布凭证是普通登录用户的能力，超管多出来的只是
 * 「看到所有租户的凭证」，由后端按角色决定返回范围，前端不重复判权。
 */
export const routes: AppRouteRecordRaw[] = [
	{
		path: "publish",
		Component: PublishPage,
		handle: {
			title: "publish:menu.publish",
			icon: createElement(KeyOutlined),
		},
	},
	{
		// 信任审核独立页（2026-11-10 拆分）：upload/trust 端点后端本就 403，
		// roles 只管菜单/路由可见性（system:menu.settings 同款机制），判权仍在服务端
		path: "publish/trust-review",
		Component: TrustReviewPage,
		handle: {
			title: "publish:menu.trustReview",
			icon: createElement(AuditOutlined),
			roles: ["superadmin"],
		},
	},
	{
		// 离线包上传独立页（2026-11-10 拆分）：upload 端点 superadmin 专属（api 面 2026-11-10 round 3）
		path: "publish/offline-upload",
		Component: OfflineUploadPage,
		handle: {
			title: "publish:menu.offlineUpload",
			icon: createElement(CloudUploadOutlined),
			roles: ["superadmin"],
		},
	},
	{
		path: "history",
		Component: ReleaseHistoryPage,
		handle: {
			title: "publish:menu.history",
			icon: createElement(HistoryOutlined),
		},
	},
];

/** 构造即接线：登记契约前缀 /publish + 绑定 scoped request，页面直接 import 的函数才有通道 */
export function onInit(ctx: ModuleContext): void {
	createPublishClient(ctx);
}
