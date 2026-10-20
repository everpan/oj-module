import { theme as antdTheme, ConfigProvider } from "antd";
import { Scrollbar } from "#src/components/scrollbar";

import { usePreferences } from "#src/hooks/use-preferences";

import LayoutMenu from "../layout-menu";
import { useMenu } from "../layout-menu/use-menu";
import { Logo } from "../widgets/logo";
import { SiderTrigger } from "../widgets/sider-trigger";

export interface LayoutSidebarProps {
	children?: React.ReactNode
	computedSidebarWidth: number
}

export default function LayoutSidebar({ children, computedSidebarWidth }: LayoutSidebarProps) {
	const { sidebarCollapsed, sidebarTheme, isDark } = usePreferences();
	const { bottomNavItems, handleMenuSelect } = useMenu();
	const {
		token: { Menu },
	} = antdTheme.useToken();

	const isFixedDarkTheme = isDark || sidebarTheme === "dark";

	return (
		<ConfigProvider
			theme={{
				algorithm: isFixedDarkTheme
					? antdTheme.darkAlgorithm
					: antdTheme.defaultAlgorithm,
			}}
		>
			<aside
				style={
					{
						// 一个像素的 border
						width: computedSidebarWidth + 1,
						backgroundColor: isFixedDarkTheme ? Menu?.darkItemBg : Menu?.itemBg,
						boxShadow: "3px 0 5px 0 rgb(29, 35, 41, 0.05)",
					}
				}
				className="fixed top-0 bottom-0 left-0 flex flex-col overflow-x-hidden overflow-y-auto transition-all border-r border-r-colorBorderSecondary"
			>
				<Logo sidebarCollapsed={sidebarCollapsed} />
				<div className="flex-1 min-h-0 overflow-hidden">
					<Scrollbar>
						{children}
					</Scrollbar>
				</div>
				{
					/* 底部固定区菜单（order < 0，2026-10-20）：pin 在主菜单之后、
					 * SiderTrigger 之上；空表不渲染占位 */
					bottomNavItems.length > 0
						? (
							<div className="shrink-0">
								<LayoutMenu
									autoExpandCurrentMenu
									menus={bottomNavItems}
									handleMenuSelect={handleMenuSelect}
								/>
							</div>
						)
						: null
				}
				<SiderTrigger />
			</aside>
		</ConfigProvider>
	);
}
