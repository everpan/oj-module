import type { SystemServiceTokenGetData } from "../../__client";
import { CopyOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Card, Select, Space, Typography } from "antd";
import { useState } from "react";

import { useTranslation } from "react-i18next";
import { systemServiceTokenGet } from "../../__client";

const DAY = 86400;

/**
 * 普通模式插件配置生成器（方案 P4a / §5）：按当前租户出一份可直接粘进企微后台的 MCP 插件配置。
 * 路径 /api/wecom-bot/mcp 是反代路径（非 src/app/api 模板 API），租户由 Bearer 选、不含在 URL。
 * 该 URL 须落在该租户「企业域名」下，企微才会在 tools/call 注入 X-WeCom-User-Id（§11#6 核验门）。
 */
export function WeComPluginConfigPanel() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const [tokenJti, setTokenJti] = useState<string | undefined>(undefined);

	const list = useQuery({ queryKey: ["system", "bot", "svc-token"], queryFn: systemServiceTokenGet });
	const rows: SystemServiceTokenGetData = list.data ?? [];
	const selected = rows.find(r => r.jti === tokenJti);

	const origin = typeof window !== "undefined" ? window.location.origin : "https://<企业域名>";
	// 插件须挂在该租户的企业域名下；此处用当前站点 origin 占位，部署时替换为企微企业域名。
	const pluginUrl = `${origin}/api/wecom-bot/mcp`;
	const authValue = selected
		? "Bearer <已选凭据，复制时替换为明文>"
		: "Bearer <在此粘贴本租户签发的服务凭据>";

	const block
		= `插件类型:      MCP
传输协议:      Streamable HTTP
插件 URL:      ${pluginUrl}
授权方式:      Service token（Header）
Authorization: ${authValue}
Content-Type:  application/json
Accept:        application/json, text/event-stream`;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(block);
			message.success(t("system:bot.plugin.copied"));
		}
		catch {
			message.error(t("system:bot.plugin.copyFail"));
		}
	};

	const now = Math.floor(Date.now() / 1000);
	const daysLeft = selected && selected.expires_at > 0 ? Math.floor((selected.expires_at - now) / DAY) : undefined;

	return (
		<Space direction="vertical" style={{ width: "100%" }} size="middle">
			<Alert type="info" showIcon message={t("system:bot.plugin.tenantNote")} />

			<Card size="small" title={t("system:bot.plugin.pickerTitle")}>
				<Space direction="vertical" style={{ width: "100%" }} size="small">
					<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{t("system:bot.plugin.pickerHint")}</Typography.Paragraph>
					<Select
						style={{ width: "100%" }}
						placeholder={t("system:bot.plugin.pickerPh")}
						value={tokenJti}
						onChange={setTokenJti}
						loading={list.isLoading}
						options={rows.map(r => ({ value: r.jti, label: `${r.name} (${r.jti})` }))}
						notFoundContent={t("system:bot.token.empty")}
					/>
					{selected && (
						<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
							{t("system:bot.plugin.selectedMeta", {
								scopes: selected.scopes.join(", ") || "—",
								days: daysLeft === undefined ? "—" : daysLeft < 0 ? t("system:bot.token.expired", { d: -daysLeft }) : t("system:bot.token.daysLeftShort", { d: daysLeft }),
							})}
						</Typography.Paragraph>
					)}
					{selected && !selected.scopes.includes("write") && (
						<Alert type="warning" showIcon message={t("system:bot.plugin.writeScopeWarn")} />
					)}
				</Space>
			</Card>

			<Card
				size="small"
				title={t("system:bot.plugin.configTitle")}
				extra={<Button size="small" icon={<CopyOutlined />} onClick={() => void copy()}>{t("system:bot.common.copy")}</Button>}
			>
				<Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{t("system:bot.plugin.configHint")}</Typography.Paragraph>
				<pre style={{ background: "rgba(0,0,0,0.04)", padding: 12, borderRadius: 6, overflowX: "auto", margin: 0, whiteSpace: "pre-wrap" }}>{block}</pre>
				<Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
					{t("system:bot.plugin.headerNote")}
				</Typography.Paragraph>
			</Card>
		</Space>
	);
}
