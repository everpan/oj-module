import { Col, Grid, Row, theme } from "antd";
import { clsx } from "clsx";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";

// ?inline 而非 ?react/?url：runtime lib 构建（packages/runtime/vite.config.ts）
// 无 svgr 且 assetsInlineLimit=0 禁外部资产——?inline 产 data URI，
// 在 importmap 宿主（shell/外部工程）中自包含可渲染（P4 实测：?react 在
// dist 退化为字符串，React createElement(data:image/…) 抛 InvalidCharacterError）
import bannerUrl from "#src/assets/svg/banner.svg?inline";
import logoUrl from "#src/assets/svg/logo.svg?inline";
import { useLayoutMenu } from "#src/hooks/use-layout-menu";
import { usePreferences } from "#src/hooks/use-preferences";
import LayoutFooter from "#src/layout/layout-footer";
import { LanguageButton } from "#src/layout/layout-header/components/language-button";
import { ThemeButton } from "#src/layout/layout-header/components/theme-button";
import { useGlobalStore } from "#src/store/global";

/**
 * 全屏布局（P1，login 模块化）：框架兜住「占满视口 + 无 chrome + 主题正确 +
 * 品牌位统一」——品牌区（logo + 应用标题）、右上角工具区（布局预览/主题/语言）、
 * 横幅列与页脚全部内置，模块只写内容区（经 Outlet 渲染），零 `#src/` 依赖。
 *
 * 与 `none` 的分工：`none` 是裸 Outlet，框架不保证任何视口。
 * 外壳从原内置登录页（pages/login）平移而来（P2 完成页面侧剥离）。
 */
export default function FullscreenLayout() {
	const { isDark } = usePreferences();
	const siteTitle = useGlobalStore(s => s.siteTitle);
	const { token } = theme.useToken();
	const { t } = useTranslation();
	const screens = Grid.useBreakpoint();
	const { pageLayout, layoutButtonTrigger } = useLayoutMenu();
	const isALignLeft = useMemo(() => pageLayout === "layout-left", [pageLayout]);
	const isAlignCenter = useMemo(() => pageLayout === "layout-center", [pageLayout]);

	return (
		<div
			style={{
				backgroundColor: token.colorBgContainer,
			}}
		>
			<header className="z-10 absolute flex items-center right-3 top-3 left-3">
				<div
					className="text-colorText flex flex-1 items-center"
				>
					<img alt="App Logo" src={logoUrl} className="mr-2 w-11" />
					<h1 className="m-0 text-xl font-medium">
						{siteTitle}
					</h1>
				</div>
				<div className="flex items-center">
					{layoutButtonTrigger}
					<ThemeButton size="large" />
					<LanguageButton size="large" className="px-2.75" />
				</div>
			</header>
			<div
				className="flex items-center overflow-hidden h-full"
			>
				<Row
					className={clsx("h-screen w-full", { "flex-row-reverse": isALignLeft },
					)}
				>
					<Col
						xs={0}
						sm={0}
						lg={15}
						style={{
							backgroundImage: `radial-gradient(${token.colorBgContainer}, ${isDark ? token.colorBgBlur : token.colorPrimaryBg})`,
						}}
						className={clsx({ hidden: isAlignCenter })}
					>
						<div className="flex flex-col items-center justify-center h-full gap-3">
							<img
								alt=""
								src={bannerUrl}
								className="h-64 motion-safe:animate-bounce-in-down-out-up"
							/>
							<div className="text-xl text-colorTextSecondary mt-6 font-sans lg:text-2xl">
								{t("authority.pageTitle")}
							</div>
							<div className="text-colorTextTertiary mt-2">
								{t("authority.pageDescription")}
							</div>
						</div>
					</Col>

					<Col
						xs={24}
						sm={24}
						lg={isAlignCenter ? 24 : 9}
						className="relative flex flex-col justify-center px-6 py-10 xl:px-8"
						style={isAlignCenter || (!screens.xl && !screens.xxl && !screens.lg)
							? {
								backgroundImage: `radial-gradient(${token.colorBgContainer}, ${token.colorPrimaryBg})`,
							}
							: {}}
					>
						<LayoutFooter className="w-full absolute bottom-3 left-1/2 -translate-x-1/2" />
						<div className="w-full sm:mx-auto md:max-w-md">
							<Outlet />
						</div>
					</Col>
				</Row>
			</div>
		</div>
	);
}
