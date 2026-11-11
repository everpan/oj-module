import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Form, Input, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { systemOboAuditGet } from "../../__client";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";
import { downloadCsv, toCsv } from "./csv";

interface Filters {
	svc: string
	ok: "" | "0" | "1"
}

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const HEADER = ["id", "svc", "provider", "external_sub", "user_id", "ok", "reason", "ts"] as const;

/** 失败原因 → 人话；动态拼接会被 i18n 守卫当字面量收走，故逐项静态 key。 */
function reasonLabel(reason: string, t: (k: string) => string): string {
	if (reason === "not_svc")
		return t("system:bot.audit.reason.not_svc");
	if (reason === "revoked")
		return t("system:bot.audit.reason.revoked");
	if (reason === "unbound")
		return t("system:bot.audit.reason.unbound");
	if (reason === "disabled")
		return t("system:bot.audit.reason.disabled");
	if (!reason)
		return t("system:bot.audit.reason.success");
	return reason; // 未知原因原样透传，不吞信息
}

/**
 * 换签审计面板：每次 obo 换签（成败均）一行。分页走服务端（pageSize/current + total）。
 * 导出同样前端本地拼 CSV：一次性大 pageSize 取全量再下载（后端 stream 端点留给运维脚本）。
 */
export function OboAuditPanel() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const [form] = Form.useForm();
	const [filters, setFilters] = useState<Filters>({ svc: "", ok: "" });
	const [page, setPage] = useState(1);
	const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
	const [exporting, setExporting] = useState(false);

	const query = useQuery({
		queryKey: ["system", "bot", "audit", filters, page, size],
		queryFn: () => systemOboAuditGet({
			svc: filters.svc || undefined,
			ok: filters.ok || undefined,
			pageSize: size,
			current: page,
		}),
	});

	const exportCsv = async () => {
		setExporting(true);
		try {
			// 后端 searchOboAudit 先 allRows 取全再切片：超大 pageSize 一跳拿全量，
			// 便于把当前过滤条件下的所有记录导出（审计表随换签线性增长）。
			const data = await systemOboAuditGet({
				svc: filters.svc || undefined,
				ok: filters.ok || undefined,
				pageSize: 1_000_000,
				current: 1,
			});
			downloadCsv("obo-audit.csv", toCsv(HEADER, data.list.map(r => [r.id, r.svc, r.provider, r.external_sub, r.user_id, r.ok, r.reason, r.ts])));
			message.success(t("system:bot.audit.exportOk", { count: data.list.length }));
		}
		catch (e) {
			message.error(explainError(e, t));
		}
		finally {
			setExporting(false);
		}
	};

	if (query.error && isForbidden(query.error))
		return <ForbiddenPanel t={t} error={query.error} />;

	const columns = [
		{ title: t("system:bot.audit.columns.id"), dataIndex: "id" },
		{ title: t("system:bot.audit.columns.time"), dataIndex: "ts", render: (v: number) => dayjs.unix(v).format("YYYY-MM-DD HH:mm:ss") },
		{ title: t("system:bot.audit.columns.svc"), dataIndex: "svc" },
		{ title: t("system:bot.audit.columns.provider"), dataIndex: "provider" },
		{ title: t("system:bot.audit.columns.externalSub"), dataIndex: "external_sub" },
		{ title: t("system:bot.audit.columns.userId"), dataIndex: "user_id" },
		{
			title: t("system:bot.audit.columns.ok"),
			dataIndex: "ok",
			render: (v: number) => <Tag color={v ? "green" : "red"}>{v ? t("system:bot.audit.yes") : t("system:bot.audit.no")}</Tag>,
		},
		{ title: t("system:bot.audit.columns.reason"), dataIndex: "reason", render: (v: string) => reasonLabel(v, t) },
	];

	return (
		<Space direction="vertical" style={{ width: "100%" }} size="middle">
			<Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{t("system:bot.audit.hint")}</Typography.Paragraph>
			<Space wrap>
				<Form
					form={form}
					layout="inline"
					initialValues={{ svc: "", ok: "" }}
					onFinish={(values: Filters) => {
						setFilters({ svc: values.svc || "", ok: values.ok || "" });
						setPage(1);
					}}
				>
					<Form.Item name="svc" label={t("system:bot.audit.filterSvc")}>
						<Input allowClear />
					</Form.Item>
					<Form.Item name="ok" label={t("system:bot.audit.filterOk")}>
						<Select
							style={{ width: 140 }}
							options={[
								{ value: "", label: t("system:bot.audit.okAll") },
								{ value: "1", label: t("system:bot.audit.okSuccess") },
								{ value: "0", label: t("system:bot.audit.okFail") },
							]}
						/>
					</Form.Item>
					<Form.Item>
						<Space>
							<Button type="primary" htmlType="submit">{t("system:common.search")}</Button>
							<Button onClick={() => {
								form.resetFields();
								setFilters({ svc: "", ok: "" });
								setPage(1);
							}}
							>
								{t("system:common.reset")}
							</Button>
						</Space>
					</Form.Item>
				</Form>
			</Space>
			<Space wrap>
				<Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportCsv()}>{t("system:bot.common.export")}</Button>
				<Button icon={<ReloadOutlined />} onClick={() => void query.refetch()}>{t("system:bot.common.refresh")}</Button>
			</Space>
			<Table
				rowKey="id"
				size="small"
				loading={query.isLoading}
				dataSource={query.data?.list ?? []}
				columns={columns}
				locale={{ emptyText: t("system:bot.audit.empty") }}
				pagination={{
					current: page,
					pageSize: size,
					total: query.data?.total ?? 0,
					showSizeChanger: true,
					pageSizeOptions: PAGE_SIZE_OPTIONS,
					showTotal: total => t("system:bot.audit.total", { total }),
					onChange: (nextPage, nextSize) => {
						if (nextSize !== size) {
							setSize(nextSize);
							setPage(1);
							return;
						}
						setPage(nextPage);
					},
				}}
			/>
		</Space>
	);
}
