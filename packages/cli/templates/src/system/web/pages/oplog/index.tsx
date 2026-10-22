import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input, InputNumber, Space, Table, Tooltip } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { systemOplogGet } from "../../__client/api";
import { isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

interface OplogFilters {
	action?: string
	username?: string
	module?: string
	limit?: number
}

/**
 * 操作日志（AC1-29/D13）：action 精确 / username 前缀 / module 精确，limit 钳 200。
 * truncated=true 表示结果被截断（服务端 paged），顶部提示缩小过滤范围。
 */
export default function OplogPage() {
	const { t } = useTranslation();
	const [filters, setFilters] = useState<OplogFilters>({});

	const query = useQuery({
		queryKey: ["system", "oplog", filters],
		queryFn: () => systemOplogGet(filters),
	});

	if (query.error && isForbidden(query.error))
		return <ForbiddenPanel t={t} error={query.error} />;

	const columns = [
		{ title: t("system:oplog.columns.time"), dataIndex: "create_time", render: (ms: number) => dayjs(ms).format("YYYY-MM-DD HH:mm:ss") },
		{ title: t("system:oplog.columns.username"), dataIndex: "username" },
		{ title: t("system:oplog.columns.action"), dataIndex: "action" },
		{ title: t("system:oplog.columns.module"), dataIndex: "module" },
		{ title: t("system:oplog.columns.target"), dataIndex: "target" },
		{
			title: t("system:oplog.columns.detail"),
			dataIndex: "detail",
			ellipsis: { showTitle: false },
			render: (detail: string | null) => (detail ? <Tooltip title={detail}>{detail}</Tooltip> : null),
		},
		{ title: t("system:oplog.columns.level"), dataIndex: "level" },
	];

	return (
		<Space direction="vertical" style={{ width: "100%", paddingTop: 16 }}>
			<Form
				layout="inline"
				onFinish={values => setFilters({
					action: values.action || undefined,
					username: values.username || undefined,
					module: values.module || undefined,
					limit: values.limit || undefined,
				})}
			>
				<Form.Item name="action" label={t("system:oplog.filterAction")}>
					<Input allowClear />
				</Form.Item>
				<Form.Item name="username" label={t("system:oplog.filterUsername")}>
					<Input allowClear />
				</Form.Item>
				<Form.Item name="module" label={t("system:oplog.filterModule")}>
					<Input allowClear />
				</Form.Item>
				<Form.Item name="limit" label={t("system:oplog.filterLimit")} initialValue={50}>
					<InputNumber min={1} max={200} />
				</Form.Item>
				<Form.Item>
					<Space>
						<Button type="primary" htmlType="submit">{t("system:common.search")}</Button>
						<Button onClick={() => { setFilters({}); }}>
							{t("system:common.reset")}
						</Button>
					</Space>
				</Form.Item>
			</Form>
			{query.data?.truncated ? <Alert type="warning" showIcon message={t("system:oplog.truncated")} /> : null}
			<Table
				rowKey="id"
				loading={query.isLoading}
				dataSource={query.data?.list ?? []}
				columns={columns}
				pagination={{ hideOnSinglePage: true, pageSize: 50 }}
			/>
		</Space>
	);
}
