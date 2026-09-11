/**
 * `@oj-module/runtime` 主入口。
 *
 * 这是模块工程**唯一**应该 import 的框架入口（设计文档 D3 / §4.3）。
 * 出口已于 P3.1 依据 P1 的实际用量冻结（tests/runtime-exports.test.ts
 * 即冻结契约）：components/basic-*、api、hooks、store、icons、
 * utils/tree、constants/options、路由与模块类型。
 *
 * 注意：antd、react、react-router、@tanstack/react-query 等共享依赖
 * 由宿主的 importmap 提供，模块应直接 import 它们，不要从 runtime 转出。
 */

// api
// 产物自携带样式（偏差 3，layout e2e 暴露）：框架 chrome（布局/菜单/页签）
// 的 tailwind 工具类与 base/animation/keep-alive 样式随公共出口分发。
// 此前只被 app 引导入口 index.tsx 引用，预构建产物零样式，宿主链路视觉崩坏。
// 构建后由 scripts/inline-css.mjs 内联回 runtime.js（importmap 链路无 CSS 模块概念）。
import "./styles/index.css";

export * from "./api/system/menu";
export * from "./api/system/role";
export * from "./api/user";
export { AccessControl } from "./components/access-control";
// AntdApp：antd App 包裹 + --oo-* 主题变量同步 + StaticAntd（$message 等）。
// 宿主链（shell host.tsx）必须用它而非 antd 原生 App，否则暗黑模式
// tailwind 语义色（bg-colorBgContainer 等）变量缺失，footer 露白
// （设计 202609112121-shell-dark-css-vars-design）
export { AntdApp } from "./components/antd-app";
export { BasicButton } from "./components/basic-button";
// 组件
export { BasicContent } from "./components/basic-content";

// 表单项（FormAvatarItem / FormTreeItem / TreeDataNodeWithId）
export * from "./components/basic-form";
export { BasicTable } from "./components/basic-table";
export type { BasicTableProps } from "./components/basic-table";
export { Iframe } from "./components/iframe";

export * from "./constants/options";
// hooks 与权限常量（use-access 内部已 re-export constants）
export * from "./hooks/use-access";

export { usePreferences } from "./hooks/use-preferences";
// 图标（unplugin-icons 构建期内联；包装导出保证声明零泄漏）
export * from "./icons";
// 全局副作用（标题/暗色类/NProgress，不含守卫）——宿主链路与 LayoutRoot 共用（偏差 4）
export { LayoutEffects } from "./layout/layout-effects";
// i18n 初始化（宿主链路必需：shell 曾以空 resources 自行 init，导致框架
// translation 命名空间（preferences/common 等）丢失——e2e 基线偏差 2）
export { setupI18n } from "./locales";

// 模块加载（宿主消费外部模块时使用；模块工程一般不直接调用）
export {
	getModule,
	getModules,
	getRegisteredApiPrefix,
	getRegisteredStore,
	getRoutes,
	loadAll,
	unloadModule,
} from "./module-loader";

// 模块契约
export { defineModule } from "./module-loader/define-module";

export { useSlotNodes } from "./module-loader/slots";
export type {
	ModuleConfig,
	ModuleContext,
	ModuleDefinition,
	ModuleI18n,
	ModuleLifecycle,
} from "./module-loader/types";
export type {
	Manifest,
	ManifestModuleEntry,
	ModuleInstance,
} from "./module-loader/types";

// 路由类型（模块声明 routes 时要用）
export type { AppRouteRecordRaw, RouteMeta } from "./router/types";
// 系统/通知/上传 API provider 注入契约（D9）：模块经 ctx.register.{systemApi,
// notificationsApi, uploadApi} 实现，覆盖内置 root 级端点
export type {
	NotificationsApiProvider,
	SystemApiProvider,
	UploadApiProvider,
} from "./store/api-provider";
// store
export { useAuthStore } from "./store/auth";

// 认证 provider 注入契约（P5）：模块经 ctx.register.authProvider 实现
export type { AuthProvider } from "./store/auth-provider";

export { useUserStore } from "./store/user";

export type { AppInfo } from "./types/app-info";

export { getAllExpandedKeys } from "./utils/get-all-expanded-keys";

// 应用元信息（构建期注入；模块经此函数获取，不依赖全局 __APP_INFO__ 注入）
export { getAppInfo } from "./utils/get-app-info";

// redirect 解析出口（P3，login 模块化：模块登录页成功后调它跳转）
export { getRedirectPath } from "./utils/get-redirect-path";

// 工具与常量
export * from "./utils/tree";

// zod re-export（AC-D15）：契约 schema 书写入口——模块 `import { z } from "@oj-module/runtime"`，
// zod 打进 runtime dist（构建期 external 白名单放行），不进宿主 importmap；与 @oj-module/runtime/contract 同源钉版
export { z } from "zod";
