import type { IndexRow } from "../types";
import { Alert, Modal, Radio, Space, Spin, Typography } from "antd";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarketHistory } from "../hooks/useMarket";
import { compareVersions } from "../utils/semver";

export interface RollbackDialogProps {
	row: IndexRow | null
	open: boolean
	onClose: () => void
	onRollback: (row: IndexRow, version: string) => void
}

/**
 * 回滚版本选择（P1-15b）：候选 = 该方案 market_history 出现过且版本 < 已装版本的历史版本
 * （compareVersions；宿主 CDN 索引版本列表未进 IndexRow 契约，故以历史已装版本为回滚真源）。
 * 回滚 = 对所选旧版重新安装（降级）；迁移差异校验（R12）的可读失败由 InstallDialog 终态 error 渲染。
 */
export function RollbackDialog({ row, open, onClose, onRollback }: RollbackDialogProps) {
	const { t } = useTranslation();
	const { status, data } = useMarketHistory();
	const [selected, setSelected] = useState<string | null>(null);

	const candidates = useMemo(() => {
		const installed = row?.installed;
		if (!row || !installed)
			return [] as string[];
		const versions = new Set<string>();
		for (const h of status === "ok" ? data : []) {
			if (h.solution === row.name && compareVersions(h.version, installed) < 0)
				versions.add(h.version);
		}
		return [...versions].sort((a, b) => compareVersions(b, a)); // 较新的旧版在前
	}, [row, status, data]);

	// 候选集变化（历史加载完成/切换方案）时默认选中最新旧版；
	// 渲染期同步派生重置，替代 effect 内同步 set（react/set-state-in-effect）
	const [prevCandidates, setPrevCandidates] = useState(candidates);
	if (prevCandidates !== candidates) {
		setPrevCandidates(candidates);
		setSelected(candidates.length ? candidates[0] : null);
	}

	const loading = status === "loading";

	return (
		<Modal
			title={t("oj-market:rollback:title")}
			open={open}
			onCancel={onClose}
			okText={t("oj-market:rollback:confirm")}
			cancelText={t("oj-market:confirm:cancel")}
			okButtonProps={{ danger: true, disabled: !selected }}
			onOk={() => row && selected && onRollback(row, selected)}
			data-testid="rollback-dialog"
		>
			<Typography.Paragraph>
				{t("oj-market:rollback:body", { name: row?.name ?? "", installed: row?.installed ?? "-" })}
			</Typography.Paragraph>
			<Alert type="warning" showIcon message={t("oj-market:rollback:warning")} style={{ marginBottom: 12 }} />
			{loading && <Spin />}
			{!loading && candidates.length === 0 && (
				<div data-testid="rollback-empty">{t("oj-market:rollback:noCandidates")}</div>
			)}
			{!loading && candidates.length > 0 && (
				<Radio.Group
					value={selected ?? undefined}
					onChange={e => setSelected(e.target.value)}
					data-testid="rollback-versions"
				>
					<Space direction="vertical">
						{candidates.map(v => (
							<Radio key={v} value={v}>
								{v}
							</Radio>
						))}
					</Space>
				</Radio.Group>
			)}
		</Modal>
	);
}
