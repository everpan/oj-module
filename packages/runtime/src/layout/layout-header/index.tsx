import type { ButtonProps } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { theme as antdTheme, Button, ConfigProvider, theme } from "antd";
import { Children, Fragment } from "react";
import { useDeviceType } from "#src/hooks/use-device-type";
import { usePreferences } from "#src/hooks/use-preferences";
import { useLayout } from "#src/layout/hooks/use-layout";
import { GlobalSearch } from "#src/layout/widgets/global-search";
import { NotificationContainer } from "#src/layout/widgets/notification/notification-container";
import { Preferences } from "#src/layout/widgets/preferences";

import { useSlotNodes } from "#src/module-loader/slots";
import { useTabsStore } from "#src/store/tabs";
import { cn } from "#src/utils/cn";

import { headerHeight } from "../constants";
import { FullscreenButton } from "./components/fullscreen-button";
import { LanguageButton } from "./components/language-button";
import { ThemeButton } from "./components/theme-button";
import { UserMenu } from "./components/user-menu";

export interface LayoutHeaderProps {
	className?: string
	children?: React.ReactNode
}

export default function LayoutHeader({ className, children }: LayoutHeaderProps) {
	const {
		token: { Menu },
	} = theme.useToken();
	const {
		sidebarCollapsed,
		setPreferences,
		isDark,
		sidebarTheme,
	} = usePreferences();
	const { isMobile } = useDeviceType();
	const isMaximize = useTabsStore(state => state.isMaximize);
	const { isTopNav, isMixedNav } = useLayout();
	// P3.6 / US-8：模块经 ctx.registerSlot("header-actions", node) 挂载的操作区
	const slotActions = useSlotNodes("header-actions");
	const isFixedDarkTheme = isDark || (sidebarTheme === "dark" && (isMixedNav || isTopNav));

	// 窄屏（如 iPhone SE 375px）：按钮缩为 middle 并收紧内边距，避免顶栏右侧溢出
	const buttonProps: ButtonProps = isMobile
		? { size: "middle", className: "px-2" }
		: { size: "large", className: "px-[11px]" };

	return (
		<ConfigProvider
			theme={{
				algorithm: isFixedDarkTheme
					? antdTheme.darkAlgorithm
					: antdTheme.defaultAlgorithm,
			}}
		>
			<header
				className={cn(
					"flex-shrink-0 flex justify-between items-center transition-all px-2 md:px-4",
					isMobile ? "gap-2" : "gap-5",
					{ "overflow-hidden": isMaximize },
					className,
				)}
				style={{
					background: isFixedDarkTheme ? Menu?.darkItemBg : Menu?.itemBg,
					height: isMaximize ? 0 : headerHeight,
				}}
			>

				{
					isMobile
						? (
							<Button
								type="text"
								icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
								onClick={() => setPreferences("sidebarCollapsed", !sidebarCollapsed)}
								className="h-full"
							/>
						)
						: null
				}

				<div className="flex items-center grow h-full overflow-hidden">
					{children}
				</div>

				<div className={cn("flex items-center min-w-0", isMobile && "overflow-x-auto")}>
					{/* 插槽节点无稳定标识，用 Children.toArray 自动分配稳定 key（避免 index key 告警） */}
					{/* eslint-disable-next-line react/no-children-to-array -- 插槽节点无稳定 key，toArray 分配稳定 key 最稳 */}
					{Children.toArray(slotActions).map(node => <Fragment key={node.key ?? undefined}>{node}</Fragment>)}
					<GlobalSearch />
					<Preferences {...buttonProps} />
					<ThemeButton {...buttonProps} />
					<LanguageButton {...buttonProps} />
					<FullscreenButton {...buttonProps} target={document.documentElement} />
					<NotificationContainer {...buttonProps} />
					<UserMenu {...buttonProps} />
				</div>
			</header>
		</ConfigProvider>
	);
}
