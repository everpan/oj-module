/** @oj-module/core — 框架核心蒸馏公共出口（PRD §4：原语 + 契约 + 引擎） */

export * from "./host";
export * from "./layout/layout-registry";
export * from "./locales";
export * from "./menu";
export * from "./module-loader/index";
export * from "./module-loader/keep-alive";
export * from "./module-loader/semver";
export * from "./module-loader/slots";
export * from "./providers/registry";
export * from "./providers/types";
export * from "./request/scoped";
export * from "./router/types";
export * from "./router/utils/add-route-id-by-path";
export * from "./router/utils/flatten-routes";
export * from "./router/utils/resolve-layout";
export * from "./types";
