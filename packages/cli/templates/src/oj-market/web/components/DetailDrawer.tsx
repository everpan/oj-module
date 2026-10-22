import type { IndexRow } from "../types";
import { Button, Descriptions, Drawer, Space, Tag } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";

export interface DetailDrawerProps {
	row: IndexRow | null
	open: boolean
	onClose: () => void
	/** 是否具备管理权限（superadmin）；false 时禁用安装/回滚按钮，历史（只读）不受影响。 */
	canManage?: boolean
	onInstall: (row: IndexRow) => void
	onHistory: (row: IndexRow) => void
	onRollback: (row: IndexRow) => void
}

/** 方案详情抽屉：只读展示卡片元信息（含双版本对比）+ 安装/回滚/历史入口 */
export function DetailDrawer({ row, open, onClose, canManage = true, onInstall, onHistory, onRollback }: DetailDrawerProps) {
	const { t } = useTranslation();
	// 非 superadmin：写操作禁用并解释原因，历史（只读）保持可用。
	const manageTip = canManage ? undefined : t("oj-market:card:superOnly");
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
						<Button type="primary" onClick={() => onInstall(row)} disabled={!canManage} title={manageTip}>
							{row.installed ? t("oj-market:card:upgrade") : t("oj-market:card:install")}
						</Button>
						{row.installed != null && (
							<Button onClick={() => onRollback(row)} data-testid="detail-rollback" disabled={!canManage} title={manageTip}>
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
