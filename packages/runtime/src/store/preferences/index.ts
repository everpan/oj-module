import type { LanguageType } from "#src/locales";
import type { PreferencesState, ThemeType } from "./types";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { SIDE_NAVIGATION } from "#src/layout/widgets/preferences/blocks/layout/constants";
import { getAppNamespace } from "#src/utils/get-app-namespace";

/**
 * 默认偏好设置
 */
export const DEFAULT_PREFERENCES = {
	/* ================== General ================== */
	watermark: false,
	watermarkContent: "react-antd-admin",
	enableBackTopButton: true,
	pageLayout: "layout-right",
	enableBackendAccess: true,
	enableFrontendAceess: false,
	language: "zh-CN",
	enableDynamicTitle: true,
	enableCheckUpdates: true,
	checkUpdatesInterval: 1,

	/* ================== Theme ================== */
	theme: "auto",
	colorBlindMode: false,
	colorGrayMode: false,
	themeRadius: 6,
	builtinTheme: "blue",
	themeColorPrimary: "#1677ff",

	/* ================== Animation ================== */
	transitionProgress: true,
	transitionLoading: true,
	transitionEnable: true,
	transitionName: "fade-slide",

	/* ================== Layout ================== */
	navigationStyle: SIDE_NAVIGATION,

	/* ================== Tabbar ================== */
	tabbarEnable: true,
	tabbarShowIcon: true,
	tabbarPersist: true,
	tabbarDraggable: true,
	tabbarStyleType: "chrome",
	tabbarShowMore: true,
	tabbarShowMaximize: true,

	/* ================== Sidebar ================== */
	sidebarEnable: true,
	sidebarWidth: 210,
	sideCollapsedWidth: 56,
	sidebarCollapsed: false,
	sidebarCollapseShowTitle: true,
	sidebarExtraCollapsedWidth: 48,
	firstColumnWidthInTwoColumnNavigation: 80,
	sidebarTheme: "light",
	accordion: true,

	/* ================== Footer ================== */
	enableFooter: true,
	fixedFooter: true,
	companyName: "Omni Solution",
	companyWebsite: "http://github.com/everpan",
	copyrightDate: "2026",
	ICPNumber: "",
	ICPLink: "",
} satisfies PreferencesState;

/**
 * 偏好设置操作接口
 */
interface PreferencesAction {
	reset: () => void
	changeSiteTheme: (theme: ThemeType) => void
	changeLanguage: (language: LanguageType) => void
	setPreferences: {
		// 单个 key-value 更新
		<T>(key: string, value: T): void
		// 对象形式批量更新
		<T extends Partial<PreferencesState>>(preferences: T): void
	}
}

/**
 * 偏好设置状态管理
 */
export const usePreferencesStore = create<
	PreferencesState & PreferencesAction
>()(
	persist(
		set => ({
			...DEFAULT_PREFERENCES,

			/**
			 * 更新偏好设置
			 */
			setPreferences: (...args: any[]) => {
				if (args.length === 1) {
					const preferences = args[0];
					set(() => {
						return { ...preferences };
					});
				}
				else if (args.length === 2) {
					const [key, value] = args;
					set(() => {
						return { [key]: value };
					});
				}
			},

			/**
			 * 更新主题
			 */
			changeSiteTheme: (theme) => {
				set(() => {
					return { theme };
				});
			},

			/**
			 * 更新语言
			 */
			changeLanguage: (language) => {
				set(() => {
					return { language };
				});
			},

			/**
			 * 重置状态
			 */
			reset: () => {
				set(() => {
					return { ...DEFAULT_PREFERENCES };
				});
			},
		}),
		{
			name: getAppNamespace("preferences"),
			/**
			 * 2026-11-08：旧版本把用户点过的 light/dark 一直持久化，「跟随系统」只对
			 * 新用户有效——系统换色时老用户永远停在旧值。升级到此版本时一次性把历史
			 * 偏好归位 auto；用户之后再显式选 light/dark 会写入 version=1，不再被重置。
			 */
			version: 1,
			migrate: persisted => ({
				...(persisted as Partial<PreferencesState>),
				theme: "auto",
			}),
		},
	),
);
