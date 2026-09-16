import type { AppRouteRecordRaw } from "../router/types";
import type { Manifest, ModuleInstance } from "./types";
export declare function loadAll(manifest: Manifest): Promise<ModuleInstance[]>;
export declare function getModules(): ModuleInstance[];
export declare function getModule(name: string): ModuleInstance | undefined;
export declare function getRoutes(): AppRouteRecordRaw[];
export declare function getRegisteredStore<T = unknown>(name: string): T | undefined;
/** 首个登记的前缀（一模块可登记多个）；未登记返回 undefined */
export declare function getRegisteredApiPrefix(moduleName: string): string | undefined;
/**
 * 卸载模块：执行 onDestroy 生命周期 → 清理其布局插槽（US-8）→ 移除实例。
 * 供运维下线单个模块使用，其余模块不受影响。
 */
export declare function unloadModule(name: string): Promise<void>;
/**
 * KeepAlive exclude key：各模块路由中 `handle.keepAlive === false` 的路径集合。
 * 由 module-loader 汇总，不再依赖 access store 的 flatRouteList（B13）。
 */
export declare function getKeepAliveExcludeKeys(): string[];
/** 全部路由 key：关闭多 tab 时整体排除，仅保留切换动画 */
export declare function getAllRoutePathKeys(): string[];
