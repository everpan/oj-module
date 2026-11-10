import type { McpCatalogGroup, McpCatalogResult, McpToolView } from "../../../../../oj-market/web/types";
import { ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Collapse, Space, Spin, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useMarketClient } from "../../../../../oj-market/web/api/context";

// MCP 服务管理页（20261110-1027 §4.3，T7）：只读展示本站已装方案的 mcp 工具目录。
// 数据源 = useMarketClient().mcpCatalog()（四态归一 + 人话 message，§4.1）+ 既有 index
// （漂移对账：已装方案无工具分组 → 提示）。异常态文案区分由服务端 message 承载，
// 页面如实展示不二次加工；工具描述纯文本渲染（§4.3 红线：禁 HTML/markdown 渲染）。

/** 组头静态统计（US-5 v1 静态半：目录推导恒可用） */
interface GroupStats {
	total: number
	readOnly: number
	write: number
	destructive: number
}

function statsOf(tools: McpToolView[]): GroupStats {
	return {
		total: tools.length,
		readOnly: tools.filter(x => x.readOnly).length,
		write: tools.filter(x => !x.readOnly).length,
		destructive: tools.filter(x => x.destructive).length,
	};
}

/** 组分类：方案组正常铺开；非方案组（不在已装列表/空串）折叠 +「非方案」标 */
function isForeignGroup(module: string, installedNames: Set<string>): boolean {
	return module === "" || !installedNames.has(module);
}

/** API 挂载前缀（与运行时 request 同源）：{base}/mcp 的 {base} = 挂载前缀，非站点根 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

/** 接入配置文本（剪贴板负载）：URL+请求头说明+主流 client 实配+线路 A 模板；不含任何凭据值 */
function buildAccessConfig(origin: string, tenant: string | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
	const url = `${origin}${API_BASE}/mcp`;
	// F10 修正：外层 tenant 中间件缺 X-TENANT-ID 即 400——外部 MCP client 请求头必须写全
	const headers: Record<string, string> = { Authorization: "Bearer <在浏览器粘贴你的登录 JWT>" };
	if (tenant !== undefined && tenant !== "") {
		headers["X-TENANT-ID"] = tenant;
	}
	const json = JSON.stringify({ mcpServers: { oj: { url, headers } } }, null, 2);
	return [
		`${t("system:mcp.accessTitle")}（${t("system:mcp.copyNote")}）`,
		"",
		`${t("system:mcp.accessUrl")}: ${url}`,
		t("system:mcp.tokenExp"),
		t("system:mcp.paramsShape"),
		t("system:mcp.reconnect"),
		"",
		"Claude Code / Cursor:",
		json,
		"",
		t("system:mcp.lineA"),
	].join("\n");
}

export function McpPage() {
	const { t } = useTranslation();
	const client = useMarketClient();
	const [copied, setCopied] = useState(false);

	const catalog = useQuery({ queryKey: ["mcp-catalog"], queryFn: () => client.mcpCatalog() });
	const index = useQuery({ queryKey: ["market-index"], queryFn: () => client.index({ size: 200 }) });

	// 漂移对账（§4.3）：已装方案（installed 非 null）但目录无同名分组 →「无可见工具」提示
	const installedNames = useMemo(
		() => new Set((index.data?.list ?? []).filter(r => r.installed != null).map(r => r.name)),
		[index.data],
	);
	const drift = useMemo(
		() => (index.data?.list ?? []).filter(r => r.installed != null && !catalog.data?.groups.some(g => g.module === r.name)),
		[index.data, catalog.data],
	);

	const refresh = () => {
		void catalog.refetch();
		void index.refetch();
	};

	const copyAccess = async () => {
		try {
			await navigator.clipboard.writeText(buildAccessConfig(window.location.origin, catalog.data?.tenant, t as (k: string, o?: Record<string, unknown>) => string));
			setCopied(true);
		}
		catch {
			// 剪贴板权限拒绝：静默（按钮态不变，管理员可手选文本）
		}
	};

	if (catalog.isPending) {
		return <Spin style={{ display: "block", margin: "80px auto" }} />;
	}
	if (catalog.isError) {
		return <Alert type="error" showIcon message={String(catalog.error)} />;
	}
	const data: McpCatalogResult = catalog.data;

	const statusColor = { mounted: "green", unmounted: "orange", auth: "red", unreachable: "red" } as const;
	const groups = data.groups;
	const foreign = groups.filter(g => isForeignGroup(g.module, installedNames));
	const solution = groups.filter(g => !isForeignGroup(g.module, installedNames));

	const toolColumns = [
		{ title: t("system:mcp.columns.name"), dataIndex: "name", key: "name" },
		{ title: t("system:mcp.columns.description"), dataIndex: "description", key: "description", render: (v?: string) => v ?? "" },
		{
			title: t("system:mcp.columns.quality"),
			key: "quality",
			render: (_: unknown, tool: McpToolView) => (
				<Space size={4} wrap>
					{tool.readOnly && <Tag color="blue">{t("system:mcp.tag.readOnly")}</Tag>}
					{tool.destructive && <Tag color="red">{t("system:mcp.tag.destructive")}</Tag>}
					{tool.description === undefined && <Tag>{t("system:mcp.tag.noDesc")}</Tag>}
					{tool.module === "" && <Tag>{t("system:mcp.tag.noContract")}</Tag>}
				</Space>
			),
		},
		{ title: t("system:mcp.columns.params"), dataIndex: "params", key: "params", render: (v: string[]) => v.length > 0 ? v.join(", ") : "—" },
		// v1 调用统计恒「—」（v2 随上游能力上线；文案不出现内部需求编号）
		{ title: t("system:mcp.columns.calls"), key: "calls", render: () => "—" },
	];

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<Card
				title={(
					<Space>
						<Tag color={statusColor[data.status]}>{t(`system:mcp.status.${data.status}`)}</Tag>
						{data.generation !== undefined && <Typography.Text type="secondary">{`${t("system:mcp.generation")} ${data.generation}`}</Typography.Text>}
					</Space>
				)}
				extra={<Button icon={<ReloadOutlined />} onClick={refresh}>{t("system:mcp.refresh")}</Button>}
			>
				<Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{t("system:mcp.descriptionSource")}</Typography.Paragraph>
				{data.message !== undefined && <Typography.Paragraph style={{ marginBottom: 8 }}>{data.message}</Typography.Paragraph>}
				{data.status !== "mounted" && <Typography.Paragraph type="warning" style={{ marginBottom: 0 }}>{t(`system:mcp.guide.${data.status}`)}</Typography.Paragraph>}
			</Card>

			{data.status === "mounted" && (
				<>
					<Alert type="info" showIcon message={t("system:mcp.mountedAlert")} />
					{drift.length > 0 && (
						<Card size="small" title={t("system:mcp.driftTitle")}>
							{drift.map(r => (
								<Typography.Paragraph key={r.name} style={{ marginBottom: 4 }}>
									<span>{r.name}</span>
									{" — "}
									<span>{t("system:mcp.group.drift")}</span>
								</Typography.Paragraph>
							))}
						</Card>
					)}
				</>
			)}

			{solution.map((g: McpCatalogGroup) => {
				const s = statsOf(g.tools);
				return (
					<Card
						size="small"
						key={g.module}
						title={(
							<span className="mcp-group-head">
								<span>{g.module}</span>
								{" · "}
								<span>{t("system:mcp.group.toolCount", { count: s.total })}</span>
								{" · "}
								<span>{t("system:mcp.group.readOnly", { count: s.readOnly })}</span>
								{" / "}
								<span>{t("system:mcp.group.write", { count: s.write })}</span>
								{" / "}
								<span>{t("system:mcp.group.destructive", { count: s.destructive })}</span>
							</span>
						)}
					>
						<Table rowKey="name" size="small" columns={toolColumns} dataSource={g.tools} pagination={false} />
					</Card>
				);
			})}

			{foreign.length > 0 && (
				<Collapse
					items={foreign.map(g => ({
						key: g.module || "_",
						label: (
							<Space>
								<span>{g.module === "" ? t("system:mcp.group.unattributed") : g.module}</span>
								<Tag>{t("system:mcp.group.foreign")}</Tag>
							</Space>
						),
						children: <Table rowKey="name" size="small" columns={toolColumns} dataSource={g.tools} pagination={false} />,
					}))}
				/>
			)}

			<Card size="small" title={t("system:mcp.accessTitle")} extra={<Button onClick={() => void copyAccess()}>{t("system:mcp.copy")}</Button>}>
				{copied && <Typography.Paragraph type="success" style={{ marginBottom: 8 }}>{t("system:mcp.copyOk")}</Typography.Paragraph>}
				<Typography.Paragraph style={{ marginBottom: 8 }}>
					{`${t("system:mcp.accessUrl")}: `}
					<span>{`${window.location.origin}${API_BASE}/mcp`}</span>
				</Typography.Paragraph>
				<Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{t("system:mcp.tokenExp")}</Typography.Paragraph>
				<Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{t("system:mcp.reconnect")}</Typography.Paragraph>
				<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{t("system:mcp.paramsShape")}</Typography.Paragraph>
				<Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>{t("system:mcp.lineA")}</Typography.Paragraph>
			</Card>
		</div>
	);
}

export default McpPage;
