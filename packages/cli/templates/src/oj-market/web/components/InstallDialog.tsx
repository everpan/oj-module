import type { IndexRow, TaskRecord } from "../types";
import { Alert, Button, Modal, Progress, Space, Typography } from "antd";
import React, { useEffect, useRef, useState } from "react";
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
 * 阶段失败指引（契约附录 A 的 `lifecycle.stage.*` key）→ 本模块文案。
 * 附录 A 的这批 key 在模板 locales 里尚未落地，直接 t() 会把裸 key 显示给运维，
 * 故此处显式映射；未收录的 key 保持原样（不吞信息）。
 */
const HINT_KEYS: Record<string, string> = {
	"lifecycle.stage.smoke.hint": "oj-market:task:hintSmoke",
	"lifecycle.stage.cancelled": "oj-market:task:hintCancelled",
	"lifecycle.stage.reloading.hint": "oj-market:task:hintReloading",
};

/**
 * 安装/升级/回滚对话框：触发 POST install → 800ms 轮询 TaskRecord 终态渲染（reason+retryable+hintKey 双语）。
 *  回滚 = 对已装旧版降级安装（显式 version）；降版迁移差异校验（R12）的可读失败由终态 error 渲染。
 */
export function InstallDialog({ row, open, onClose, onDone, version, mode }: InstallDialogProps) {
	const { t } = useTranslation();
	const client = useMarketClient();
	const [taskId, setTaskId] = useState<string | null>(null);
	const [started, setStarted] = useState(false);
	const [trusting, setTrusting] = useState(false);
	const [trustError, setTrustError] = useState<string | null>(null);
	const { record, done } = useInstallTask(taskId);
	// onDone 对同一任务只通告一次：父级每次渲染都会换 onDone 身份，若只靠 deps 触发，
	// 终态后 onDone → index.retry() → 父级重渲染 → onDone 身份变 → 再触发，会形成
	// 无限请求循环（浏览器侧表现为 ERR_INSUFFICIENT_RESOURCES）。
	const notifiedTaskIdRef = useRef<string | null>(null);

	const targetVersion = version ?? row?.latest ?? null;
	const title
		= mode === "rollback"
			? t("oj-market:rollback:running")
			: row?.installed
				? t("oj-market:card:upgrade")
				: t("oj-market:task:installing");

	// 打开即触发安装（version 缺省取 latest；已装视为升级；显式 version = 回滚降级安装）。
	// 注：下面的同步 set 均为「弹窗打开/关闭生命周期」的有意重置与触发守卫；
	// 曾尝试渲染期派生重置，但同组件 notifier effect 里的 onDone?.(record) 会触发
	// eslint-react set-state-in-effect 的误判（prop 回调被解析回组件函数），故保留原结构。
	useEffect(() => {
		if (open && row && !started) {
			// eslint-disable-next-line react/set-state-in-effect -- 有意：打开弹窗时置「已触发」守卫，保证安装只发起一次
			setStarted(true);
			client
				.install({ name: row.name, version: targetVersion, source: "cdn" })
				.then(res => setTaskId(res.task_id))
				.catch(e => setTaskId(`__error__${e instanceof Error ? e.message : String(e)}`));
		}
		if (!open) {
			// eslint-disable-next-line react/set-state-in-effect -- 有意：关闭弹窗时清空任务，下次打开是全新一次安装
			setTaskId(null);
			// eslint-disable-next-line react/set-state-in-effect -- 有意：关闭时复位触发守卫，配合上行清场
			setStarted(false);
			// eslint-disable-next-line react/set-state-in-effect -- 有意：关闭时清掉信任错误，避免残留到下次打开
			setTrustError(null);
			notifiedTaskIdRef.current = null;
		}
	}, [open, row, started, client, targetVersion]);

	useEffect(() => {
		if (!record || !isTerminal(record) || !done)
			return;
		if (notifiedTaskIdRef.current === record.id)
			return;
		notifiedTaskIdRef.current = record.id;
		onDone?.(record);
	}, [record, done, onDone]);

	// TOFU 确认：确认入库后重试同一安装（服务端 staging 未清场，续跑不重下）
	const handleTrustConfirm = async () => {
		if (taskId === null || taskId.startsWith("__error__"))
			return;
		setTrusting(true);
		setTrustError(null);
		try {
			await client.trust(taskId);
			notifiedTaskIdRef.current = null;
			setTaskId(null);
			setStarted(false);
		}
		catch (e) {
			setTrustError(e instanceof Error ? e.message : String(e));
		}
		finally {
			setTrusting(false);
		}
	};

	const terminal = isTerminal(record);
	const needsTrust = record?.status === "needs_trust";
	const succeeded = record?.status === "done";
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
					<Progress percent={record.progress} status={terminal ? (succeeded ? "success" : "exception") : "active"} />
					<div data-testid="install-stage">{record.stage ? t(`oj-market:task:stage.${record.stage}`, record.stage) : record.stage}</div>
					<div data-testid="install-message">{record.message}</div>
					{needsTrust && record?.trust && (
						<Alert
							style={{ marginTop: 12 }}
							type="warning"
							showIcon
							message={t("oj-market:task:trustTitle")}
							description={(
								<Space direction="vertical" size={4}>
									<span>{t("oj-market:task:trustBody", { keyId: record.trust.key_id })}</span>
									<span data-testid="install-trust-fingerprint">
										{t("oj-market:task:trustFingerprint")}
										<Typography.Text code copyable={{ text: record.trust.fingerprint }}>
											{record.trust.fingerprint}
										</Typography.Text>
									</span>
									<span>{t("oj-market:task:trustHint")}</span>
								</Space>
							)}
						/>
					)}
					{needsTrust && trustError && <Alert style={{ marginTop: 8 }} type="error" showIcon message={trustError} />}
					{needsTrust && (
						<Button type="primary" style={{ marginTop: 12 }} loading={trusting} onClick={handleTrustConfirm}>
							{t("oj-market:task:trustConfirm")}
						</Button>
					)}
					{failed && record.error && (
						<Alert
							type="error"
							showIcon
							message={record.error.reason}
							description={(
								<Space direction="vertical">
									<span>{record.error.retryable ? t("oj-market:task:retryable") : t("oj-market:task:notRetryable")}</span>
									{record.error.hintKey && (
										<span data-testid="install-hint">
											{t(HINT_KEYS[record.error.hintKey] ?? record.error.hintKey, record.error.hintKey)}
										</span>
									)}
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
