import type { IndexRow, MarketHistory } from "../types";
import { Alert, Button, Drawer, Popconfirm, Table, Tag, Tooltip, Typography } from "antd";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarketClient } from "../api/context";
import { useMarketHistory } from "../hooks/useMarket";
import { canPurgeHistory, latestInstallByVersion, versionKey } from "../utils/history";

export interface HistoryDrawerProps {
	row: IndexRow | null
	open: boolean
	onClose: () => void
}

/** 安装结论的颜色（仅 install 动作；其它动作走原文案） */
const RESULT_COLOR: Record<string, string> = {
	done: "green",
	partial: "orange",
	failed: "red",
	needs_trust: "gold",
	cancelled: "default",
};

/**
 * 操作历史抽屉：只读消费本仓 market_history 端点，按当前方案过滤。
 * 2026-11-08：安装失败也留痕（status=failed/needs_trust/cancelled + message 带最后一次错误明细），
 * 因此这里多了「结果」标记与「删除失败版本」入口——删除会清掉该版本全部未成功记录与残留版本目录。
 */
export function HistoryDrawer({ row, open, onClose }: HistoryDrawerProps) {
	const { t } = useTranslation();
	const client = useMarketClient();
	const { status, data, retry, reload } = useMarketHistory();
	const [purging, setPurging] = useState<string | null>(null);
	const [purgeError, setPurgeError] = useState<string | null>(null);

	const all = status === "ok" ? data : [];
	const rows: MarketHistory[] = all.filter(
		h => !row || h.solution === row.name,
	);
	const latest = latestInstallByVersion(all);

	const resultText = (h: MarketHistory): string => {
		if (h.action !== "install")
			return t(`oj-market:history:status.${h.status}`, h.status);
		return t(`oj-market:history:result.${h.status}`, h.status);
	};

	const purge = async (h: MarketHistory): Promise<void> => {
		setPurgeError(null);
		setPurging(versionKey(h));
		try {
			const r = await client.purgeHistory({ name: h.solution, version: h.version });
			if (!r.ok) {
				setPurgeError(r.message);
				return;
			}
			reload();
		}
		catch (e) {
			setPurgeError(e instanceof Error ? e.message : String(e));
		}
		finally {
			setPurging(null);
		}
	};

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
			render: (_s: string, h: MarketHistory) => (
				<Tag color={RESULT_COLOR[h.status] ?? "default"} data-testid={`history-result-${h.version}`}>
					{resultText(h)}
				</Tag>
			),
		},
		{
			title: t("oj-market:history:colMessage"),
			dataIndex: "message",
			key: "message",
			width: 260,
			render: (m: string | null) => (m === null || m === ""
				? "-"
				: (
					<Tooltip title={m}>
						<Typography.Text ellipsis style={{ maxWidth: 240 }} data-testid="history-message">
							{m}
						</Typography.Text>
					</Tooltip>
				)),
		},
		{ title: t("oj-market:history:colOperator"), dataIndex: "operator", key: "operator" },
		{
			title: t("oj-market:history:colTime"),
			dataIndex: "created_at",
			key: "created_at",
			render: (ts: number) => new Date(ts * 1000).toLocaleString(),
		},
		{
			title: t("oj-market:history:colOps"),
			key: "ops",
			width: 120,
			render: (_: unknown, h: MarketHistory) => (canPurgeHistory(h, latest, row?.installed ?? undefined) && (
				<Popconfirm
					title={t("oj-market:history:purgeConfirmTitle")}
					description={t("oj-market:history:purgeConfirmBody", { name: h.solution, version: h.version })}
					okText={t("oj-market:history:purgeOk")}
					cancelText={t("oj-market:confirm:cancel")}
					okButtonProps={{ danger: true }}
					onConfirm={() => purge(h)}
				>
					<Button danger size="small" loading={purging === versionKey(h)} data-testid={`history-purge-${h.version}`}>
						{t("oj-market:history:purge")}
					</Button>
				</Popconfirm>
			)),
		},
	];

	return (
		<Drawer
			title={t("oj-market:history:title")}
			open={open}
			onClose={onClose}
			width={900}
			data-testid="history-drawer"
		>
			{status === "error" && (
				<div data-testid="history-error">
					{t("oj-market:card:error")}
					:
					{retry && <button onClick={retry}>{t("oj-market:card:retry")}</button>}
				</div>
			)}
			{purgeError !== null && (
				<Alert
					style={{ marginBottom: 8 }}
					type="error"
					showIcon
					message={t("oj-market:history:purgeFailed")}
					description={purgeError}
					data-testid="history-purge-error"
				/>
			)}
			<Table
				size="small"
				rowKey="id"
				dataSource={rows}
				columns={columns}
				pagination={false}
				scroll={{ x: 900 }}
				locale={{ emptyText: t("oj-market:history:empty") }}
				data-testid="history-table"
			/>
		</Drawer>
	);
}
