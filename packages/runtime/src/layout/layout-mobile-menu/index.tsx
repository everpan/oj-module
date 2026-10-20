import { theme as antdTheme, Drawer } from "antd";
import { useMemo } from "react";
import { createUseStyles } from "react-jss";
import { Scrollbar } from "#src/components/scrollbar";
import { useDeviceType } from "#src/hooks/use-device-type";

import { usePreferences } from "#src/hooks/use-preferences";
import { cn } from "#src/utils/cn";

import LayoutMenu from "../layout-menu";
import { useMenu } from "../layout-menu/use-menu";

const useStyles = createUseStyles({
	drawerStyles: {
		"& .ant-drawer-body": {
			"padding": 0,
			"&>ul": {
				paddingTop: "1em",
			},
		},
		"& .ant-drawer-header": {
			display: "none",
		},
	},
});

export default function LayoutMobileMenu() {
	const classes = useStyles();
	const { token: { Menu } } = antdTheme.useToken();
	const { sidebarCollapsed, setPreferences, isDark, sidebarTheme } = usePreferences();
	const { isMobile } = useDeviceType();
	const { sideNavItems, bottomNavItems, handleMenuSelect } = useMenu();
	/* 移动端无底槽：底部固定区条目回落到菜单末尾（不消失） */
	const menuItems = useMemo(
		() => [...sideNavItems, ...bottomNavItems],
		[sideNavItems, bottomNavItems],
	);
	const isFixedDarkTheme = isDark || sidebarTheme === "dark";

	return (
		isMobile
			? (
				<Drawer
					styles={{
						body: {
							backgroundColor: isFixedDarkTheme ? Menu?.darkItemBg : Menu?.itemBg,
						},
					}}
					open={sidebarCollapsed}
					placement="left"
					width="clamp(200px, 50vw, 210px)"
					className={cn(classes.drawerStyles)}
					onClose={() => setPreferences("sidebarCollapsed", false)}
				>
					<Scrollbar>
						<LayoutMenu
							autoExpandCurrentMenu
							menus={menuItems}
							handleMenuSelect={handleMenuSelect}
						/>
					</Scrollbar>
				</Drawer>
			)
			: null
	);
}
