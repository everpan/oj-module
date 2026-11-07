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
	const [error, setError] = useState<string | null>(null);
	// 二次确认：先展示影响面预检（第一步），点击「确认卸载」进入最终确认（第二步），再点一次才真正卸载
	const [armed, setArmed] = useState(false);

	// 打开（或切换方案）即清场上一轮结果；渲染期同步派生重置，替代 effect 内同步 set
	const rowKey = open && row ? row.name : null;
	const [prevRowKey, setPrevRowKey] = useState(rowKey);
	if (prevRowKey !== rowKey) {
		setPrevRowKey(rowKey);
		setImpact(null);
		setError(null);
		setArmed(false);
	}

	useEffect(() => {
		if (!open || !row)
			return;
		let active = true;
		client
			.uninstallImpact(row.name)
			.then(i => active && setImpact(i))
			.catch(e => active && setError(e instanceof Error ? e.message : String(e)));
		return () => {
			active = false;
		};
	}, [open, row, client]);

	// 加载态派生：已打开且尚无结果/错误即视为预检中（替代原 effect 同步 setLoading）
	const loading = rowKey !== null && impact === null && error === null;

	const handleOk = () => {
		// 第一步只「武装」到二次确认；第二步才真正卸载
		if (!armed) {
			setArmed(true);
			return;
		}
		if (row)
			onConfirmed(row);
	};

	const handleCancel = () => {
		setArmed(false);
		onClose();
	};

	return (
		<Modal
			title={t("oj-market:confirm:uninstallTitle")}
			open={open}
			onCancel={handleCancel}
			okText={armed ? t("oj-market:confirm:okFinal", { name: row?.name ?? "" }) : t("oj-market:confirm:ok")}
			cancelText={armed ? t("oj-market:confirm:cancelBack") : t("oj-market:confirm:cancel")}
			okButtonProps={{ danger: true }}
			onOk={handleOk}
			data-testid="uninstall-confirm"
		>
			{!armed
				? (
					<>
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
					</>
				)
				: (
					<Alert
						type="error"
						showIcon
						message={t("oj-market:confirm:finalTitle")}
						description={t("oj-market:confirm:finalBody", { name: row?.name ?? "" })}
					/>
				)}
		</Modal>
	);
}
