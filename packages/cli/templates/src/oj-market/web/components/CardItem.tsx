import type { IndexRow } from "../types";
import { Button, Card, Space, Tag } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";

export interface CardItemProps {
	row: IndexRow
	busy?: boolean
	/** 是否具备管理权限（superadmin）。false 时禁用一切写操作（安装/升级/启停/回滚/卸载），仅保留浏览。 */
	canManage?: boolean
	onInstall: (row: IndexRow) => void
	onEnableToggle: (row: IndexRow) => void
	onDetails: (row: IndexRow) => void
	onHistory: (row: IndexRow) => void
	onUninstall: (row: IndexRow) => void
	onRollback: (row: IndexRow) => void
}

/**
 * 单张方案卡片：版本/状态标识（enabled/disabled/upgradable）+ 动作按钮。
 * 双版本展示（P1-15b）：已装且可升级时并列「已装 installed → 最新 latest」（upgradable 对比），
 * 否则单版本。已装方案提供回滚入口（RollbackDialog 选旧版降级安装）。
 */
export function CardItem({ row, busy, canManage = true, onInstall, onEnableToggle, onDetails, onHistory, onUninstall, onRollback }: CardItemProps) {
	const { t } = useTranslation();
	const installed = row.installed != null;
	const enabled = row.enabled === true;
	const disabled = row.enabled === false;
	const dualVersion = installed && row.upgradable && row.latest != null;
	// 非 superadmin：所有写操作禁用并给出原因提示，只读（详情/历史）不受影响。
	const manageTip = canManage ? undefined : t("oj-market:card:superOnly");

	return (
		<Card
			title={row.name}
			size="small"
			data-testid={`card-${row.name}`}
			extra={(
				<Space size={4}>
					{row.upgradable && <Tag color="gold">{t("oj-market:card:upgradable")}</Tag>}
					{!installed && <Tag>{t("oj-market:card:notInstalled")}</Tag>}
					{enabled && <Tag color="green">{t("oj-market:card:enabled")}</Tag>}
					{disabled && <Tag color="default">{t("oj-market:card:disabled")}</Tag>}
				</Space>
			)}
		>
			<div style={{ minHeight: 40, color: "var(--oo-text-secondary, #888)", marginBottom: 12 }} data-testid={`card-versions-${row.name}`}>
				{dualVersion
					? (
						<span>
							{t("oj-market:card:installed")}
							{" "}
							{row.installed}
							{" "}
							→
							{" "}
							{t("oj-market:card:latest")}
							{" "}
							{row.latest}
						</span>
					)
					: installed
						? (
							<span>
								{t("oj-market:card:version")}
								:
								{row.installed}
							</span>
						)
						: (
							<span>
								{t("oj-market:card:version")}
								:
								{row.latest ?? "-"}
							</span>
						)}
			</div>
			<Space wrap>
				<Button type="primary" size="small" loading={busy} onClick={() => onInstall(row)} disabled={busy || !canManage} title={manageTip}>
					{installed ? t("oj-market:card:upgrade") : t("oj-market:card:install")}
				</Button>
				{installed && (
					<Button size="small" onClick={() => onEnableToggle(row)} disabled={busy || !canManage} title={manageTip}>
						{enabled ? t("oj-market:card:disable") : t("oj-market:card:enable")}
					</Button>
				)}
				{installed && (
					<Button size="small" onClick={() => onRollback(row)} disabled={busy || !canManage} title={manageTip} data-testid={`card-rollback-${row.name}`}>
						{t("oj-market:card:rollback")}
					</Button>
				)}
				{installed && (
					<Button size="small" danger onClick={() => onUninstall(row)} disabled={busy || !canManage} title={manageTip}>
						{t("oj-market:card:uninstall")}
					</Button>
				)}
				<Button size="small" onClick={() => onDetails(row)}>
					{t("oj-market:card:details")}
				</Button>
				<Button size="small" onClick={() => onHistory(row)}>
					{t("oj-market:card:history")}
				</Button>
			</Space>
		</Card>
	);
}
