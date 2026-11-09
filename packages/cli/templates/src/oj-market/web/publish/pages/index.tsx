import type { PublishCredentialGetData } from "../__client";
import type { CredentialStatus } from "./model";
import type { IssuedCredential } from "./token-modal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Tooltip, Typography } from "antd";

import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { publishCredentialGet, publishCredentialPost, publishCredentialRevokePost } from "../__client";
import { canRevoke, errorText, statusColor } from "./model";
import { OfflineUploadSection } from "./offline-upload";
import { TokenModal } from "./token-modal";
import { TrustReviewSection } from "./trust-review";

type CredentialRow = PublishCredentialGetData["list"][number];

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 秒级 epoch（后端统一存秒，不是毫秒——故用 dayjs.unix 而非 dayjs()） */
function formatSecs(secs: number | null | undefined): string {
	return secs == null ? "-" : dayjs.unix(secs).format("YYYY-MM-DD HH:mm");
}

/**
 * 发布管理页。
 *
 * 页面的职责只有三件事：列凭证、申请、撤销。所有推导都留在服务端
 * （`key_id` 在申请时算好、`status` 由 used/revoked/expiry 三列统一判定），
 * 前端不重复算——否则「页面显示已过期、后端仍可兑换」这类分叉迟早出现。
 *
 * 可见范围同样由服务端决定：普通用户只拿到自己的；超管拿到全部，响应里多一个
 * `owner_tenant` 字段。前端据「数据里有没有这个字段」决定是否显示租户列与租户筛选，
 * 不去单独查一次「我是谁」——少一个请求，也少一处会过期的判断。
 */
export default function PublishPage() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
	const [tenant, setTenant] = useState("");
	const [tenantInput, setTenantInput] = useState("");
	const [applyOpen, setApplyOpen] = useState(false);
	const [issued, setIssued] = useState<IssuedCredential | null>(null);
	const [form] = Form.useForm<{ product: string }>();

	const query = useQuery({
		queryKey: ["publish", "credential", page, size, tenant],
		queryFn: () => publishCredentialGet({ page, limit: size, tenant: tenant || undefined }),
	});

	const apply = useMutation({
		mutationFn: (product: string) => publishCredentialPost({ product }),
		onSuccess: (r) => {
			setApplyOpen(false);
			form.resetFields();
			// 明文只在响应里：先落进弹窗，再刷新列表（刷新失败也不该丢掉用户手里这张凭证）
			setIssued(r);
			void queryClient.invalidateQueries({ queryKey: ["publish", "credential"] });
		},
		onError: e => message.error(errorText(e)),
	});

	const revoke = useMutation({
		mutationFn: (id: number) => publishCredentialRevokePost({ id }),
		onSuccess: () => {
			message.success(t("publish:revoke.done"));
			void queryClient.invalidateQueries({ queryKey: ["publish", "credential"] });
		},
		onError: e => message.error(errorText(e)),
	});

	const rows = query.data?.list ?? [];
	// 超管专属字段出现即说明当前账号看得见全部租户；已在筛选时也保持入口可见（否则无法清空筛选）
	const seesTenants = tenant !== "" || rows.some(row => row.owner_tenant != null);

	const columns = [
		{ title: t("publish:columns.product"), dataIndex: "product" },
		{
			title: t("publish:columns.keyId"),
			dataIndex: "key_id",
			ellipsis: { showTitle: false },
			render: (keyId: string) => <Tooltip title={keyId}>{keyId}</Tooltip>,
		},
		{
			title: t("publish:columns.applicant"),
			dataIndex: "username",
			render: (username: string, row: CredentialRow) => (row.display_name ? `${row.display_name}（${username}）` : username),
		},
		{
			title: t("publish:columns.tokenHint"),
			dataIndex: "token_hint",
			render: (hint: string) => (
				<Typography.Text code>
					{hint}
					…
				</Typography.Text>
			),
		},
		{
			title: t("publish:columns.status"),
			dataIndex: "status",
			render: (status: CredentialStatus) => <Tag color={statusColor(status)}>{t(`publish:status.${status}`)}</Tag>,
		},
		{ title: t("publish:columns.createdAt"), dataIndex: "created_at", render: (v: number) => formatSecs(v) },
		{ title: t("publish:columns.usedAt"), dataIndex: "used_at", render: (v: number | null) => formatSecs(v) },
		{ title: t("publish:columns.expiresAt"), dataIndex: "expires_at", render: (v: number) => formatSecs(v) },
		...(seesTenants ? [{ title: t("publish:columns.tenant"), dataIndex: "owner_tenant" }] : []),
		{
			title: t("publish:columns.actions"),
			dataIndex: "id",
			render: (_: number, row: CredentialRow) => (canRevoke(row.status)
				? (
					<Popconfirm title={t("publish:revoke.confirm")} okText={t("publish:revoke.ok")} onConfirm={() => revoke.mutate(row.id)}>
						<Button type="link" danger size="small" loading={revoke.isPending}>{t("publish:revoke.action")}</Button>
					</Popconfirm>
				)
				: <Typography.Text type="secondary">-</Typography.Text>),
		},
	];

	return (
		<Space direction="vertical" style={{ width: "100%", paddingTop: 16 }}>
			<Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
				<Typography.Text type="secondary">{t("publish:page.subtitle")}</Typography.Text>
				<Space>
					{seesTenants && (
						<Input.Search
							data-testid="publish-tenant-filter"
							allowClear
							placeholder={t("publish:filter.tenantPlaceholder")}
							value={tenantInput}
							onChange={e => setTenantInput(e.target.value)}
							onSearch={(value) => {
								setTenant(value.trim());
								setPage(1);
							}}
							style={{ width: 240 }}
						/>
					)}
					<Button type="primary" data-testid="publish-apply" onClick={() => setApplyOpen(true)}>{t("publish:page.apply")}</Button>
				</Space>
			</Space>
			<Table
				rowKey="id"
				loading={query.isLoading}
				dataSource={rows}
				columns={columns}
				locale={{ emptyText: t("publish:page.empty") }}
				pagination={{
					current: page,
					pageSize: size,
					total: query.data?.total ?? 0,
					showSizeChanger: true,
					pageSizeOptions: PAGE_SIZE_OPTIONS,
					showTotal: total => t("publish:page.total", { total }),
					onChange: (nextPage, nextSize) => {
						// 改每页条数后原页码可能越界：统一回第 1 页（与操作日志页同口径）
						if (nextSize !== size) {
							setSize(nextSize);
							setPage(1);
							return;
						}
						setPage(nextPage);
					},
				}}
			/>

			<OfflineUploadSection />

			<TrustReviewSection />

			<Modal
				open={applyOpen}
				title={t("publish:apply.title")}
				confirmLoading={apply.isPending}
				okText={t("publish:apply.ok")}
				cancelText={t("publish:apply.cancel")}
				onCancel={() => setApplyOpen(false)}
				onOk={() => form.submit()}
			>
				<Form form={form} layout="vertical" onFinish={v => apply.mutate(v.product)}>
					<Form.Item
						name="product"
						label={t("publish:apply.product")}
						extra={t("publish:apply.productExtra")}
						rules={[{ required: true, message: t("publish:apply.productRequired") }]}
					>
						<Input data-testid="publish-product" placeholder="demo-solution" autoFocus />
					</Form.Item>
				</Form>
			</Modal>

			<TokenModal
				issued={issued}
				onClose={() => setIssued(null)}
			/>
		</Space>
	);
}
