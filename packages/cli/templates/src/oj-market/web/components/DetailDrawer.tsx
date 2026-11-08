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

/** 方案详情抽屉：只读展示卡片元信息（含双版本对比）+ 完整简介/描述 + 安装/回滚/历史入口 */
export function DetailDrawer({ row, open, onClose, canManage = true, onInstall, onHistory, onRollback }: DetailDrawerProps) {
	const { t } = useTranslation();
	// 非 superadmin：写操作禁用并解释原因，历史（只读）保持可用。
	const manageTip = canManage ? undefined : t("oj-market:card:superOnly");
	// 已装且无可升级发布版时，升级按钮无意义：与卡片一致禁用（upgradable 由服务端算好）
	const upgradeBlocked = row != null && row.installed != null && !row.upgradable;
	const installTip = manageTip ?? (upgradeBlocked ? t("oj-market:card:latestInstalled") : undefined);
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
					{/*
					 * 标签列固定宽度：bordered Descriptions 的表格是 table-layout:auto，值列有长文本时，
					 * 中文标签会因「任意字符可断行」被压到 2 字宽（已启用/可升级/详细介绍 都折行）。
					 * 96px = 3 个汉字（14px × 3）+ 左右内边距（16px × 2）+ 边框，留少量余量；
					 * nowrap 兜住英文等更长的标签（表格自动布局会按需撑开该列，不会溢出）。
					 */}
					<Descriptions
						column={1}
						size="small"
						bordered
						styles={{ label: { width: 96, whiteSpace: "nowrap" } }}
					>
						<Descriptions.Item label={t("oj-market:card:latest")}>{row.latest ?? "-"}</Descriptions.Item>
						<Descriptions.Item label={t("oj-market:card:installed")}>{row.installed ?? t("oj-market:card:notInstalled")}</Descriptions.Item>
						<Descriptions.Item label={t("oj-market:card:enabled")}>
							{row.enabled == null ? "-" : row.enabled ? t("oj-market:card:enabled") : t("oj-market:card:disabled")}
						</Descriptions.Item>
						<Descriptions.Item label={t("oj-market:card:upgradable")}>
							{row.upgradable ? <Tag color="gold">{t("oj-market:card:upgradable")}</Tag> : "-"}
						</Descriptions.Item>
						{typeof row.publisher_key === "string" && row.publisher_key.trim() !== "" && (
							<Descriptions.Item label={t("oj-market:card:publisher")}>
								<span data-testid="detail-publisher" style={{ wordBreak: "break-all" }}>{row.publisher_key}</span>
							</Descriptions.Item>
						)}
						{/* 卡片上的 description 被限行，抽屉给全文（保留换行，长串不撑破抽屉） */}
						{typeof row.summary === "string" && row.summary.trim() !== "" && (
							<Descriptions.Item label={t("oj-market:card:summary")}>
								<span data-testid="detail-summary">{row.summary}</span>
							</Descriptions.Item>
						)}
						{typeof row.description === "string" && row.description.trim() !== "" && (
							<Descriptions.Item label={t("oj-market:card:description")}>
								<div data-testid="detail-description" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.description}</div>
							</Descriptions.Item>
						)}
					</Descriptions>
					<Space style={{ marginTop: 16 }}>
						<Button type="primary" onClick={() => onInstall(row)} disabled={!canManage || upgradeBlocked} title={installTip}>
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
