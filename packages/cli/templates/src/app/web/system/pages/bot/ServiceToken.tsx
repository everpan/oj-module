import type { SystemServiceTokenGetData, SystemServiceTokenPostData } from "../../__client";

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { systemServiceTokenDelete, systemServiceTokenGet, systemServiceTokenPost } from "../../__client";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

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

/** 服务凭据面板：签发（明文只显示一次）/ 列表 / 吊销。全部端点后端为 assertSuperAdmin。 */
export function ServiceTokenPanel() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const [issueOpen, setIssueOpen] = useState(false);
	const [form] = Form.useForm<{ name: string, scopes: Scope[] }>();
	const [issued, setIssued] = useState<SystemServiceTokenPostData | null>(null);

	const list = useQuery({ queryKey: ["system", "bot", "svc-token"], queryFn: systemServiceTokenGet });
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["system", "bot", "svc-token"] });

	const issueMut = useMutation({
		mutationFn: (body: { name: string, scopes: Scope[] }) => systemServiceTokenPost(body),
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

	if (list.error && isForbidden(list.error))
		return <ForbiddenPanel t={t} error={list.error} />;

	const rows: SystemServiceTokenGetData = list.data ?? [];
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
		{ title: t("system:bot.token.columns.createdBy"), dataIndex: "created_by" },
		{ title: t("system:bot.token.columns.createdAt"), dataIndex: "created_at", render: (v: number) => dayjs.unix(v).format("YYYY-MM-DD HH:mm:ss") },
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
			</Space>
			<Table
				rowKey="jti"
				size="small"
				loading={list.isLoading}
				dataSource={rows}
				columns={columns}
				pagination={false}
				locale={{ emptyText: t("system:bot.token.empty") }}
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
				<Form form={form} layout="vertical" onFinish={values => issueMut.mutate({ name: values.name, scopes: values.scopes?.length ? values.scopes : ["read"] })}>
					<Form.Item name="name" label={t("system:bot.token.name")} rules={[{ required: true, message: t("system:bot.token.namePh") }]}>
						<Input placeholder={t("system:bot.token.namePh")} />
					</Form.Item>
					<Form.Item name="scopes" label={t("system:bot.token.scopes")} initialValue={["read"]}>
						<Select mode="multiple" options={SCOPES.map(s => ({ value: s, label: scopeLabel(s, t) }))} />
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
