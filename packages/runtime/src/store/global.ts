import { create } from "zustand";

/**
 * @zh 应用的初始状态
 * @en Initial state of the application
 */
const initialState = {
	/**
	 * @zh 全局加载动画是否显示
	 * @en Whether the global spinning animation is shown
	 */
	globalSpin: false,

	/**
	 * 站点标题（左侧菜单 / 双列侧栏 / 全屏布局展示）。
	 *
	 * 初值取构建期 `VITE_GLOB_APP_TITLE` 作兜底：首帧、匿名端点不可用、离线都不会空白。
	 * 运行期由宿主启动读 DB 的 `framework.site_title`（经匿名端点 `system/login-methods`
	 * 回传）调用 setSiteTitle 覆盖；站点设置页保存后即时覆盖。**DB 为权威，env 仅为兜底**。
	 */
	siteTitle: import.meta.env.VITE_GLOB_APP_TITLE || "Omni Solutions",
};

type GlobalState = typeof initialState;

interface GlobalAction {
	openGlobalSpin: () => void
	closeGlobalSpin: () => void
	/** 注入运行期站点标题；空值忽略，保留兜底值 */
	setSiteTitle: (title: string) => void
};

export const useGlobalStore = create<GlobalState & GlobalAction>(set => ({
	...initialState,

	openGlobalSpin: () => {
		return set({
			globalSpin: true,
		});
	},

	closeGlobalSpin: () => {
		return set({
			globalSpin: false,
		});
	},

	setSiteTitle: (title: string) => {
		const next = title.trim();
		if (next)
			return set({ siteTitle: next });
	},

}));
