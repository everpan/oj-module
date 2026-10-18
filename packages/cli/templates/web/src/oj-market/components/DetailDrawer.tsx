import type { IndexRow } from "../types";
import { Button, Descriptions, Drawer, Space, Tag } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";

export interface DetailDrawerProps {
	row: IndexRow | null
	open: boolean
	onClose: () => void
	onInstall: (row: IndexRow) => void
	onHistory: (row: IndexRow) => void
	onRollback: (row: IndexRow) => void
}

/** 方案详情抽屉：只读展示卡片元信息（含双版本对比）+ 安装/回滚/历史入口 */
export function DetailDrawer({ row, open, onClose, onInstall, onHistory, onRollback }: DetailDrawerProps) {
	const { t } = useTranslation();
	return (
		<Drawer
			title={row ? row.name : t("oj-market:card:details")}
			open={open}
			onClose={onClose}
			width={420}
			data-testid="detail-drawer"
		>
			{row && (
				<>
					<Descriptions column={1} size="small" bordered>
						<Descriptions.Item label={t("oj-market:card:latest")}>{row.latest ?? "-"}</Descriptions.Item>
						<Descriptions.Item label={t("oj-market:card:installed")}>{row.installed ?? t("oj-market:card:notInstalled")}</Descriptions.Item>
						<Descriptions.Item label={t("oj-market:card:enabled")}>
							{row.enabled == null ? "-" : row.enabled ? t("oj-market:card:enabled") : t("oj-market:card:disabled")}
						</Descriptions.Item>
						<Descriptions.Item label={t("oj-market:card:upgradable")}>
							{row.upgradable ? <Tag color="gold">{t("oj-market:card:upgradable")}</Tag> : "-"}
						</Descriptions.Item>
					</Descriptions>
					<Space style={{ marginTop: 16 }}>
						<Button type="primary" onClick={() => onInstall(row)}>
							{row.installed ? t("oj-market:card:upgrade") : t("oj-market:card:install")}
						</Button>
						{row.installed != null && (
							<Button onClick={() => onRollback(row)} data-testid="detail-rollback">
								{t("oj-market:card:rollback")}
							</Button>
						)}
						<Button onClick={() => onHistory(row)}>{t("oj-market:card:history")}</Button>
					</Space>
				</>
			)}
		</Drawer>
	);
}
