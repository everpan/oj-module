import type { IndexRow } from "../types";
import { Button, Card, Popconfirm, Space, Tag } from "antd";
import React from "react";
import { useTranslation } from "react-i18next";

export interface CardItemProps {
	row: IndexRow
	busy?: boolean
	/** 是否具备管理权限（superadmin）。false 时禁用一切写操作（安装/升级/启停/回滚/卸载），仅保留浏览。 */
	canManage?: boolean
	onInstall: (row: IndexRow) => void
	onEnableToggle: (row: IndexRow) => void
	onDetails: (row: IndexRow) => void
	onHistory: (row: IndexRow) => void
	onUninstall: (row: IndexRow) => void
	onRollback: (row: IndexRow) => void
}

/**
 * 单张方案卡片：方案简介/详细描述 + 版本/状态标识（enabled/disabled/upgradable）+ 动作按钮。
 * 卡片上先展示 summary（单行）与 description（最多 3 行，完整文案见详情抽屉），让人不必点
 * 详情就能判断方案提供什么；索引未声明这两项就不占位（与 license 同口径）。
 * 双版本展示（P1-15b）：已装且可升级时并列「已装 installed → 最新 latest」（upgradable 对比），
 * 否则单版本。已装方案提供回滚入口（RollbackDialog 选旧版降级安装）。
 * 详情入口：点击卡片正文整块打开详情抽屉（详情按钮已移除，动作区只留写操作 + 历史）。
 */
export function CardItem({ row, busy, canManage = true, onInstall, onEnableToggle, onDetails, onHistory, onUninstall, onRollback }: CardItemProps) {
	const { t } = useTranslation();
	const installed = row.installed != null;
	const enabled = row.enabled === true;
	const disabled = row.enabled === false;
	const dualVersion = installed && row.upgradable && row.latest != null;
	// 无可升级发布版时升级无意义：禁用并提示（upgradable = 存在 > 已装版本的在架发布，服务端已算好）
	const upgradeBlocked = installed && !row.upgradable;
	// 非 superadmin：所有写操作禁用并给出原因提示，只读（详情/历史）不受影响。
	const manageTip = canManage ? undefined : t("oj-market:card:superOnly");
	// oj-market 是第一方方案市场自身：其 API 面随平台内置，停用会把它们从 API 锁摘除，
	// 导致 /api/oj-market/* 全 404、方案市场整页不可用，故卡片上的「停用」永久禁用。
	const isFirstPartyMarket = row.name === "oj-market";
	const disableLocked = enabled && isFirstPartyMarket;
	const toggleDisabled = busy || !canManage || disableLocked;
	const toggleTip = disableLocked ? t("oj-market:card:disableLocked") : manageTip;
	const toggleButton = (
		<Button
			style={{ flexShrink: 0 }}
			size="small"
			onClick={enabled ? undefined : () => onEnableToggle(row)}
			disabled={toggleDisabled}
			title={toggleTip}
			data-testid={`card-toggle-${row.name}`}
		>
			{enabled ? t("oj-market:card:disable") : t("oj-market:card:enable")}
		</Button>
	);

	return (
		<Card
			title={row.name}
			size="small"
			data-testid={`card-${row.name}`}
			// 卡片体 flex 纵列：内容自然高度，按钮行 marginTop:auto 钉底——
			// 网格同行卡片高度一致（grid stretch），按钮底边对齐
			style={{ display: "flex", flexDirection: "column", height: "100%" }}
			styles={{ body: { flex: 1, display: "flex", flexDirection: "column" } }}
			extra={(
				<Space size={4}>
					{row.upgradable && <Tag color="gold">{t("oj-market:card:upgradable")}</Tag>}
					{!installed && <Tag>{t("oj-market:card:notInstalled")}</Tag>}
					{enabled && <Tag color="green">{t("oj-market:card:enabled")}</Tag>}
					{disabled && <Tag color="default">{t("oj-market:card:disabled")}</Tag>}
				</Space>
			)}
		>
			{/* 卡片正文：点击整块打开详情抽屉（详情按钮已移除）。动作区是兄弟节点，点按钮不会冒泡到此处 */}
			<div
				data-testid={`card-body-${row.name}`}
				onClick={() => onDetails(row)}
				title={t("oj-market:card:details")}
				style={{ flex: 1, cursor: "pointer" }}
			>
				{/* 方案「提供什么」：summary 单行、description 限 3 行；title 与详情抽屉给全文 */}
				{typeof row.summary === "string" && row.summary.trim() !== "" && (
					<div
						data-testid={`card-summary-${row.name}`}
						title={row.summary}
						style={{ marginBottom: 8, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
					>
						{row.summary}
					</div>
				)}
				{typeof row.description === "string" && row.description.trim() !== "" && (
					<div
						data-testid={`card-description-${row.name}`}
						title={row.description}
						style={{
							marginBottom: 12,
							color: "var(--oo-text-secondary, #888)",
							fontSize: 12,
							lineHeight: 1.6,
							display: "-webkit-box",
							WebkitLineClamp: 3,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
							whiteSpace: "pre-wrap",
						}}
					>
						{row.description}
					</div>
				)}
				<div style={{ minHeight: 40, color: "var(--oo-text-secondary, #888)", marginBottom: 12 }} data-testid={`card-versions-${row.name}`}>
					{dualVersion
						? (
							<span>
								{t("oj-market:card:installed")}
								{" "}
								{row.installed}
								{" "}
								→
								{" "}
								{t("oj-market:card:latest")}
								{" "}
								{row.latest}
							</span>
						)
						: installed
							? (
								<span>
									{t("oj-market:card:version")}
									:
									{row.installed}
								</span>
							)
							: (
								<span>
									{t("oj-market:card:version")}
									:
									{row.latest ?? "-"}
								</span>
							)}
				</div>
				{/* 许可（P-2）：索引未声明就不占位，避免满屏「未知」 */}
				{typeof row.license === "string" && row.license !== "" && (
					<div style={{ marginBottom: 12 }} data-testid={`card-license-${row.name}`}>
						<Tag color="blue">
							{t("oj-market:card:license")}
							:
							{row.license}
						</Tag>
					</div>
				)}
				{/* 发布者：展示签出的 key_id（离线可验的发布身份）；无签名就不占位 */}
				{typeof row.publisher_key === "string" && row.publisher_key.trim() !== "" && (
					<div
						data-testid={`card-publisher-${row.name}`}
						title={row.publisher_key}
						style={{ marginBottom: 12, color: "var(--oo-text-secondary, #888)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
					>
						{t("oj-market:card:publisher")}
						:
						{row.publisher_key}
					</div>
				)}
			</div>
			{/* 动作区：不换行（需求钉死）。卡片宽度恢复 340px，详情按钮移除后 5 枚 small 按钮
			    常态一行，故不设 overflowX——避免横向滚动条；整行钉卡片底部，网格同行底边对齐 */}
			<div
				data-testid={`card-actions-${row.name}`}
				style={{ display: "flex", flexWrap: "nowrap", gap: 8, marginTop: "auto", paddingTop: 4 }}
			>
				<Button
					style={{ flexShrink: 0 }}
					type="primary"
					size="small"
					loading={busy}
					onClick={() => onInstall(row)}
					disabled={busy || !canManage || upgradeBlocked}
					title={manageTip ?? (upgradeBlocked ? t("oj-market:card:latestInstalled") : undefined)}
				>
					{installed ? t("oj-market:card:upgrade") : t("oj-market:card:install")}
				</Button>
				{installed && (enabled && !isFirstPartyMarket
					? (
						<Popconfirm
							title={t("oj-market:card:disableConfirmTitle", { name: row.name })}
							description={t("oj-market:card:disableConfirmBody")}
							okText={t("oj-market:card:disableConfirmOk")}
							cancelText={t("oj-market:card:disableConfirmCancel")}
							onConfirm={() => onEnableToggle(row)}
							disabled={busy || !canManage}
						>
							{toggleButton}
						</Popconfirm>
					)
					: toggleButton)}
				{installed && (
					<Button style={{ flexShrink: 0 }} size="small" onClick={() => onRollback(row)} disabled={busy || !canManage} title={manageTip} data-testid={`card-rollback-${row.name}`}>
						{t("oj-market:card:rollback")}
					</Button>
				)}
				{installed && (
					<Button style={{ flexShrink: 0 }} size="small" danger onClick={() => onUninstall(row)} disabled={busy || !canManage} title={manageTip}>
						{t("oj-market:card:uninstall")}
					</Button>
				)}
				<Button style={{ flexShrink: 0 }} size="small" onClick={() => onHistory(row)}>
					{t("oj-market:card:history")}
				</Button>
			</div>
		</Card>
	);
}
