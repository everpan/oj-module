import type { IndexRow, TaskRecord } from "../types";
import { useUserStore } from "@oj-module/runtime";
import { Alert, Button, Modal, Pagination, Typography } from "antd";
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
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(20);
	const index = useMarketIndex(page, pageSize);
	// 管理权限 = superadmin（与后端写面 assertSuperAdmin 口径一致）。仅屏蔽写操作，浏览（卡片/详情/历史）对所有登录用户开放。
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
	// 安装/升级/回滚完成后，前端资源需整页刷新才能加载新版本：弹出刷新提示（不自动刷新，由用户确认）
	const [refreshPrompt, setRefreshPrompt] = useState<TaskRecord | null>(null);

	const pageData = index.status === "ok" ? index.data : null;
	const rows = pageData?.list ?? [];

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

	const handleInstallDone = (rec: TaskRecord) => {
		index.retry();
		// 仅成功终态才提示刷新：失败/部分完成/待信任时前端资源并未改变，刷新既无意义，
		// 还会用「刷新页面」弹窗盖住正在展示的错误原因与重试入口（安装失败却被提示刷新）。
		if (rec.status !== "done")
			return;
		// 安装/升级/回滚成功改写站点已装模块；前端 SPA 仍是旧 bundle，需整页刷新才加载新版本
		setRefreshPrompt(rec);
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

			{pageData != null && pageData.total > pageSize && (
				<Pagination
					style={{ marginTop: 16, textAlign: "right" }}
					current={page}
					pageSize={pageSize}
					total={pageData.total}
					onChange={(p, ps) => {
						setPage(ps !== pageSize ? 1 : p);
						setPageSize(ps);
					}}
					showSizeChanger
				/>
			)}

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

			<Modal
				title={t("oj-market:card:refreshTitle")}
				open={refreshPrompt != null}
				closable={false}
				maskClosable={false}
				data-testid="refresh-prompt"
				footer={[
					<Button key="reload" type="primary" onClick={() => window.location.reload()}>
						{t("oj-market:card:refreshNow")}
					</Button>,
				]}
			>
				<Typography.Paragraph>{t("oj-market:card:refreshBody")}</Typography.Paragraph>
			</Modal>
		</div>
	);
}
