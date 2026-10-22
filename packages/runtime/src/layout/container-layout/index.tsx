import { RocketOutlined } from "@ant-design/icons";
import { FloatButton, Grid, Watermark } from "antd";
import { useEffect, useMemo } from "react";
import { JSSThemeProvider } from "#src/components/jss-theme-provider";
import { useDeviceType } from "#src/hooks/use-device-type";

import { useLayoutFooterStyle, useLayoutHeaderStyle } from "#src/hooks/use-layout-style";
import { usePreferencesStore } from "#src/store/preferences";
import { useTabsStore } from "#src/store/tabs";
import { cn } from "#src/utils/cn";

import { ELEMENT_ID_MAIN_CONTENT, footerHeight, headerHeight, tabbarHeight } from "../constants";
import { useLayout } from "../hooks";
import LayoutContent from "../layout-content";
import LayoutFooter from "../layout-footer";
import LayoutHeader from "../layout-header";
import LayoutMenu from "../layout-menu";
import { useMenu } from "../layout-menu/use-menu";
import LayoutMixedSidebar from "../layout-mixed-sidebar";
import LayoutMobileMenu from "../layout-mobile-menu";
import LayoutSidebar from "../layout-sidebar";
import LayoutTabbar from "../layout-tabbar";
import { BreadcrumbViews } from "../widgets/breadcrumb-views";
import { Logo } from "../widgets/logo";

const { useBreakpoint } = Grid;

/**
 * Please do not use this component through lazy, otherwise the switching routing page will flash.
 * 请不要通过 lazy 使用这个组件，否则切换路由页面会发生闪动。
 *
 * NO:
 * const ContainerLayout = lazy(() => import("#src/layout/container-layout"));
 *
 * YES:
 * import ContainerLayout from "#src/layout/container-layout";
 */
export default function ContainerLayout() {
	const screens = useBreakpoint();
	const { isTopNav, isTwoColumnNav, isMixedNav, sidebarWidth, sideCollapsedWidth, firstColumnWidthInTwoColumnNavigation } = useLayout();
	const isMaximize = useTabsStore(state => state.isMaximize);
	const { watermark, watermarkContent, enableFooter, fixedFooter, enableBackTopButton, tabbarEnable, sidebarEnable, sidebarCollapsed, setPreferences } = usePreferencesStore();
	const { isMobile } = useDeviceType();
	const { sideNavItems, topNavItems, handleMenuSelect, sideNavMenuKeyInSplitMode } = useMenu();

	const { setLayoutHeaderHeight } = useLayoutHeaderStyle();
	const { setLayoutFooterHeight } = useLayoutFooterStyle();

	useEffect(() => {
		/* iPad */
		if (screens.lg && !screens.xl) {
			setPreferences("sidebarCollapsed", true);
		}
		/* PC */
		else if (screens.xl) {
			setPreferences("sidebarCollapsed", false);
		}
		/* Mobile */
		else if (screens.xs || (screens.sm && !screens.md)) {
			setPreferences("sidebarCollapsed", false);
		}
	}, [screens, setPreferences]);

	const sidebarEnableState = useMemo(() => !isTopNav && sidebarEnable, [isTopNav, sidebarEnable]);
	const computedSidebarWidth = useMemo(() => {
		if (isMaximize || isMobile) {
			return 0;
		}
		const currentSidebarWidth = sidebarCollapsed ? sideCollapsedWidth : sidebarWidth;
		if (isTwoColumnNav) {
			/* 双列导航，第一列默认宽度 */
			return currentSidebarWidth + (firstColumnWidthInTwoColumnNavigation ?? 0);
		}
		if (sidebarEnableState) {
			return currentSidebarWidth;
		}
		return 0;
	}, [
		// Mobile
		isMobile,
		isMaximize,
		isTwoColumnNav,
		sidebarEnableState,
		sidebarWidth,
		sidebarCollapsed,
		sideCollapsedWidth,
		firstColumnWidthInTwoColumnNavigation,
	]);

	/**
	 * @zh 计算 header 和 tabbar 的高度
	 * @en Calculate the height of header and tabbar
	 */
	const headerWrapperHeight = useMemo(() => {
		let height = headerHeight;
		if (tabbarEnable) {
			height += tabbarHeight;
		}
		return height;
	}, [tabbarEnable]);

	useEffect(() => {
		setLayoutHeaderHeight(isMaximize ? tabbarHeight : headerWrapperHeight);
		// setLayoutHeaderHeight 来自未 memo 的 hook，每次渲染都是新引用，仅作为写入 CSS 变量的工具函数使用
		// eslint-disable-next-line react/exhaustive-deps
	}, [headerWrapperHeight, isMaximize]);

	useEffect(() => {
		setLayoutFooterHeight(footerHeight);
		// 同上：setLayoutFooterHeight 引用不稳定，挂载时写一次即可
		// eslint-disable-next-line react/exhaustive-deps
	}, []);

	return (
		<JSSThemeProvider>
			<Watermark content={watermark ? watermarkContent : ""}>
				<section
					style={{
						paddingLeft: computedSidebarWidth,
					}}
					className={cn(
						"transition-all flex flex-col h-screen",
					)}
				>
					<LayoutHeader>
						{isTopNav || isMixedNav
							? (
								<>
									{isTopNav ? <Logo sidebarCollapsed={false} className="mr-8" /> : null}
									<LayoutMenu mode="horizontal" menus={topNavItems} handleMenuSelect={handleMenuSelect} />
								</>
							)
							: <BreadcrumbViews />}
					</LayoutHeader>
					{tabbarEnable ? <LayoutTabbar /> : null}

					{/* Mobile Menu */}
					<LayoutMobileMenu />

					{/* PC */}
					{
						sidebarEnableState && !isTwoColumnNav
							? (
								<LayoutSidebar
									computedSidebarWidth={computedSidebarWidth}
								>
									<LayoutMenu
										autoExpandCurrentMenu
										menus={sideNavItems}
										handleMenuSelect={handleMenuSelect}
									/>
								</LayoutSidebar>
							)
							: null
					}
					{
						isTwoColumnNav
							? (
								<LayoutMixedSidebar
									sideNavMenuKeyInSplitMode={sideNavMenuKeyInSplitMode}
									computedSidebarWidth={computedSidebarWidth}
									sideNavItems={sideNavItems}
									topNavItems={topNavItems}
									handleMenuSelect={handleMenuSelect}
								/>
							)
							: null
					}

					<LayoutContent />

					{enableFooter && fixedFooter ? <LayoutFooter className="bg-colorBgContainer" /> : null}
					{enableBackTopButton
						? (
							<FloatButton.BackTop
								icon={<RocketOutlined />}
								target={() => document.querySelector(`#${ELEMENT_ID_MAIN_CONTENT} .simplebar-content-wrapper`) as HTMLElement || document}
							/>
						)
						: null}
				</section>
			</Watermark>
		</JSSThemeProvider>
	);
}
