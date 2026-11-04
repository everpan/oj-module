import { StyleProvider } from "@ant-design/cssinjs";
import { enUSIntl, ProConfigProvider, zhCNIntl } from "@ant-design/pro-components";
import { theme as antdTheme, ConfigProvider } from "antd";
import dayjs from "dayjs";
import { Suspense, useCallback, useEffect } from "react";
import { RouterProvider } from "react-router";

import { AntdApp } from "#src/components/antd-app";
import { JSSThemeProvider } from "#src/components/jss-theme-provider";
import { usePreferences } from "#src/hooks/use-preferences";
import { useScrollToHash } from "#src/hooks/use-scroll-to-hash";
import { AppVersionMonitor } from "#src/layout/widgets/version-monitor";
import { ANT_DESIGN_LOCALE } from "#src/locales";

import { router } from "./router";
import { customAntdDarkTheme, customAntdLightTheme } from "./styles/theme/antd/antd-theme";
import "dayjs/locale/zh-cn";

export default function App() {
	const {
		language,
		isDark,
		theme,
		themeColorPrimary,
		colorBlindMode,
		colorGrayMode,
		themeRadius,
		changeSiteTheme,

		enableCheckUpdates,
		checkUpdatesInterval,
		sideCollapsedWidth,
	} = usePreferences();

	useScrollToHash();

	/**
	 * ant design internationalization
	 * @link https://ant.design/docs/react/i18n
	 */
	const getAntdLocale = () => {
		return ANT_DESIGN_LOCALE[language as keyof typeof ANT_DESIGN_LOCALE];
	};

	/**
	 * ProComponents internationalization
	 *
	 * 只切 antd 的 locale 不够：ProForm 的「重置/提交」等文案取自 pro-components 自己的
	 * intl（`useIntl()` 优先读 ProConfigContext），不显式注入就会一直是中文。
	 * @link https://procomponents.ant.design/components/config-provider
	 */
	const getProIntl = () => {
		return language === "en-US" ? enUSIntl : zhCNIntl;
	};

	/**
	 * day.js internationalization
	 * @link https://day.js.org/docs/en/installation/installation
	 */
	useEffect(() => {
		if (language === "en-US") {
			dayjs.locale("en");
		}
		else if (language === "zh-CN") {
			dayjs.locale("zh-cn");
		}
	}, [language]);

	/**
	 * Change theme when the system theme changes
	 */
	const setEmulateTheme = useCallback(
		// eslint-disable-next-line unused-imports/no-unused-vars
		(dark?: boolean) => {
			changeSiteTheme("auto");
		},
		[changeSiteTheme],
	);

	/**
	 * Watch system theme change
	 */
	useEffect(() => {
		if (theme === "auto") {
			// https://developer.chrome.com/docs/devtools/rendering/emulate-css/
			const darkModeMediaQuery = window.matchMedia(
				"(prefers-color-scheme: dark)",
			);

			function matchMode(e: MediaQueryListEvent) {
				setEmulateTheme(e.matches);
			}

			setEmulateTheme(darkModeMediaQuery.matches);
			darkModeMediaQuery.addEventListener("change", matchMode);
			return () => {
				darkModeMediaQuery.removeEventListener("change", matchMode);
			};
		}
	}, [theme, setEmulateTheme]);

	/**
	 * 更新页面颜色模式（灰色、色弱）
	 */
	const updateColorMode = useCallback(() => {
		const dom = document.documentElement;
		const COLOR_BLIND = "color-blind-mode";
		const COLOR_GRAY = "gray-mode";
		colorBlindMode
			? dom.classList.add(COLOR_BLIND)
			: dom.classList.remove(COLOR_BLIND);
		colorGrayMode
			? dom.classList.add(COLOR_GRAY)
			: dom.classList.remove(COLOR_GRAY);
	}, [colorBlindMode, colorGrayMode]);

	useEffect(() => {
		updateColorMode();
	}, [updateColorMode]);

	return (
		<StyleProvider layer>
			<ConfigProvider
				input={{ autoComplete: "off" }}
				locale={getAntdLocale()}
				theme={{
					cssVar: {},
					hashed: false,
					algorithm:
						isDark
							? antdTheme.darkAlgorithm
							: antdTheme.defaultAlgorithm,
					...(isDark ? customAntdDarkTheme : customAntdLightTheme),
					token: {
						...(isDark ? customAntdDarkTheme.token : customAntdLightTheme.token),
						borderRadius: themeRadius,
						colorPrimary: themeColorPrimary,
					},
					components: {
						...(isDark ? customAntdDarkTheme.components : customAntdLightTheme.components),
						Menu: {
							darkItemBg: "#141414",
							itemBg: "#fff",
							...(isDark
								? customAntdDarkTheme.components?.Menu
								: customAntdLightTheme.components?.Menu),
							collapsedWidth: sideCollapsedWidth,
						},
					},
				}}
			>
				<ProConfigProvider intl={getProIntl()}>
					<AntdApp>
						<JSSThemeProvider>
							<Suspense fallback={null}>
								{enableCheckUpdates ? <AppVersionMonitor checkUpdatesInterval={checkUpdatesInterval} /> : null}
								<RouterProvider router={router} />
							</Suspense>
						</JSSThemeProvider>
					</AntdApp>
				</ProConfigProvider>
			</ConfigProvider>
		</StyleProvider>
	);
}
