import type { IndexRow, MarketHistory } from "../types";
import { Drawer, Table } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";
import { useMarketClient } from "../api/context";
import { useMarketHistory } from "../hooks/useMarket";

export interface HistoryDrawerProps {
	row: IndexRow | null
	open: boolean
	onClose: () => void
}

/** 操作历史抽屉：只读消费本仓 market_history 端点，按当前方案过滤 */
export function HistoryDrawer({ row, open, onClose }: HistoryDrawerProps) {
	const { t } = useTranslation();
	const client = useMarketClient();
	void client;
	const { status, data, retry } = useMarketHistory();

	const rows: MarketHistory[] = (status === "ok" ? data : []).filter(
		h => !row || h.solution === row.name,
	);

	const columns = [
		{ title: t("oj-market:history:colSolution"), dataIndex: "solution", key: "solution" },
		{ title: t("oj-market:history:colVersion"), dataIndex: "version", key: "version" },
		{
			title: t("oj-market:history:colAction"),
			dataIndex: "action",
			key: "action",
			render: (a: MarketHistory["action"]) => t(`oj-market:history:action.${a}`),
		},
		{
			title: t("oj-market:history:colStatus"),
			dataIndex: "status",
			key: "status",
			render: (s: string) => t(`oj-market:history:status.${s}`, s),
		},
		{ title: t("oj-market:history:colOperator"), dataIndex: "operator", key: "operator" },
		{
			title: t("oj-market:history:colTime"),
			dataIndex: "created_at",
			key: "created_at",
			render: (ts: number) => new Date(ts * 1000).toLocaleString(),
		},
	];

	return (
		<Drawer
			title={t("oj-market:history:title")}
			open={open}
			onClose={onClose}
			width={560}
			data-testid="history-drawer"
		>
			{status === "error" && (
				<div data-testid="history-error">
					{t("oj-market:card:error")}
					:
					{retry && <button onClick={retry}>{t("oj-market:card:retry")}</button>}
				</div>
			)}
			<Table
				size="small"
				rowKey="id"
				dataSource={rows}
				columns={columns}
				pagination={false}
				locale={{ emptyText: t("oj-market:history:empty") }}
				data-testid="history-table"
			/>
		</Drawer>
	);
}
