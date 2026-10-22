import type { IndexRow, UninstallImpact } from "../types";
import { Alert, Modal, Spin, Typography } from "antd";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarketClient } from "../api/context";

export interface UninstallConfirmProps {
	row: IndexRow | null
	open: boolean
	onClose: () => void
	onConfirmed: (row: IndexRow) => void
}

/**
 * 卸载二次确认（P3 U1 语义前移）：打开即拉取影响面预检清单（受影响角色/用户计数），
 * 供 superadmin 二次确认。空锁/级联由服务端（P1-15a）统一把关，UI 仅做可读呈现。
 */
export function UninstallConfirm({ row, open, onClose, onConfirmed }: UninstallConfirmProps) {
	const { t } = useTranslation();
	const client = useMarketClient();
	const [impact, setImpact] = useState<UninstallImpact | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || !row)
			return;
		setLoading(true);
		setError(null);
		setImpact(null);
		client
			.uninstallImpact(row.name)
			.then(setImpact)
			.catch(e => setError(e instanceof Error ? e.message : String(e)))
			.finally(() => setLoading(false));
	}, [open, row, client]);

	return (
		<Modal
			title={t("oj-market:confirm:uninstallTitle")}
			open={open}
			onCancel={onClose}
			okText={t("oj-market:confirm:ok")}
			cancelText={t("oj-market:confirm:cancel")}
			okButtonProps={{ danger: true }}
			onOk={() => row && onConfirmed(row)}
			data-testid="uninstall-confirm"
		>
			<Typography.Paragraph>
				{t("oj-market:confirm:uninstallBody", { name: row?.name ?? "" })}
			</Typography.Paragraph>
			{loading && <Spin tip={t("oj-market:confirm:impactTitle")} />}
			{error && <Alert type="warning" message={error} />}
			{impact && (
				<div data-testid="uninstall-impact">
					<Typography.Text strong>{t("oj-market:confirm:impactTitle")}</Typography.Text>
					<div>
						{t("oj-market:history:colAction.uninstall")}
						:
						{impact.affectedRoles}
						{" "}
						·
						{t("oj-market:history:colOperator")}
						:
						{impact.affectedUsers}
					</div>
					{impact.affectedRoles === 0 && impact.affectedUsers === 0 && (
						<Typography.Text type="secondary">{t("oj-market:confirm:impactEmpty")}</Typography.Text>
					)}
				</div>
			)}
		</Modal>
	);
}
