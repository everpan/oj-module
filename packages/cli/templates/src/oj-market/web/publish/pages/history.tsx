import type { ReleaseRow } from "../../types";
import { useQuery } from "@tanstack/react-query";
import { Space, Table, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMarketClient } from "../../api/context";

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 秒级 epoch（服务端统一存秒）→ 本地时间；缺值显示 - */
function formatSecs(secs: number | null | undefined): string {
	return secs == null ? "-" : dayjs.unix(secs).format("YYYY-MM-DD HH:mm");
}

/**
 * 发布历史页。
 *
 * 数据真相在服务端：每次打开都由后端先与签名索引对账（新版本补进来，已入库行不改时间），
 * 前端只做分页展示——不在浏览器里重算「谁先谁后」，避免两处排序口径分叉。
 *
 * 发布时间优先取分发包落 CDN 的 Last-Modified；源不提供时回落索引生成时间，
 * 这种情况标一个「索引时间」，让读者知道它不是精确落包时刻。
 */
export default function ReleaseHistoryPage() {
	const { t } = useTranslation();
	const client = useMarketClient();
	const [page, setPage] = useState(1);
	const [size, setSize] = useState(DEFAULT_PAGE_SIZE);

	const query = useQuery({
		queryKey: ["market", "releases", page, size],
		queryFn: () => client.releases({ page, limit: size }),
	});

	const rows = query.data?.list ?? [];

	const columns = [
		{ title: t("publish:history.columns.product"), dataIndex: "product" },
		{ title: t("publish:history.columns.version"), dataIndex: "version" },
		{
			title: t("publish:history.columns.publisher"),
			dataIndex: "key_id",
			render: (value: string | null) => value ?? "-",
		},
		{
			title: (
				<Tooltip title={t("publish:history.publishedAtHint")}>
					<span>{t("publish:history.columns.publishedAt")}</span>
				</Tooltip>
			),
			dataIndex: "published_at",
			render: (value: number, row: ReleaseRow) => (
				<Space size={4}>
					<span>{formatSecs(value)}</span>
					{row.published_at_source === "file" && <Tag color="default">{t("publish:history.backfillTime")}</Tag>}
				</Space>
			),
		},
		{
			title: t("publish:history.columns.status"),
			dataIndex: "yanked",
			render: (value: number) => (
				<Tag color={value === 1 ? "default" : "green"}>
					{value === 1 ? t("publish:history.status.yanked") : t("publish:history.status.active")}
				</Tag>
			),
		},
	];

	return (
		<Space direction="vertical" style={{ width: "100%", paddingTop: 16 }} size="middle">
			<Space direction="vertical" size={4}>
				<Typography.Title level={4} style={{ margin: 0 }}>
					{t("publish:history.title")}
				</Typography.Title>
				<Typography.Text type="secondary">{t("publish:history.subtitle")}</Typography.Text>
			</Space>

			<Table<ReleaseRow>
				rowKey="id"
				size="middle"
				columns={columns}
				dataSource={rows}
				loading={query.isLoading}
				locale={{ emptyText: t("publish:history.empty") }}
				pagination={{
					current: page,
					pageSize: size,
					total: query.data?.total ?? 0,
					showSizeChanger: true,
					pageSizeOptions: PAGE_SIZE_OPTIONS,
					showTotal: total => t("publish:history.total", { total }),
					onChange: (nextPage, nextSize) => {
						setPage(nextPage);
						setSize(nextSize);
					},
				}}
			/>
		</Space>
	);
}
