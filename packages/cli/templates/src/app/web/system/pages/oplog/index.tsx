import { useQuery } from "@tanstack/react-query";
import { Button, Form, Input, Space, Table, Tooltip } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { systemOplogGet } from "../../__client";
import { isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";

interface OplogFilters {
	action?: string
	username?: string
	module?: string
}

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/**
 * 操作日志（AC1-29/D13）：action 精确 / username 包含 / module 精确。
 *
 * 分页交给服务端：`page` + `limit`（每页条数，钳 200），响应带 `total`，页面按 total 出页码。
 * 不再有「结果被截断」的横幅——记录再多也能通过页码翻到，不必靠缩小过滤范围。
 */
export default function OplogPage() {
	const { t } = useTranslation();
	const [filters, setFilters] = useState<OplogFilters>({});
	const [page, setPage] = useState(1);
	const [size, setSize] = useState(DEFAULT_PAGE_SIZE);

	const query = useQuery({
		queryKey: ["system", "oplog", filters, page, size],
		queryFn: () => systemOplogGet({ ...filters, page, limit: size }),
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
				onFinish={(values) => {
					setFilters({
						action: values.action || undefined,
						username: values.username || undefined,
						module: values.module || undefined,
					});
					setPage(1);
				}}
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
				<Form.Item>
					<Space>
						<Button type="primary" htmlType="submit">{t("system:common.search")}</Button>
						<Button
							onClick={() => {
								setFilters({});
								setPage(1);
							}}
						>
							{t("system:common.reset")}
						</Button>
					</Space>
				</Form.Item>
			</Form>
			<Table
				rowKey="id"
				loading={query.isLoading}
				dataSource={query.data?.list ?? []}
				columns={columns}
				pagination={{
					current: page,
					pageSize: size,
					total: query.data?.total ?? 0,
					showSizeChanger: true,
					pageSizeOptions: PAGE_SIZE_OPTIONS,
					showTotal: total => t("system:oplog.total", { total }),
					onChange: (nextPage, nextSize) => {
						// 改每页条数后原页码可能越界：统一回第 1 页
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
