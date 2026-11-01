import { request, useUserStore } from "@oj-module/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Input, Modal, Popconfirm, QRCode, Space, Table, Tag, Typography } from "antd";
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
	/** 应用来源：suite=代开发 / corp=企业内部应用（自建） */
	credential_kind: "suite" | "corp"
	/** 0=管理员授权 / 1=成员授权：成员授权下这家企业的应用做不了组织架构同步；自建行恒 0 */
	auth_mode: number
	installed_at: number
	update_time: number
}

interface InstallInfo {
	installUrl: string
	callbackUrl: string
	expiresIn: number
}

/** GET /auth/wecom/admin/overview：本部署配了哪几套凭据、回调地址填什么 */
interface Overview {
	kinds: Array<"suite" | "corp">
	configError: string | null
	callbackUrl: string | null
	corpId: string | null
	agentId: string | null
	corpCallbackConfigured: boolean
}

interface ConnectResult {
	corpId: string
	agentId: string
	departments: number
	members: number
}

/** GET /auth/wecom/admin/tenant-admin：某企业的租户管理员状态 */
interface TenantAdminState {
	corpId: string
	username: string
	/** 该租户是否已有一个握着 admin 角色的账号 */
	exists: boolean
	/** 是否须改密（开通后恒 true，直到本人改过一次） */
	mustChange: boolean
}

/**
 * 端点不在本模块的生成 client 里（`__client` 按模块切分），故直接用 runtime 的 ky 出口。
 * 路径不带前导 `/`：与 request 的 baseURL 拼接口径一致（fetchLogin 同款）。
 */
async function fetchApps(): Promise<AppRow[]> {
	const env = await request.get("auth/wecom/admin/apps").json<{ code: number, data?: AppRow[] }>();
	return env.data ?? [];
}

async function fetchOverview(): Promise<Overview> {
	const env = await request.get("auth/wecom/admin/overview").json<{ code: number, data?: Overview }>();
	return env.data ?? { kinds: [], configError: null, callbackUrl: null, corpId: null, agentId: null, corpCallbackConfigured: false };
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

async function connectCorp(): Promise<ConnectResult> {
	const env = await request.post("auth/wecom/admin/connect", { json: {} }).json<{ code: number, data?: ConnectResult }>();
	if (!env.data)
		throw new Error("企业微信未返回接入结果");
	return env.data;
}

async function fetchTenantAdmin(corpId: string): Promise<TenantAdminState> {
	const env = await request.get("auth/wecom/admin/tenant-admin", { searchParams: { corpId } }).json<{ code: number, data?: TenantAdminState }>();
	return env.data ?? { corpId, username: "admin", exists: false, mustChange: false };
}

/**
 * 重设租户管理员口令。
 *
 * 口令**不由系统生成**：让 superadmin 自己输入，他知道这个值 → 直接告知对方即可。
 * 后端只存 bcrypt，没有任何可逆副本，所以「系统生成后回显」这条路本来也走不通。
 */
async function resetTenantAdminPassword(input: { corpId: string, password: string }): Promise<TenantAdminState> {
	const env = await request.post("auth/wecom/admin/tenant-admin/password", { json: input }).json<{ code: number, data?: TenantAdminState }>();
	if (!env.data)
		throw new Error("企业微信未返回重设结果");
	return env.data;
}

/**
 * 企微后台（superadmin 独占），两块卡片按「本部署配了哪套凭据」决定显不显示：
 *   · 代开发：已授权企业 × 应用清单、启停、开通入口（点「生成开通链接」→ 后端调
 *     get_customized_auth_url 换 qrcode_url，企业管理员扫/开即授权，由 create_auth 回调落库）；
 *   · 企业内部应用（自建）：本企业的那一份凭据 + 回调地址 + 「验证并接入」。
 * 两套可以同时启用（`wecom_allow_coexist: 'true'`），此时两张卡片并列，清单里按「来源」区分。
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

	// 概览读的是**部署常量**而不是库：配置错的时候清单可能是空的，而这里必须还能说清「缺什么」
	const overviewQuery = useQuery({
		queryKey: ["system", "wecom-overview"],
		queryFn: fetchOverview,
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

	const connectMut = useMutation({
		mutationFn: connectCorp,
		onSuccess: (r) => {
			message.success(t("system:wecom.corp.connectOk", { depts: r.departments, members: r.members }));
			queryClient.invalidateQueries({ queryKey: ["system", "wecom-apps"] });
			queryClient.invalidateQueries({ queryKey: ["system", "wecom-overview"] });
		},
		onError: e => message.error(explainError(e, t)),
	});

	// 企业清单按 corp_id 去重：租户键就是 corp_id，同一企业的多个应用共用一个租户管理员
	const corps = [...new Map((appsQuery.data ?? []).map(r => [r.corp_id, { corpId: r.corp_id, name: r.corp_name }])).values()];

	// 租户管理员状态：一个企业一条查询并并发取（企业数量级很小，不值得为它加批量端点）
	const tenantAdminQuery = useQuery({
		queryKey: ["system", "wecom-tenant-admin", corps.map(c => c.corpId).join(",")],
		queryFn: async () => {
			const out: Record<string, TenantAdminState> = {};
			await Promise.all(corps.map(async c => {
				out[c.corpId] = await fetchTenantAdmin(c.corpId);
			}));
			return out;
		},
		enabled: isSuper && corps.length > 0,
		retry: false,
	});

	const [resetTarget, setResetTarget] = useState<{ corpId: string, name: string | null } | null>(null);
	const [resetPwd, setResetPwd] = useState("");

	const resetMut = useMutation({
		mutationFn: resetTenantAdminPassword,
		onSuccess: () => {
			message.success(t("system:wecom.tenantAdmin.resetOk"));
			setResetTarget(null);
			setResetPwd("");
			queryClient.invalidateQueries({ queryKey: ["system", "wecom-tenant-admin"] });
		},
		onError: e => message.error(explainError(e, t)),
	});

	const tenantAdminColumns = [
		{
			title: t("system:wecom.col.corp"),
			dataIndex: "corpId",
			render: (_: string, row: { corpId: string, name: string | null }) => (
				<div>
					<div>{row.corpId}</div>
					{row.name && <Typography.Text type="secondary">{row.name}</Typography.Text>}
				</div>
			),
		},
		{
			title: t("system:wecom.tenantAdmin.username"),
			dataIndex: "username",
			render: (_: unknown, row: { corpId: string }) => tenantAdminQuery.data?.[row.corpId]?.username ?? "-",
		},
		{
			title: t("system:wecom.tenantAdmin.state"),
			dataIndex: "exists",
			render: (_: unknown, row: { corpId: string }) => {
				const s = tenantAdminQuery.data?.[row.corpId];
				return s?.exists
					? <Tag color="green">{t("system:wecom.tenantAdmin.exists")}</Tag>
					: <Tag color="orange">{t("system:wecom.tenantAdmin.missing")}</Tag>;
			},
		},
		{
			title: t("system:wecom.tenantAdmin.action"),
			key: "action",
			render: (_: unknown, row: { corpId: string, name: string | null }) => (
				<Button size="small" onClick={() => { setResetTarget(row); setResetPwd(""); }}>
					{t("system:wecom.tenantAdmin.reset")}
				</Button>
			),
		},
	];

	if (!isSuper)
		return <ForbiddenPanel t={t} />;

	const overview = overviewQuery.data;
	const kinds = overview?.kinds ?? [];
	const hasSuite = kinds.includes("suite");
	const hasCorp = kinds.includes("corp");

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
		{
			// 来源列：共存部署里清单会同时出现两类行，不标出来就分不清「这行是谁装进来的」
			title: t("system:wecom.col.source"),
			dataIndex: "credential_kind",
			render: (v: AppRow["credential_kind"]) => (v === "corp"
				? <Tag color="blue">{t("system:wecom.source.corp")}</Tag>
				: <Tag>{t("system:wecom.source.suite")}</Tag>),
		},
		{ title: t("system:wecom.col.agent"), dataIndex: "agent_id" },
		{ title: t("system:wecom.col.env"), dataIndex: "env", render: (v: string) => <Tag>{v}</Tag> },
		{
			// 权限三态：成员授权是「装了也同步不了」的硬约束（企微侧通讯录接口一律 60011），
			// 摆在清单上，服务商不用点进去试一遍才知道。自建应用没有这个概念，显示空值。
			title: t("system:wecom.col.authMode"),
			dataIndex: "auth_mode",
			render: (v: number, row: AppRow) => (row.credential_kind === "corp"
				? <Typography.Text type="secondary">{t("system:wecom.authModeNone")}</Typography.Text>
				: v === 0
					? <Tag color="green">{t("system:wecom.authModeAdmin")}</Tag>
					: <Tag color="orange">{t("system:wecom.authModeMember")}</Tag>),
		},
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
			{overview?.configError && (
				<Alert
					type="error"
					showIcon
					message={t("system:wecom.configErrorTitle")}
					description={overview.configError}
				/>
			)}
			{hasSuite && hasCorp && (
				<Alert type="info" showIcon message={t("system:wecom.coexistHint")} />
			)}
			{hasSuite && (
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
			)}
			{hasCorp && (
				<Card
					title={t("system:wecom.corp.title")}
					extra={(
						<Popconfirm
							title={t("system:wecom.corp.connectConfirm")}
							onConfirm={() => connectMut.mutate()}
						>
							<Button type="primary" loading={connectMut.isPending}>
								{t("system:wecom.corp.connect")}
							</Button>
						</Popconfirm>
					)}
				>
					<Typography.Paragraph type="secondary">{t("system:wecom.corp.hint")}</Typography.Paragraph>
					<Descriptions column={1} size="small" bordered>
						<Descriptions.Item label={t("system:wecom.corp.corpId")}>
							<Typography.Text>{overview?.corpId ?? "-"}</Typography.Text>
						</Descriptions.Item>
						<Descriptions.Item label={t("system:wecom.corp.agentId")}>
							<Typography.Text>{overview?.agentId ?? "-"}</Typography.Text>
						</Descriptions.Item>
						<Descriptions.Item label={t("system:wecom.corp.callbackUrl")}>
							{overview?.callbackUrl
								? <Typography.Text copyable={{ text: overview.callbackUrl }}>{overview.callbackUrl}</Typography.Text>
								: "-"}
						</Descriptions.Item>
						<Descriptions.Item label={t("system:wecom.corp.callbackConfigured")}>
							{overview?.corpCallbackConfigured
								? <Tag color="green">{t("system:wecom.corp.callbackYes")}</Tag>
								: <Tag color="orange">{t("system:wecom.corp.callbackNo")}</Tag>}
						</Descriptions.Item>
					</Descriptions>
					<Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
						{t("system:wecom.corp.callbackHint")}
					</Typography.Paragraph>
					<Typography.Paragraph type="warning" style={{ marginBottom: 0 }}>
						{t("system:wecom.corp.connectHint")}
					</Typography.Paragraph>
				</Card>
			)}
			{corps.length > 0 && (
				<Card title={t("system:wecom.tenantAdmin.title")}>
					<Typography.Paragraph type="secondary">
						{t("system:wecom.tenantAdmin.hint")}
					</Typography.Paragraph>
					<Table
						rowKey={row => row.corpId}
						size="small"
						loading={tenantAdminQuery.isLoading}
						dataSource={corps}
						columns={tenantAdminColumns}
						pagination={false}
					/>
				</Card>
			)}
			<Modal
				open={resetTarget != null}
				title={t("system:wecom.tenantAdmin.resetTitle")}
				onCancel={() => { setResetTarget(null); setResetPwd(""); }}
				onOk={() => resetMut.mutate({ corpId: resetTarget!.corpId, password: resetPwd })}
				confirmLoading={resetMut.isPending}
				okButtonProps={{ disabled: resetPwd.length < 6 }}
				destroyOnHidden
			>
				<Typography.Paragraph type="secondary">
					{t("system:wecom.tenantAdmin.resetHint", { corpId: resetTarget?.corpId ?? "" })}
				</Typography.Paragraph>
				<Input.Password
					value={resetPwd}
					onChange={e => setResetPwd(e.target.value)}
					placeholder={t("system:wecom.tenantAdmin.resetPlaceholder")}
				/>
			</Modal>
			<Card title={t("system:wecom.appsTitle")}>
				<Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
					{t("system:wecom.authModeHint")}
				</Typography.Paragraph>
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
