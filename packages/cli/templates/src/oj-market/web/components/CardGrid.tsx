import type { IndexRow } from "../types";
import { Empty, Spin } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";
import { CardItem } from "./CardItem";

export interface CardGridProps {
	/** 加载态：true 时渲染加载骨架 */
	loading?: boolean
	/** 错误态：非空时渲染错误 + 重试 */
	error?: string | null
	rows: IndexRow[]
	busyName?: string | null
	/** 是否具备管理权限（superadmin）；透传给 CardItem 以禁用写操作。 */
	canManage?: boolean
	onInstall: (row: IndexRow) => void
	onEnableToggle: (row: IndexRow) => void
	onDetails: (row: IndexRow) => void
	onHistory: (row: IndexRow) => void
	onUninstall: (row: IndexRow) => void
	onRollback: (row: IndexRow) => void
	onRetry: () => void
}

/** 卡片网格容器：三态（加载/空/错误）+ 正常网格，DRY 渲染交由 CardItem */
export function CardGrid(props: CardGridProps) {
	const { t } = useTranslation();
	const { loading, error, rows, busyName, canManage, onInstall, onEnableToggle, onDetails, onHistory, onUninstall, onRollback, onRetry } = props;

	if (loading) {
		return (
			<div data-testid="card-grid-loading" style={{ padding: 48, textAlign: "center" }}>
				<Spin />
			</div>
		);
	}

	if (error) {
		return (
			<div data-testid="card-grid-error" style={{ padding: 48, textAlign: "center" }}>
				<Empty description={t("oj-market:card:error")} />
				<div style={{ marginTop: 12 }}>{error}</div>
				<button data-testid="card-grid-retry" onClick={onRetry}>
					{t("oj-market:card:retry")}
				</button>
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div data-testid="card-grid-empty" style={{ padding: 48, textAlign: "center" }}>
				<Empty description={t("oj-market:card:empty")} />
			</div>
		);
	}

	return (
		<div
			data-testid="card-grid"
			style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}
		>
			{rows.map(row => (
				<CardItem
					key={row.name}
					row={row}
					busy={busyName === row.name}
					canManage={canManage}
					onInstall={onInstall}
					onEnableToggle={onEnableToggle}
					onDetails={onDetails}
					onHistory={onHistory}
					onUninstall={onUninstall}
					onRollback={onRollback}
				/>
			))}
		</div>
	);
}
