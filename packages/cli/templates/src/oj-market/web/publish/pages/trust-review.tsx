import type { TrustReviewItem } from "../../types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Table, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useMarketClient } from "../../api/context";
import { errorText } from "./model";

/** HTTP 状态提取（ky/ContractApiError 同形态；与 defaultClient isUnconfigured 同口径） */
function statusOf(e: unknown): number | undefined {
	return (e as { response?: { status?: number } } | null)?.response?.status;
}

/**
 * 发布管理「信任审核」区（2026-11-10）：未知发布方首装停 needs_trust 终态，公钥指纹
 * 已随任务记录隐式提交——本区把待审项摆到 superadmin 面前：核对发布方与指纹后点
 * 「确认信任」即入信任库（服务端自任务记录重取公钥复算指纹，防混淆代理），安装人
 * 重跑原安装命令续跑（staging 不清场）。
 *
 * 可见范围由服务端决定：GET 403（非超管）时整区不渲染，前端不重复判权
 * （同凭证表 owner_tenant 先例）。
 */
export function TrustReviewSection() {
	const { t } = useTranslation();
	const client = useMarketClient();
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: ["publish", "trust-review"],
		queryFn: () => client.trustReview(),
		retry: false,
	});
	const approve = useMutation({
		mutationFn: (taskId: string) => client.trust(taskId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["publish", "trust-review"] });
		},
	});

	if (statusOf(query.error) === 403)
		return null;

	const rows = query.data ?? [];
	return (
		<section data-testid="trust-review" style={{ marginTop: 24 }}>
			<Typography.Title level={5} style={{ marginTop: 0 }}>{t("publish:trustReview.title")}</Typography.Title>
			<Typography.Paragraph type="secondary">{t("publish:trustReview.desc")}</Typography.Paragraph>
			{approve.isError && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={errorText(approve.error)} />}
			<Table<TrustReviewItem>
				rowKey="task_id"
				loading={query.isLoading}
				dataSource={rows}
				pagination={false}
				locale={{ emptyText: t("publish:trustReview.empty") }}
				columns={[
					{ title: t("publish:trustReview.colSolution"), render: (_, r) => `${r.name}@${r.version}` },
					{
						title: t("publish:trustReview.colKeyId"),
						dataIndex: "key_id",
						ellipsis: { showTitle: false },
						render: (keyId: string) => <Tooltip title={keyId}>{keyId}</Tooltip>,
					},
					{
						title: t("publish:trustReview.colFingerprint"),
						dataIndex: "fingerprint",
						render: (fp: string) => <Typography.Text code copyable={{ text: fp }}>{fp}</Typography.Text>,
					},
					{
						title: t("publish:trustReview.colAction"),
						render: (_, r) => (
							<Button
								size="small"
								type="primary"
								loading={approve.isPending && approve.variables === r.task_id}
								onClick={() => approve.mutate(r.task_id)}
							>
								{t("publish:trustReview.approve")}
							</Button>
						),
					},
				]}
			/>
		</section>
	);
}
