import type { SystemServiceTokenGetData, SystemServiceTokenPostData } from "../../__client";

import { DownloadOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { systemServiceTokenDelete, systemServiceTokenGet, systemServiceTokenPost } from "../../__client";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";
import { downloadCsv, toCsv } from "./csv";

/** 距到期 ≤ 该天数视为「待轮换」（K6：N 凭据 × 90d 人工台账必漏，看板/批量导出必修）。 */
const ROTATION_DUE_DAYS = 30;
const DAY = 86400;

const SCOPES = ["read", "write", "destructive"] as const;
type Scope = typeof SCOPES[number];

/** 档位 Tag 文案走静态 key（动态拼接会被 i18n 守卫当字面量收走）。 */
function scopeLabel(scope: string, t: (k: string) => string): string {
	if (scope === "read")
		return t("system:bot.token.scope.read");
	if (scope === "write")
		return t("system:bot.token.scope.write");
	return t("system:bot.token.scope.destructive");
}

/** 服务凭据面板：签发（明文只显示一次）/ 列表 / 吊销。全部端点后端为 assertSystemAdmin（每租户 admin 自助签发，Q-I）。 */
export function ServiceTokenPanel() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const [issueOpen, setIssueOpen] = useState(false);
	const [form] = Form.useForm<{ name: string, scopes: Scope[], ttl_days?: number }>();
	const [issued, setIssued] = useState<SystemServiceTokenPostData | null>(null);
	const [dueOnly, setDueOnly] = useState(false);

	const list = useQuery({ queryKey: ["system", "bot", "svc-token"], queryFn: systemServiceTokenGet });
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["system", "bot", "svc-token"] });

	const issueMut = useMutation({
		mutationFn: (body: { name: string, scopes: Scope[], ttl_days?: number }) => systemServiceTokenPost(body),
		onSuccess: (data) => {
			message.success(t("system:bot.token.issueOk", { jti: data.jti }));
			setIssueOpen(false);
			form.resetFields();
			setIssued(data); // 明文只此一次，关掉后不再回显
			invalidate();
		},
		onError: e => message.error(explainError(e, t)),
	});

	const revokeMut = useMutation({
		mutationFn: (jti: string) => systemServiceTokenDelete({ jti }),
		onSuccess: () => {
			message.success(t("system:bot.token.revoked"));
			invalidate();
		},
		onError: e => message.error(explainError(e, t)),
	});

	const rows: SystemServiceTokenGetData = list.data ?? [];
	const now = dayjs().unix();
	const daysLeftOf = (r: SystemServiceTokenGetData[number]) => Math.floor((r.expires_at - now) / DAY);
	const dueRows = rows.filter(r => r.expires_at - now <= ROTATION_DUE_DAYS * DAY);
	const shownRows = dueOnly ? dueRows : rows;

	/** 批量导出待轮换凭据（K6：N 凭据 × 90d 人工台账必漏 → 看板/导出必修）。 */
	const exportDue = () => {
		const header = ["jti", "name", "scopes", "created_at", "expires_at", "days_left"] as const;
		const csv = toCsv(header, dueRows.map(r => [
			r.jti,
			r.name,
			r.scopes.join("|"),
			r.created_at,
			r.expires_at,
			daysLeftOf(r),
		]));
		downloadCsv(`svc-token-rotation-${dayjs().format("YYYYMMDD")}.csv`, csv);
		message.success(t("system:bot.token.exportDueOk", { n: dueRows.length }));
	};

	if (list.error && isForbidden(list.error))
		return <ForbiddenPanel t={t} error={list.error} />;

	const columns = [
		{ title: t("system:bot.token.columns.name"), dataIndex: "name" },
		{
			title: t("system:bot.token.columns.jti"),
			dataIndex: "jti",
			render: (v: string) => <Typography.Text code copyable>{v}</Typography.Text>,
		},
		{
			title: t("system:bot.token.columns.scopes"),
			dataIndex: "scopes",
			render: (v: string[]) => (
				<Space size={4} wrap>
					{v.map(s => <Tag key={s} color={s === "destructive" ? "red" : s === "write" ? "orange" : "blue"}>{scopeLabel(s, t)}</Tag>)}
				</Space>
			),
		},
		{
			title: t("system:bot.token.columns.status"),
			dataIndex: "status",
			render: (v: string) => <Tag color={v === "superseded" ? "orange" : "green"}>{v}</Tag>,
		},
		{ title: t("system:bot.token.columns.createdBy"), dataIndex: "created_by" },
		{ title: t("system:bot.token.columns.createdAt"), dataIndex: "created_at", render: (v: number) => dayjs.unix(v).format("YYYY-MM-DD HH:mm:ss") },
		{
			title: t("system:bot.token.columns.expiresAt"),
			dataIndex: "expires_at",
			render: (v: number) => (v > 0 ? dayjs.unix(v).format("YYYY-MM-DD HH:mm:ss") : "—"),
		},
		{
			title: t("system:bot.token.columns.daysLeft"),
			key: "daysLeft",
			render: (_: unknown, r: SystemServiceTokenGetData[number]) => {
				if (r.expires_at <= 0)
					return <Typography.Text type="secondary">—</Typography.Text>;
				const d = daysLeftOf(r);
				if (d < 0)
					return <Tag color="red">{t("system:bot.token.expired", { d: -d })}</Tag>;
				if (d <= 15)
					return <Tag color="red">{t("system:bot.token.daysLeftShort", { d })}</Tag>;
				if (d <= ROTATION_DUE_DAYS)
					return <Tag color="orange">{t("system:bot.token.daysLeftShort", { d })}</Tag>;
				return <Typography.Text type="secondary">{t("system:bot.token.daysLeftLong", { d })}</Typography.Text>;
			},
		},
		{
			title: t("system:bot.token.columns.actions"),
			key: "actions",
			render: (_: unknown, r: SystemServiceTokenGetData[number]) => (
				<Popconfirm
					title={t("system:bot.token.revokeConfirm")}
					onConfirm={() => revokeMut.mutate(r.jti)}
					okText={t("system:common.confirm")}
					cancelText={t("system:common.cancel")}
				>
					<Button size="small" danger loading={revokeMut.isPending}>{t("system:bot.token.revoke")}</Button>
				</Popconfirm>
			),
		},
	];

	return (
		<Space direction="vertical" style={{ width: "100%" }} size="middle">
			<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{t("system:bot.token.hint")}</Typography.Paragraph>
			<Space wrap>
				<Button type="primary" icon={<PlusOutlined />} onClick={() => setIssueOpen(true)}>{t("system:bot.token.issue")}</Button>
				<Button icon={<ReloadOutlined />} onClick={() => void list.refetch()}>{t("system:bot.common.refresh")}</Button>
				<Button icon={<DownloadOutlined />} disabled={dueRows.length === 0} onClick={exportDue}>{t("system:bot.token.exportDue", { n: dueRows.length })}</Button>
				<Segmented
					value={dueOnly ? "due" : "all"}
					onChange={v => setDueOnly(v === "due")}
					options={[
						{ label: t("system:bot.token.filterAll", { n: rows.length }), value: "all" },
						{ label: t("system:bot.token.filterDue", { n: dueRows.length }), value: "due" },
					]}
				/>
			</Space>
			<Table
				rowKey="jti"
				size="small"
				loading={list.isLoading}
				dataSource={shownRows}
				columns={columns}
				pagination={false}
				locale={{ emptyText: t(dueOnly ? "system:bot.token.emptyDue" : "system:bot.token.empty") }}
			/>

			<Modal
				title={t("system:bot.token.issue")}
				open={issueOpen}
				onCancel={() => setIssueOpen(false)}
				onOk={() => form.submit()}
				okText={t("system:common.save")}
				cancelText={t("system:common.cancel")}
				confirmLoading={issueMut.isPending}
			>
				<Form form={form} layout="vertical" onFinish={values => issueMut.mutate({ name: values.name, scopes: values.scopes?.length ? values.scopes : ["read"], ttl_days: values.ttl_days != null ? Number(values.ttl_days) : undefined })}>
					<Form.Item name="name" label={t("system:bot.token.name")} rules={[{ required: true, message: t("system:bot.token.namePh") }]}>
						<Input placeholder={t("system:bot.token.namePh")} />
					</Form.Item>
					<Form.Item name="scopes" label={t("system:bot.token.scopes")} initialValue={["read"]}>
						<Select mode="multiple" options={SCOPES.map(s => ({ value: s, label: scopeLabel(s, t) }))} />
					</Form.Item>
					<Form.Item name="ttl_days" label={t("system:bot.token.ttlDays")} initialValue={0} tooltip={t("system:bot.token.ttlDaysHint")}>
						<InputNumber min={0} max={90} step={1} style={{ width: "100%" }} placeholder={t("system:bot.token.ttlDaysPh")} />
					</Form.Item>
					<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{t("system:bot.token.scopeHint")}</Typography.Paragraph>
				</Form>
			</Modal>

			<Modal
				title={t("system:bot.token.onceTitle")}
				open={issued !== null}
				onCancel={() => setIssued(null)}
				onOk={() => setIssued(null)}
				okText={t("system:bot.common.close")}
				cancelButtonProps={{ style: { display: "none" } }}
				width={640}
			>
				<Typography.Paragraph type="warning">{t("system:bot.token.onceHint")}</Typography.Paragraph>
				<Typography.Paragraph>{t("system:bot.token.tokenLabel")}</Typography.Paragraph>
				<Typography.Paragraph copyable={{ text: issued?.token ?? "" }} style={{ wordBreak: "break-all" }}>{issued?.token ?? ""}</Typography.Paragraph>
			</Modal>
		</Space>
	);
}
