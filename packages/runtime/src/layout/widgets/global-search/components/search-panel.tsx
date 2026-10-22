import type { ReactElement } from "react";
import type { MenuItemType } from "#src/layout/layout-menu/types";

import { CloseOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { clsx } from "clsx";
import { cloneElement, isValidElement } from "react";
import { useTranslation } from "react-i18next";

interface SearchPanelProps {
	menuItem: MenuItemType
	setActiveKey: (activeKey: string) => void
	enter: (isLink?: boolean) => void
	removeHistoryItem: (key: string) => void
	active: boolean
	showCloseButton: boolean
}

export function SearchPanel({ menuItem, active, enter, setActiveKey, showCloseButton, removeHistoryItem }: SearchPanelProps) {
	const { t } = useTranslation();

	const isExternalLink = isValidElement(menuItem?.label);

	function handleMouseEnter(key: string) {
		setActiveKey(key);
	}

	return (
		<>
			<li
				data-search-item={menuItem.key}
				onMouseEnter={() => {
					handleMouseEnter(menuItem.key);
				}}
				onClick={() => enter(isExternalLink)}
				className={clsx(
					"flex flex-col bg-colorBgLayout cursor-pointer px-4 py-4 rounded-md mb-2",
					active ? "text-colorBgContainer" : "text-colorText",
					{ "bg-primaryActive": active },
				)}
			>
				<div className="flex items-center justify-between">
					<div className="flex items-center">
						{menuItem.icon && <div className="mr-3">{menuItem.icon}</div>}
						{/* 有意的 cloneElement：把翻译后的文本注入原 label 元素（i18n 包裹模式） */}
						{/* eslint-disable-next-line react/no-clone-element */}
						<span>{isValidElement(menuItem?.label) ? cloneElement(menuItem.label, {}, t((menuItem.label as ReactElement<{ children: string }>)?.props?.children)) : t(`${menuItem?.label}`)}</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="opacity-50">{menuItem.key}</div>
						<Button
							className={clsx(
								{ hidden: !showCloseButton },
								active ? "text-colorBgContainer!" : "text-colorText!",
							)}
							size="small"
							ghost={false}
							type="text"
							shape="circle"
							icon={<CloseOutlined />}
							onClick={(e) => {
								e.stopPropagation();
								removeHistoryItem(menuItem.key);
							}}
						/>
					</div>
				</div>
			</li>
		</>
	);
}
