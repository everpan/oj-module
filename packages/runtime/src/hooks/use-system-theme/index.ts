import { useSyncExternalStore } from "react";

/**
 * 系统/浏览器暗色偏好（prefers-color-scheme）的实时订阅。
 *
 * 为什么需要订阅：`theme === "auto"` 的含义是「跟随系统」，但 isDarkTheme() 只在
 * render 时读一次 matchMedia——用户在系统里切深/浅色、或浏览器跟随系统调度时，
 * React 没有理由重渲染，页面就停在旧主题（工作台里尤其明显：切了系统主题，站点壳
 * 与菜单仍是旧色）。这里用 useSyncExternalStore 把 matchMedia 的 change 事件接进
 * React，auto 模式下 isDark 会随系统即时翻转。
 *
 * SSR / 无 matchMedia 的环境固定返回 false（浅色），与 isDarkTheme 的兜底一致。
 */
const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemQuery(): MediaQueryList | null {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function")
		return null;
	return window.matchMedia(DARK_QUERY);
}

function subscribe(onStoreChange: () => void): () => void {
	const mq = systemQuery();
	if (!mq)
		return () => {};
	// 老 Safari（< 14）只有 addListener/removeListener
	if (typeof mq.addEventListener === "function") {
		mq.addEventListener("change", onStoreChange);
		return () => mq.removeEventListener("change", onStoreChange);
	}
	mq.addListener(onStoreChange);
	return () => mq.removeListener(onStoreChange);
}

function getSnapshot(): boolean {
	return systemQuery()?.matches ?? false;
}

/** 系统当前是否为暗色（订阅 prefers-color-scheme: dark 的变化） */
export function useSystemDark(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
