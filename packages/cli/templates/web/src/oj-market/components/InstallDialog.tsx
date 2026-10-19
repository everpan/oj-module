import type { IndexRow, TaskRecord } from "../types";
import { Alert, Button, Modal, Progress, Space, Typography } from "antd";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarketClient } from "../api/context";
import { useInstallTask } from "../hooks/useMarket";

export interface InstallDialogProps {
	row: IndexRow | null
	open: boolean
	onClose: () => void
	onDone?: (record: TaskRecord) => void
	/** 显式目标版本（回滚用）；缺省取 row.latest（安装/升级） */
	version?: string | null
	/** 动作模式：安装/升级/回滚（仅影响标题文案；回滚 = 对旧版降级安装） */
	mode?: "install" | "upgrade" | "rollback"
}

const isTerminal = (r: TaskRecord | null) => r != null && r.status !== "running";

/**
 * 安装/升级/回滚对话框：触发 POST install → 800ms 轮询 TaskRecord 终态渲染（reason+retryable+hintKey 双语）。
 *  回滚 = 对已装旧版降级安装（显式 version）；降版迁移差异校验（R12）的可读失败由终态 error 渲染。
 */
export function InstallDialog({ row, open, onClose, onDone, version, mode }: InstallDialogProps) {
	const { t } = useTranslation();
	const client = useMarketClient();
	const [taskId, setTaskId] = useState<string | null>(null);
	const [started, setStarted] = useState(false);
	const { record, done } = useInstallTask(taskId);

	const targetVersion = version ?? row?.latest ?? null;
	const title
		= mode === "rollback"
			? t("oj-market:rollback:running")
			: row?.installed
				? t("oj-market:card:upgrade")
				: t("oj-market:task:installing");

	// 打开即触发安装（version 缺省取 latest；已装视为升级；显式 version = 回滚降级安装）
	useEffect(() => {
		if (open && row && !started) {
			setStarted(true);
			client
				.install({ name: row.name, version: targetVersion, source: "cdn" })
				.then(res => setTaskId(res.task_id))
				.catch(e => setTaskId(`__error__${e instanceof Error ? e.message : String(e)}`));
		}
		if (!open) {
			setTaskId(null);
			setStarted(false);
		}
	}, [open, row, started, client, targetVersion]);

	useEffect(() => {
		if (record && isTerminal(record) && done)
			onDone?.(record);
	}, [record, done, onDone]);

	const terminal = isTerminal(record);
	const failed = record?.status === "failed" || record?.status === "partial";
	const errorTask = typeof taskId === "string" && taskId.startsWith("__error__");

	return (
		<Modal
			title={title}
			open={open}
			onCancel={onClose}
			footer={terminal ? <Button onClick={onClose}>{t("oj-market:task:close")}</Button> : null}
			data-testid="install-dialog"
		>
			{errorTask && <Alert type="error" message={taskId!.slice("__error__".length)} />}
			{!errorTask && !record && (
				<Typography.Text>
					{t("oj-market:task:installing")}
					…
				</Typography.Text>
			)}
			{record && (
				<>
					<Progress percent={record.progress} status={terminal ? (failed ? "exception" : "success") : "active"} />
					<div data-testid="install-stage">{record.stage ? t(`oj-market:task:stage.${record.stage}`, record.stage) : record.stage}</div>
					<div data-testid="install-message">{record.message}</div>
					{failed && record.error && (
						<Alert
							type="error"
							showIcon
							message={record.error.reason}
							description={(
								<Space direction="vertical">
									<span>{record.error.retryable ? t("oj-market:task:retryable") : t("oj-market:task:notRetryable")}</span>
									{record.error.hintKey && <span data-testid="install-hint">{t(record.error.hintKey, record.error.hintKey)}</span>}
								</Space>
							)}
						/>
					)}
					{failed && (
						<Button
							style={{ marginTop: 12 }}
							onClick={() => {
								setTaskId(null);
								setStarted(false);
							}}
						>
							{t("oj-market:card:retry")}
						</Button>
					)}
				</>
			)}
		</Modal>
	);
}
