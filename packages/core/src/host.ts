import type { AppRouteRecordRaw } from "./router/types";

/**
 * 宿主注入面（PRD §4 三处事件化的宿主半边）：core 不自烤 env、不依赖 zustand
 * store、不引宿主用户体系——三件事全部由宿主 bootstrap 时注入，跨 dev/prod
 * 同一份 tgz 不错态。
 */

/* ③ DEV 旗标：v1 的 import.meta.env.DEV 判断（module-loader 两处）改由宿主
 * bootstrap 注入（vite define 全局或显式调用皆可）。core 构建期零 env 烤制。 */
let devFlag = false;
export function setDevFlag(value: boolean): void {
	devFlag = value;
}
export function isDev(): boolean {
	return devFlag;
}

/* ② authz 钩子：v1 getRoutes() 前置过滤读 useUserStore（roles/permissions）——
 * core 改为宿主注入的惰性求值钩子；未注入 = 空身份（不做模块级过滤，
 * 路由面全量可用，与「模块受信」语义一致）。 */
export interface RouteAuthz {
	roles: string[]
	permissions: string[]
}
let authzProvider: (() => RouteAuthz) | undefined;
export function setRouteAuthzProvider(provider: () => RouteAuthz): void {
	authzProvider = provider;
}
export function getRouteAuthz(): RouteAuthz {
	return authzProvider?.() ?? { roles: [], permissions: [] };
}

/* ① route-ready 事件：v1 loadAll 尾部把模块路由写进 zustand access store——
 * core 改为发布事件，宿主订阅后写自己的 access store（pub-sub，多订阅者依序）。 */
const routeReadyListeners = new Set<(routes: AppRouteRecordRaw[]) => void>();

export function onRoutesReady(listener: (routes: AppRouteRecordRaw[]) => void): () => void {
	routeReadyListeners.add(listener);
	return () => routeReadyListeners.delete(listener);
}

export function emitRoutesReady(routes: AppRouteRecordRaw[]): void {
	for (const listener of routeReadyListeners) {
		listener(routes);
	}
}
