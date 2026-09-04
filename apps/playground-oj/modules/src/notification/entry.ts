import { defineModule } from "@react-antd-module/runtime";

/**
 * notification 壳模块（D11：补齐第 11 个模块，使清单完整）。
 *
 * 仅持有模块身份，无页面路由。通知拉取 API 的注入实现
 * （`ctx.register.notificationsApi`，接管内置 root 级 `fetchNotifications`）
 * 在 P4 连同 oj 后端 `/notification` 处理器与 `api/src/notification/contract.ts`
 * 一并落地——届时本模块 onInit 注册 SystemApiProvider 风格的 notifications provider。
 */
export default defineModule({
	name: "notification",
	description: "通知壳模块（注入点见 P4）",
	version: "0.0.1",
	peerRuntime: ">=0.0.0",
	routes: [],
});
