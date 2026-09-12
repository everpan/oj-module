import type { ButtonProps } from "antd";
import type { NotificationItem } from "./types";

import { BellOutlined } from "@ant-design/icons";
import { useToggle } from "ahooks";
import { List, Popover, Tooltip } from "antd";

import { clsx } from "clsx";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createUseStyles } from "react-jss";
import { BasicButton } from "#src/components/basic-button";
import { RiMailCheckLine } from "#src/icons";
import { cn } from "#src/utils/cn";

const useStyles = createUseStyles(({ token }) => (
	{
		notification: {
			"& .ant-popover-inner": {
				padding: 0,
			},
			"& .ant-list-footer": {
				borderTop: `1px solid ${token.colorBorder}`,
			},
			"& .ant-list-items": {
				height: 380,
				overflowY: "auto",
			},
		},
	}
));

export type NotificationEventType = "viewAll" | "makeAll" | "clear" | "read";

interface Props extends ButtonProps {
	/**
	 * 互动事件回调。存在即可互动；缺省（未注册 provider / provider 缺写方法的
	 * 老 bundle 漂移）时整体只读——「全部已读」「清空」禁用、单条点击 no-op
	 * （评审 A3：不加 disabled/readOnly 新 prop，由回调存在性推导）。
	 */
	onEventChange?: (event: NotificationEventType, item?: NotificationItem) => void
	/**
	 * 显示圆点
	 */
	dot?: boolean
	/**
	 * 消息列表
	 */
	notifications?: NotificationItem[]
}

export const NotificationPopup: React.FC<Props> = ({ dot, notifications, onEventChange, ...restProps }) => {
	const [open, action] = useToggle();
	const classes = useStyles();
	const { t } = useTranslation();
	// 只读态由回调存在性推导（评审 A3）：互动按钮禁用、单条点击 no-op
	const readOnly = !onEventChange;

	const close = () => {
		action.set(false);
	};

	const handleViewAll = () => {
		onEventChange && onEventChange("viewAll");
		close();
	};

	const handleMakeAll = () => {
		if (readOnly)
			return;
		onEventChange && onEventChange("makeAll");
	};

	const handleClear = () => {
		if (readOnly)
			return;
		onEventChange && onEventChange("clear");
	};

	const handleClick = (item: NotificationItem) => {
		if (readOnly)
			return;
		onEventChange && onEventChange("read", item);
	};

	dot = useMemo(() => {
		return !!notifications?.filter(item => !item?.isRead).length;
	}, [notifications]);

	return (
		<Popover
			// getPopupContainer={triggerNode => triggerNode}
			placement="bottomLeft"
			classNames={{
				root: clsx(classes.notification, "w-72 md:w-96 right-4"),
			}}
			open={open}
			arrow={false}
			trigger="click"
			onOpenChange={action.set}
			content={(

				<List
					size="small"
					bordered
					header={(
						<div className="flex items-center justify-between">
							<div>{t("widgets.notifications")}</div>
							<Tooltip title={notifications?.length ? t("widgets.markAllAsRead") : null}>
								<BasicButton
									disabled={readOnly || !notifications?.length}
									onClick={handleMakeAll}
									type="text"
									icon={<RiMailCheckLine />}
								/>
							</Tooltip>
						</div>
					)}
					footer={(
						<div className="flex items-center justify-between">
							<BasicButton
								disabled={readOnly || !notifications?.length}
								type="text"
								onClick={handleClear}
							>
								{t("widgets.clearNotifications")}
							</BasicButton>
							<BasicButton onClick={handleViewAll}>
								{t("widgets.viewAll")}
							</BasicButton>
						</div>
					)}
					dataSource={(notifications ?? []).filter((item): item is NotificationItem => Boolean(item))}
					renderItem={item => (
						<List.Item className="relative justify-start gap-5 hover:bg-gray-100 cursor-pointer" onClick={() => handleClick(item)}>
							{!item.isRead && <span className="absolute w-2 h-2 rounded bg-primary right-2 top-2"></span>}
							<span className="relative flex w-10 h-10 overflow-hidden rounded-full shrink-0">
								<img src={item.avatar} className="object-cover w-full h-full aspect-square" role="img" />
							</span>
							<div className="flex flex-col gap-1 leading-none">
								<p className="font-semibold">{item.title}</p>
								<p className="my-1 text-xs text-muted-foreground line-clamp-2">{item.message}</p>
								<p className="text-xs text-muted-foreground line-clamp-2">{item.date}</p>
							</div>
						</List.Item>
					)}
				/>
			)}
		>

			<BasicButton
				size="large"
				type="text"
				{...restProps}
				className={cn("relative group", restProps.className)}
				icon={<BellOutlined className="group-hover:animate-wiggle" />}
			>
				{dot && <span className="bg-blue-600 absolute right-2 top-1.5 h-2 w-2 rounded"></span>}
			</BasicButton>

		</Popover>
	);
};
