import type { ComponentType } from "react";
export declare function registerLayout(moduleName: string, name: string, component: ComponentType): void;
export declare function getRegisteredLayout(name: string): ComponentType | undefined;
/**
 * 卸载模块时清掉其登记的全部布局（以 moduleName 隔离，不影响其他模块）。
 * 只影响「再解析」语义——已注入运行中 router 的路由不热回落（设计文档 N8）。
 */
export declare function unregisterLayouts(moduleName: string): void;
