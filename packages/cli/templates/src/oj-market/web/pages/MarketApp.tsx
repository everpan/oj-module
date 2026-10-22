import type { IndexRow, TaskRecord } from "../types";
import { useUserStore } from "@oj-module/runtime";
import { Alert, Typography } from "antd";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarketClient } from "../api/context";
import { CardGrid } from "../components/CardGrid";
import { DetailDrawer } from "../components/DetailDrawer";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { InstallDialog } from "../components/InstallDialog";
import { RollbackDialog } from "../components/RollbackDialog";
import { UninstallConfirm } from "../components/UninstallConfirm";
import { useMarketIndex } from "../hooks/useMarket";

/** 市场应用主页面：组装卡片网格 + 详情/安装/卸载/回滚/历史交互面（单一容器，DRY 编排） */
export default function MarketApp() {
	const { t } = useTranslation();
	const client = useMarketClient();
	const index = useMarketIndex();
	// 管理权限 = superadmin（与后端 assertSuperAdmin 口径一致）。仅屏蔽写操作，浏览（详情/历史）对所有登录用户开放。
	const roles = useUserStore(s => s.roles);
	const canManage = roles.includes("superadmin");

	const [detailRow, setDetailRow] = useState<IndexRow | null>(null);
	const [installRow, setInstallRow] = useState<IndexRow | null>(null);
	const [installVersion, setInstallVersion] = useState<string | null>(null);
	const [installMode, setInstallMode] = useState<"install" | "upgrade" | "rollback">("install");
	const [uninstallRow, setUninstallRow] = useState<IndexRow | null>(null);
	const [rollbackRow, setRollbackRow] = useState<IndexRow | null>(null);
	const [historyRow, setHistoryRow] = useState<IndexRow | null>(null);
	const [busyName, setBusyName] = useState<string | null>(null);

	const rows = index.status === "ok" ? index.data : [];

	// 安装/升级：目标版本缺省（取 latest）；已装视为升级
	const handleInstall = (row: IndexRow) => {
		setDetailRow(null);
		setInstallRow(row);
		setInstallVersion(null);
		setInstallMode(row.installed != null ? "upgrade" : "install");
	};

	// 回滚：先开版本选择抽屉，选中旧版后转安装（降级安装，显式 version）
	const handleRollback = (row: IndexRow) => {
		setDetailRow(null);
		setRollbackRow(row);
	};

	const handleRollbackChosen = (row: IndexRow, version: string) => {
		setRollbackRow(null);
		setInstallRow(row);
		setInstallVersion(version);
		setInstallMode("rollback");
	};

	const handleEnableToggle = async (row: IndexRow) => {
		setBusyName(row.name);
		try {
			await client.enable({ name: row.name, enabled: row.enabled !== true });
			index.retry();
		}
		finally {
			setBusyName(null);
		}
	};

	const handleUninstallConfirmed = async (row: IndexRow) => {
		setBusyName(row.name);
		try {
			await client.uninstall(row.name);
			setUninstallRow(null);
			index.retry();
		}
		finally {
			setBusyName(null);
		}
	};

	const handleInstallDone = (_rec: TaskRecord) => {
		index.retry();
	};

	return (
		<div style={{ padding: 24 }} data-testid="market-app">
			<Typography.Title level={4}>{t("oj-market:card:title")}</Typography.Title>
			<Typography.Paragraph type="secondary">{t("oj-market:card:subtitle")}</Typography.Paragraph>

			{!canManage && (
				<Alert
					type="info"
					showIcon
					style={{ marginBottom: 16 }}
					message={t("oj-market:card:superOnly")}
				/>
			)}

			<CardGrid
				loading={index.status === "loading"}
				error={index.status === "error" ? index.error : null}
				rows={rows}
				busyName={busyName}
				canManage={canManage}
				onInstall={handleInstall}
				onEnableToggle={handleEnableToggle}
				onDetails={r => setDetailRow(r)}
				onHistory={r => setHistoryRow(r)}
				onUninstall={r => setUninstallRow(r)}
				onRollback={handleRollback}
				onRetry={index.retry}
			/>

			<DetailDrawer
				row={detailRow}
				open={detailRow != null}
				onClose={() => setDetailRow(null)}
				canManage={canManage}
				onInstall={handleInstall}
				onHistory={(r) => {
					setDetailRow(null);
					setHistoryRow(r);
				}}
				onRollback={handleRollback}
			/>

			<InstallDialog
				row={installRow}
				open={installRow != null}
				onClose={() => setInstallRow(null)}
				onDone={handleInstallDone}
				version={installVersion}
				mode={installMode}
			/>

			<UninstallConfirm
				row={uninstallRow}
				open={uninstallRow != null}
				onClose={() => setUninstallRow(null)}
				onConfirmed={handleUninstallConfirmed}
			/>

			<RollbackDialog
				row={rollbackRow}
				open={rollbackRow != null}
				onClose={() => setRollbackRow(null)}
				onRollback={handleRollbackChosen}
			/>

			<HistoryDrawer row={historyRow} open={historyRow != null} onClose={() => setHistoryRow(null)} />
		</div>
	);
}
