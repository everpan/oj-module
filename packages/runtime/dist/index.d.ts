/**
 * `@react-antd-module/runtime` 主入口。
 *
 * 这是模块工程**唯一**应该 import 的框架入口（设计文档 D3 / §4.3）。
 * 出口已于 P3.1 依据 P1 的实际用量冻结（tests/runtime-exports.test.ts
 * 即冻结契约）：components/basic-*、api、hooks、store、icons、
 * utils/tree、constants/options、路由与模块类型。
 *
 * 注意：antd、react、react-router、@tanstack/react-query 等共享依赖
 * 由宿主的 importmap 提供，模块应直接 import 它们，不要从 runtime 转出。
 */
import "./styles/index.css";
export * from "./api/home";
export * from "./api/system/menu";
export * from "./api/system/role";
export * from "./api/user";
export { AccessControl } from "./components/access-control";
export { BasicButton } from "./components/basic-button";
export { BasicContent } from "./components/basic-content";
export * from "./components/basic-form";
export { BasicTable } from "./components/basic-table";
export type { BasicTableProps } from "./components/basic-table";
export { Iframe } from "./components/iframe";
export * from "./constants/options";
export * from "./hooks/use-access";
export { usePreferences } from "./hooks/use-preferences";
export * from "./icons";
export { LayoutEffects } from "./layout/layout-effects";
export { setupI18n } from "./locales";
export { getModule, getModules, getRegisteredApiPrefix, getRegisteredStore, getRoutes, loadAll, unloadModule, } from "./module-loader";
export { defineModule } from "./module-loader/define-module";
export { useSlotNodes } from "./module-loader/slots";
export type { ModuleConfig, ModuleContext, ModuleDefinition, ModuleI18n, ModuleLifecycle, } from "./module-loader/types";
export type { Manifest, ManifestModuleEntry, ModuleInstance, } from "./module-loader/types";
export type { AppRouteRecordRaw, RouteMeta } from "./router/types";
export type { NotificationsApiProvider, SystemApiProvider, UploadApiProvider, } from "./store/api-provider";
export { useAuthStore } from "./store/auth";
export type { AuthProvider } from "./store/auth-provider";
export { useUserStore } from "./store/user";
export type { AppInfo } from "./types/app-info";
export { getAllExpandedKeys } from "./utils/get-all-expanded-keys";
export { getAppInfo } from "./utils/get-app-info";
export { getRedirectPath } from "./utils/get-redirect-path";
export * from "./utils/tree";
export { z } from "zod";
