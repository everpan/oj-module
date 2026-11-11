import type { ChangeEvent } from "react";

import type { SystemBotBindingGetData } from "../../__client";
import { DownloadOutlined, EditOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Popconfirm, Space, Table, Typography } from "antd";
import dayjs from "dayjs";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	systemBotBindingDelete,
	systemBotBindingGet,
	systemBotBindingImportPost,
	systemBotBindingPost,
} from "../../__client";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";
import { downloadCsv, toCsv } from "./csv";

type BindingRow = SystemBotBindingGetData[number];

/** 导入/导出列序与后端 BINDING_COLS 逐字一致（表头可被 importBindings 直接回导）。 */
const HEADER = ["provider", "external_sub", "user_id"] as const;

/**
 * 员工绑定面板：建立「IM 渠道账号 ↔ 站点用户」映射，供 obo 换签查表。
 * 端点全部为 assertSuperAdmin；CSV 走前端本地拼装（导出端点为 text/csv 裸流，生成 client
 * 按信封 .json() 解析会失败，详见 csv.ts 说明）。
 */
export function BotBindingPanel() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<BindingRow | null>(null);
	const [form] = Form.useForm<{ provider: string, external_sub: string, user_id: string }>();
	const fileRef = useRef<HTMLInputElement>(null);

	const list = useQuery({ queryKey: ["system", "bot", "binding"], queryFn: systemBotBindingGet });
	const invalidate = () => queryClient.invalidateQueries({ queryKey: ["system", "bot", "binding"] });

	const saveMut = useMutation({
		mutationFn: (body: { provider: string, external_sub: string, user_id: string }) => systemBotBindingPost(body),
		onSuccess: (data) => {
			message.success(t("system:bot.binding.saved", { op: data.op === "insert" ? t("system:common.create") : t("system:common.edit") }));
			setModalOpen(false);
			form.resetFields();
			invalidate();
		},
		onError: e => message.error(explainError(e, t)),
	});

	const deleteMut = useMutation({
		mutationFn: (row: BindingRow) => systemBotBindingDelete({ provider: row.provider, external_sub: row.external_sub }),
		onSuccess: () => {
			message.success(t("system:bot.binding.deleted"));
			invalidate();
		},
		onError: e => message.error(explainError(e, t)),
	});

	const importMut = useMutation({
		mutationFn: (csv: string) => systemBotBindingImportPost({ csv }),
		onSuccess: (data) => {
			message.success(t("system:bot.binding.importOk", { imported: data.imported, skipped: data.skipped.length, total: data.total }));
			if (data.skipped.length)
				message.warning(t("system:bot.binding.importSkipped", { lines: data.skipped.join("; ") }));
			invalidate();
		},
		onError: e => message.error(explainError(e, t)),
	});

	if (list.error && isForbidden(list.error))
		return <ForbiddenPanel t={t} error={list.error} />;

	const openAdd = () => {
		setEditing(null);
		form.resetFields();
		setModalOpen(true);
	};
	const openEdit = (row: BindingRow) => {
		setEditing(row);
		form.setFieldsValue({ provider: row.provider, external_sub: row.external_sub, user_id: row.user_id });
		setModalOpen(true);
	};
	const exportCsv = () => {
		const rows: BindingRow[] = list.data ?? [];
		downloadCsv("bot-binding.csv", toCsv(HEADER, rows.map(r => [r.provider, r.external_sub, r.user_id])));
		message.success(t("system:bot.binding.exportOk", { count: rows.length }));
	};
	const onFile = (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file)
			void file.text().then(csv => importMut.mutate(csv));
		e.target.value = ""; // 允许连续选同一文件
	};

	const columns = [
		{ title: t("system:bot.binding.columns.provider"), dataIndex: "provider" },
		{ title: t("system:bot.binding.columns.externalSub"), dataIndex: "external_sub" },
		{ title: t("system:bot.binding.columns.userId"), dataIndex: "user_id" },
		{ title: t("system:bot.binding.columns.lastUsedAt"), dataIndex: "last_used_at", render: (v: number) => v ? dayjs.unix(v).format("YYYY-MM-DD HH:mm:ss") : "—" },
		{ title: t("system:bot.binding.columns.createdBy"), dataIndex: "created_by" },
		{ title: t("system:bot.binding.columns.createdAt"), dataIndex: "created_at", render: (v: number) => dayjs.unix(v).format("YYYY-MM-DD HH:mm:ss") },
		{
			title: t("system:bot.binding.columns.actions"),
			key: "actions",
			render: (_: unknown, r: BindingRow) => (
				<Space size={4}>
					<Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>{t("system:common.edit")}</Button>
					<Popconfirm
						title={t("system:bot.binding.deleteConfirm")}
						onConfirm={() => deleteMut.mutate(r)}
						okText={t("system:common.confirm")}
						cancelText={t("system:common.cancel")}
					>
						<Button size="small" danger>{t("system:bot.binding.delete")}</Button>
					</Popconfirm>
				</Space>
			),
		},
	];

	return (
		<Space direction="vertical" style={{ width: "100%" }} size="middle">
			<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{t("system:bot.binding.hint")}</Typography.Paragraph>
			<Space wrap>
				<Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>{t("system:bot.binding.add")}</Button>
				<input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={onFile} />
				<Button icon={<UploadOutlined />} loading={importMut.isPending} onClick={() => fileRef.current?.click()}>{t("system:bot.common.import")}</Button>
				<Button icon={<DownloadOutlined />} onClick={exportCsv}>{t("system:bot.common.export")}</Button>
				<Button icon={<ReloadOutlined />} onClick={() => void list.refetch()}>{t("system:bot.common.refresh")}</Button>
			</Space>
			<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{t("system:bot.binding.importHint")}</Typography.Paragraph>
			<Table
				rowKey={(r: BindingRow) => `${r.provider}:${r.external_sub}`}
				size="small"
				loading={list.isLoading}
				dataSource={list.data ?? []}
				columns={columns}
				pagination={false}
				locale={{ emptyText: t("system:bot.binding.empty") }}
			/>

			<Modal
				title={editing ? t("system:bot.binding.edit") : t("system:bot.binding.add")}
				open={modalOpen}
				onCancel={() => setModalOpen(false)}
				onOk={() => form.submit()}
				okText={t("system:common.save")}
				cancelText={t("system:common.cancel")}
				confirmLoading={saveMut.isPending}
			>
				<Form form={form} layout="vertical" onFinish={values => saveMut.mutate(values)}>
					<Form.Item name="provider" label={t("system:bot.binding.provider")} rules={[{ required: true, message: t("system:bot.binding.providerPh") }]}>
						<Input placeholder={t("system:bot.binding.providerPh")} disabled={editing !== null} />
					</Form.Item>
					<Form.Item name="external_sub" label={t("system:bot.binding.externalSub")} rules={[{ required: true, message: t("system:bot.binding.externalSubPh") }]}>
						<Input placeholder={t("system:bot.binding.externalSubPh")} disabled={editing !== null} />
					</Form.Item>
					<Form.Item name="user_id" label={t("system:bot.binding.userId")} rules={[{ required: true, message: t("system:bot.binding.userIdPh") }]}>
						<Input placeholder={t("system:bot.binding.userIdPh")} />
					</Form.Item>
				</Form>
			</Modal>
		</Space>
	);
}
