import type { SolutionsRow, TaskLike } from "./market-entry";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Progress, Result, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Link } from "react-router";
import { ojMarketIndexGet, ojMarketInstallPost, ojMarketTaskGet } from "../../../../../oj-market/web/__client";
import { explainError, isForbidden } from "../errors";
import { ForbiddenPanel } from "../forbidden";
import { marketEntryOf, taskOutcomeOf } from "./market-entry";

/**
 * 方案安装入口（Phase B T3，superadmin）：市场 UI 出厂未装（纯 web 方案包），
 * 首装经此页走既有平台编排面 POST /api/oj-market/install（api 随脚手架内置，R29）。
 * 状态推导与任务终态映射见 ./market-entry（纯函数，tests/solutions-entry.spec 钉）。
 */
export default function SolutionsPage() {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const [taskId, setTaskId] = useState<string | null>(null);

	const query = useQuery({
		queryKey: ["system", "solutions"],
		// size 上限 200（生成契约 max）；首方目录规模小，翻页边角不在本页处理
		queryFn: () => ojMarketIndexGet({ page: 1, size: 200 }),
	});
	const entry = marketEntryOf((query.data?.list ?? []) as unknown as SolutionsRow[]);

	const taskQuery = useQuery({
		queryKey: ["system", "solutions-task", taskId],
		enabled: taskId !== null,
		refetchInterval: q => (q.state.data && taskOutcomeOf(q.state.data as unknown as TaskLike).kind !== "running" ? false : 800),
		queryFn: () => ojMarketTaskGet({ id: taskId! }),
	});
	const outcome = taskQuery.data ? taskOutcomeOf(taskQuery.data as unknown as TaskLike) : null;

	// 终态后刷新目录行：安装完成 → 卡片翻「已装」态（含取消/失败也刷，状态以服务端为准）
	useEffect(() => {
		if (outcome !== null && outcome.kind !== "running")
			void queryClient.invalidateQueries({ queryKey: ["system", "solutions"] });
	}, [outcome, queryClient]);

	const installMut = useMutation({
		mutationFn: () => ojMarketInstallPost({ source: "cdn", name: "oj-market" }),
		onSuccess: r => setTaskId(r.task_id ?? null),
		onError: e => message.error(explainError(e, t)),
	});

	if (query.error && isForbidden(query.error))
		return <ForbiddenPanel t={t} error={query.error} />;

	if (entry.kind === "absent") {
		return (
			<Result
				status="warning"
				title={t("system:solutionsPage.absentTitle")}
				subTitle={t("system:solutionsPage.absentHint")}
				style={{ paddingTop: 48 }}
			/>
		);
	}

	return (
		<Space direction="vertical" style={{ width: "100%", paddingTop: 16 }}>
			<Card title={t("system:solutionsPage.title")}>
				<Space direction="vertical" style={{ width: "100%" }}>
					<Space wrap>
						<Tag color="blue">oj-market</Tag>
						{entry.kind === "installable" && <Tag>{t("system:solutionsPage.latest", { version: entry.latest })}</Tag>}
						{entry.kind === "installed" && <Tag color="green">{t("system:solutionsPage.installed", { version: entry.installed })}</Tag>}
						{entry.kind === "installed" && entry.latest !== null && entry.latest !== entry.installed && (
							<Tag color="orange">{t("system:solutionsPage.latest", { version: entry.latest })}</Tag>
						)}
					</Space>
					{entry.kind === "installable" && outcome?.kind !== "done" && (
						<>
							<Button type="primary" loading={installMut.isPending || outcome?.kind === "running"} onClick={() => installMut.mutate()}>
								{t("system:solutionsPage.install")}
							</Button>
							{outcome?.kind === "running" && (
								<>
									<Progress percent={outcome.progress} size="small" style={{ maxWidth: 480 }} />
									<span>{outcome.message}</span>
								</>
							)}
							{outcome?.kind === "failed" && <span style={{ color: "#cf1322" }}>{outcome.message}</span>}
							{outcome?.kind === "needsTrust" && <span style={{ color: "#d48806" }}>{t("system:solutionsPage.needsTrust")}</span>}
						</>
					)}
					{outcome?.kind === "done" && (
						<Result
							status="success"
							title={t("system:solutionsPage.doneTitle")}
							extra={<Link to="/oj-market"><Button type="primary">{t("system:solutionsPage.goMarket")}</Button></Link>}
							style={{ padding: "16px 0" }}
						/>
					)}
					{entry.kind === "installed" && (
						<Space>
							<Link to="/oj-market"><Button type="primary">{t("system:solutionsPage.goMarket")}</Button></Link>
							{entry.upgradable && <span>{t("system:solutionsPage.upgradableHint")}</span>}
						</Space>
					)}
				</Space>
			</Card>
		</Space>
	);
}
