import { request, useUserStore } from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Descriptions, Popconfirm, QRCode, Space, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { explainError } from "../errors";
import { ForbiddenPanel } from "../forbidden";

/** GET /auth/wecom/admin/apps 的行（后端不返回 permanent_code，secret 不出库） */
interface AppRow {
	suite_id: string
	corp_id: string
	agent_id: string
	auth_corp_id: string
	env: string
	corp_name: string | null
	status: "active" | "disabled"
	installed_at: number
	update_time: number
}

interface InstallInfo {
	installUrl: string
	callbackUrl: string
	expiresIn: number
}

/**
 * 端点不在本模块的生成 client 里（`__client` 按模块切分），故直接用 runtime 的 ky 出口。
 * 路径不带前导 `/`：与 request 的 baseURL 拼接口径一致（fetchLogin 同款）。
 */
async function fetchApps(): Promise<AppRow[]> {
	const env = await request.get("auth/wecom/admin/apps").json<{ code: number, data?: AppRow[] }>();
	return env.data ?? [];
}

async function setStatus(input: { corpId: string, agentId: string, status: "active" | "disabled" }): Promise<{ updated: number, revokedSessions: number }> {
	const env = await request.post("auth/wecom/admin/status", { json: input }).json<{ code: number, data?: { updated: number, revokedSessions: number } }>();
	return env.data ?? { updated: 0, revokedSessions: 0 };
}

async function createInstall(): Promise<InstallInfo> {
	const env = await request.get("auth/wecom/admin/install").json<{ code: number, data?: InstallInfo }>();
	if (!env.data)
		throw new Error("企业微信未返回开通链接");
	return env.data;
}

/**
 * 企微代开发后台（服务商运营面，superadmin 独占）：
 *   · 已授权企业 × 应用清单（同一企业测试/正式两个应用各一行）；
 *   · 启停（停用企业最后一个应用时后端同时吊销该企业会话）；
 *   · 开通入口（预授权码 10 分钟有效，每次点都重新换）。
 */
export default function WecomAdminPage() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const roles = useUserStore(s => s.roles);
	const isSuper = roles.includes("superadmin");

	const [install, setInstall] = useState<InstallInfo | null>(null);
	const [expired, setExpired] = useState(false);

	// 预授权码只有 10 分钟：到点把码置灰（antd QRCode 的 expired 态自带「刷新」入口），
	// 免得操作员把一张已失效的码发出去、企业管理员点开只看到企微的「链接无效」。
	// 计时器只负责「置灰」，复位放在生成成功那一刻（effect 里同步 setState 会多一次渲染）。
	useEffect(() => {
		if (!install)
			return undefined;
		const timer = setTimeout(setExpired, install.expiresIn * 1000, true);
		return () => clearTimeout(timer);
	}, [install]);

	const appsQuery = useQuery({
		queryKey: ["system", "wecom-apps"],
		queryFn: fetchApps,
		enabled: isSuper,
		retry: false,
	});

	const statusMut = useMutation({
		mutationFn: setStatus,
		onSuccess: (r) => {
			// 吊销了会话就明确说出来：这是「有人被踢下线」的事实，不该只显示「已保存」
			message.success(r.revokedSessions > 0
				? t("system:wecom.statusOkRevoked", { count: r.revokedSessions })
				: t("system:wecom.statusOk"));
			queryClient.invalidateQueries({ queryKey: ["system", "wecom-apps"] });
		},
		onError: e => message.error(explainError(e, t)),
	});

	const installMut = useMutation({
		mutationFn: createInstall,
		onSuccess: (r) => {
			setInstall(r);
			setExpired(false);
			// 预授权码一次有效：链接只在该页面的内存里，不写 localStorage
			message.success(t("system:wecom.installOk"));
		},
		onError: e => message.error(explainError(e, t)),
	});

	if (!isSuper)
		return <ForbiddenPanel t={t} />;

	const columns = [
		{
			title: t("system:wecom.col.corp"),
			dataIndex: "corp_id",
			render: (_: string, row: AppRow) => (
				<div>
					<div>{row.corp_id}</div>
					{row.corp_name && <Typography.Text type="secondary">{row.corp_name}</Typography.Text>}
				</div>
			),
		},
		{ title: t("system:wecom.col.agent"), dataIndex: "agent_id" },
		{ title: t("system:wecom.col.env"), dataIndex: "env", render: (v: string) => <Tag>{v}</Tag> },
		{
			title: t("system:wecom.col.status"),
			dataIndex: "status",
			render: (v: string) => (
				<Tag color={v === "active" ? "green" : "red"}>
					{t(v === "active" ? "system:wecom.statusActive" : "system:wecom.statusDisabled")}
				</Tag>
			),
		},
		{
			title: t("system:wecom.col.installedAt"),
			dataIndex: "installed_at",
			render: (v: number) => (v ? new Date(v * 1000).toLocaleString() : "-"),
		},
		{
			title: t("system:wecom.col.action"),
			key: "action",
			render: (_: unknown, row: AppRow) => {
				const next = row.status === "active" ? "disabled" : "active";
				return (
					<Popconfirm
						title={t(next === "disabled" ? "system:wecom.disableConfirm" : "system:wecom.enableConfirm")}
						onConfirm={() => statusMut.mutate({ corpId: row.corp_id, agentId: row.agent_id, status: next })}
					>
						<Button danger={next === "disabled"} size="small" loading={statusMut.isPending}>
							{t(next === "disabled" ? "system:wecom.disable" : "system:wecom.enable")}
						</Button>
					</Popconfirm>
				);
			},
		},
	];

	return (
		<Space direction="vertical" size="middle" style={{ width: "100%" }}>
			<Card
				title={t("system:wecom.title")}
				extra={(
					<Button type="primary" loading={installMut.isPending} onClick={() => installMut.mutate()}>
						{t("system:wecom.genInstall")}
					</Button>
				)}
			>
				<Typography.Paragraph type="secondary">{t("system:wecom.hint")}</Typography.Paragraph>
				{install && (
					<div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
						{/* 二维码用 antd 内置 QRCode（同一份共享 antd，不额外引二维码依赖）：
						    企业管理员多半在手机上收通知，扫码比复制链接快 */}
						<QRCode
							value={install.installUrl}
							size={160}
							type="svg"
							bordered
							status={expired ? "expired" : "active"}
							onRefresh={() => installMut.mutate()}
						/>
						<Descriptions column={1} size="small" bordered style={{ flex: 1, minWidth: 320 }}>
							<Descriptions.Item label={t("system:wecom.installUrl")}>
								<Typography.Text copyable={{ text: install.installUrl }}>{install.installUrl}</Typography.Text>
							</Descriptions.Item>
							<Descriptions.Item label={t("system:wecom.callbackUrl")}>
								<Typography.Text copyable={{ text: install.callbackUrl }}>{install.callbackUrl}</Typography.Text>
							</Descriptions.Item>
							<Descriptions.Item label={t("system:wecom.expiresIn")}>
								{t("system:wecom.expiresValue", { count: Math.round(install.expiresIn / 60) })}
							</Descriptions.Item>
						</Descriptions>
					</div>
				)}
			</Card>
			<Card title={t("system:wecom.appsTitle")}>
				<Table<AppRow>
					rowKey={row => `${row.suite_id}:${row.corp_id}:${row.agent_id}`}
					size="small"
					loading={appsQuery.isLoading}
					dataSource={appsQuery.data ?? []}
					columns={columns}
					pagination={false}
					locale={{ emptyText: t("system:wecom.empty") }}
				/>
			</Card>
		</Space>
	);
}
