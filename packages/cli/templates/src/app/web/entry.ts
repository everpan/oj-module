import type { ModuleContext, ModuleI18n } from "@oj-module/runtime";
import { defineModule } from "@oj-module/runtime";

import { routes as homeRoutes } from "./home/routes";
import { onInit as loginOnInit, routes as loginRoutes } from "./login/routes";
import { onInit as notificationOnInit, routes as notificationRoutes } from "./notification/routes";
import { onInit as personalCenterOnInit, routes as personalCenterRoutes } from "./personal-center/routes";
import { onInit as publishOnInit, routes as publishRoutes } from "./publish/routes";
import { onInit as systemOnInit, routes as systemRoutes } from "./system/routes";

/**
 * 应用模块（多根聚合）：一个 entry 承载七个业务根，各根独立成一级菜单。
 *
 * 为什么聚合：这七个根（首页/登录/个人中心/发布管理/通知/系统管理）是脚手架的框架内置页面，
 * 同版本发布、同生命周期、缺一不可，拆成七个模块只会把工程目录、web.config 登记、
 * modules.json 与首屏模块入口请求都放大七倍。聚合后仍是「一目录一模块」，但模块内
 * 按根分目录（`<root>/routes.ts` + `pages/` + `__client/`），页面相对导入不变。
 *
 * 结构约定（多根模块）：
 *   - 顶层路由首段去重 > 1 → runtime 判为多根（`isMultiRoot`），各根按 entry 里的
 *     **绝对路径**原样注册，不被 `routePrefix` 改写——URL 与菜单 key 都不变；
 *   - 菜单顺序仍由各根 `handle.order` 决定（≥0 主区升序、<0 底部固定区），与聚合前
 *     逐项一致；改顺序只改 order，不要依赖 routes 数组下标（缺省 order 会按数组下标兜底）；
 *   - 门禁挂根路由：`/system` 的 `handle.roles` 等价于原先的模块级 requiredRoles。
 *
 * i18n 用 `i18nNamespaces` 沿用各根**原命名空间**（home / login / personal-center /
 * publish / notification / system），因此 `t("system:menu.users")`、`useTranslation("system")`
 * 与菜单标题 `<ns>:menu.<key>` 全部零改动。
 */
const i18nNamespaces: Record<string, ModuleI18n> = {
	"home": {
		"zh-CN": () => import("./home/locales/zh-CN.json"),
		"en-US": () => import("./home/locales/en-US.json"),
	},
	"login": {
		"zh-CN": () => import("./login/locales/zh-CN.json"),
		"en-US": () => import("./login/locales/en-US.json"),
	},
	"personal-center": {
		"zh-CN": () => import("./personal-center/locales/zh-CN.json"),
		"en-US": () => import("./personal-center/locales/en-US.json"),
	},
	"notification": {
		"zh-CN": () => import("./notification/locales/zh-CN.json"),
		"en-US": () => import("./notification/locales/en-US.json"),
	},
	"publish": {
		"zh-CN": () => import("./publish/locales/zh-CN.json"),
		"en-US": () => import("./publish/locales/en-US.json"),
	},
	"system": {
		"zh-CN": () => import("./system/locales/zh-CN.json"),
		"en-US": () => import("./system/locales/en-US.json"),
	},
};

export default defineModule({
	name: "app",
	description: "应用模块：框架内置页面（首页/登录/个人中心/发布管理/通知/系统管理），多根聚合",
	version: "0.1.0",
	peerRuntime: ">=0.0.0",
	routes: [
		...homeRoutes,
		...loginRoutes,
		...personalCenterRoutes,
		...publishRoutes,
		...notificationRoutes,
		...systemRoutes,
	],
	i18nNamespaces,
	lifecycle: {
		/**
		 * 各根的 onInit 按原模块加载顺序串行——login 必须最先（认证 provider 要在任何
		 * 登录动作前就位），其余是前缀登记/API provider 注入，顺序无相互依赖。
		 */
		async onInit(ctx: ModuleContext) {
			await loginOnInit(ctx);
			await personalCenterOnInit(ctx);
			publishOnInit(ctx);
			await notificationOnInit(ctx);
			await systemOnInit(ctx);
		},
	},
});
