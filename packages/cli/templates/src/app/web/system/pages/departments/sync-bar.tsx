// 组织架构页顶部的企微同步状态条（方案 §5.4 / §6.4 / §7）。
//
// 一条纪律：**状态条只在「本租户装了企微」时才出现**。没装企微的站点（纯 CRUD 用户）看到的
// 就是一页干净的组织架构——所以 `connected=false`、无权限（403）、没有授权记录（400）都不画红条。
//
// 交互形态由后端的分片设计决定：一次 start 只推一片，调用方轮询。这里把它包成「一次点击 =
// 一直推到 done/failed」，中间按限速配额留最小间隔；暂停/失败后按钮变「继续同步」，进度不丢。
import { request } from "@oj-module/runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Popconfirm, Progress, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { errMsg, statusOf } from "../errors";

/** 与后端 `auth/wecom/sync/api.ts` 的 VIEW 契约同形（跨模块调用，走全局 request 而非生成本模块 client） */
interface SyncView {
	connected: boolean
	authMode: number
	profileStatus: "active" | "disabled" | null
	/** 已解析到的应用 id：多应用/共存企业的分辨锚点，start / cancel 要原样回传 */
	agentId: string | null
	/** suite=代开发 / corp=企业内部应用（自建）：自建应用没有「授权模式」这回事 */
	credentialKind: "suite" | "corp" | null
	status: "idle" | "running" | "done" | "failed" | "cancelled"
	phase: "departments" | "members" | "reconcile"
	stats: { departments: number, members: number, skipped: number, reconciled: boolean }
	progress: { done: number, total: number }
	errCode: string | null
	errDetail: { errcode?: number, phase: string, deptId?: string, at: number } | null
	startedAt: number
	finishedAt: number
	updateTime: number
}

const KEY = ["system", "wecom-sync"] as const;

/** 单片推完到下一次 start 的最小间隔：后端限速 10 次/分，串行驱动别自己撞 429 */
const MIN_GAP_MS = 6000;
/**
 * 同步请求超时：单条 `sync/start` 处理一片（预算 12s + 单次上游软超时 5s，最坏 ~17s），
 * 远长于运行时 `request` 的默认 10s。不单独放宽，前端必然在「片还没推完」时先抛
 * `Request timed out`。30s 与服务器默认路由超时对齐，留足余量。
 */
const SYNC_TIMEOUT_MS = 30_000;
/** 一轮点击最多推多少片（12 秒/片 ≈ 12 分钟）：兜底防呆，正常企业两三次就到底 */
const MAX_SLICES = 60;

/**
 * 已解析到的应用 id。同一家企业有两行档案（代开发 + 自建，迁移期常见）时后端要求带 agent，
 * 而这个值只有后端知道：首次 status 不带（后端按「本站自建应用优先」解析），拿到后记住，
 * 后续 start / cancel 原样回传。放模块级是为了跨组件实例复用，不参与渲染。
 */
let agentParam: string | null = null;

function withAgent(url: string): string {
	return agentParam ? `${url}?agent=${encodeURIComponent(agentParam)}` : url;
}

function agentBody(): { agent?: string } {
	return agentParam ? { agent: agentParam } : {};
}

function remember(view: SyncView): SyncView {
	agentParam = view.agentId ?? agentParam;
	return view;
}

async function fetchStatus(): Promise<SyncView> {
	const env = await request.get(withAgent("auth/wecom/sync/status"), { timeout: SYNC_TIMEOUT_MS }).json<{ code: number, data?: SyncView }>();
	if (!env.data)
		throw new Error("企业微信同步状态读取失败");
	return remember(env.data);
}

async function pushSlice(): Promise<SyncView> {
	const env = await request.post("auth/wecom/sync/start", { json: agentBody(), timeout: SYNC_TIMEOUT_MS }).json<{ code: number, data?: SyncView }>();
	if (!env.data)
		throw new Error("企业微信同步未能启动");
	return remember(env.data);
}

async function cancelSync(): Promise<SyncView> {
	const env = await request.post("auth/wecom/sync/cancel", { json: agentBody(), timeout: SYNC_TIMEOUT_MS }).json<{ code: number, data?: SyncView }>();
	if (!env.data)
		throw new Error("取消同步失败");
	return remember(env.data);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * 「X 分钟前」：用**服务端时间戳之差**（updateTime - finishedAt）而不是浏览器 Date.now()，
 * 一来渲染期不调时钟（纯函数），二来服务器与浏览器时区/时钟偏差不会把「刚刚」算成「8 小时前」。
 */
function agoLabel(secs: number, t: (k: string, o?: Record<string, unknown>) => string): string {
	if (secs < 60)
		return t("system:wecom.sync.ago.justNow");
	if (secs < 3600)
		return t("system:wecom.sync.ago.minutes", { count: Math.floor(secs / 60) });
	if (secs < 86400)
		return t("system:wecom.sync.ago.hours", { count: Math.floor(secs / 3600) });
	return t("system:wecom.sync.ago.days", { count: Math.floor(secs / 86400) });
}

/** 错码 → 卡片文案（§7 表：谁处理、怎么办，别让企业管理员对着错误码发呆） */
function errorCard(code: string, t: (k: string, o?: Record<string, unknown>) => string): { title: string, hint: string } {
	const pick = (kind: string) => ({
		title: t(`system:wecom.sync.err.${kind}.title`, { code }),
		hint: t(`system:wecom.sync.err.${kind}.hint`, { code }),
	});
	if (code === "60011" || code === "48002")
		return pick("permission");
	if (code === "45009" || code === "45033")
		return pick("rateLimited");
	if (code === "60020")
		return pick("ipWhitelist");
	if (code === "timeout" || code === "network")
		return pick("network");
	return pick("unknown");
}

/** 状态条：只画「能不能同步 / 同步到哪了 / 失败了怎么办」，不暴露「三轨」这类内部名词 */
export function WecomSyncBar({ onFinished }: { onFinished: () => void }) {
	const { t } = useTranslation();
	const { message } = App.useApp();
	const queryClient = useQueryClient();
	const [driving, setDriving] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	// 组件卸载后停止继续推片：否则离开页面的人在后台被反复打上游
	const aliveRef = useRef(true);
	useEffect(() => {
		return () => {
			aliveRef.current = false;
		};
	}, []);

	const query = useQuery({
		queryKey: KEY,
		queryFn: fetchStatus,
		retry: false,
		// 只有「别人在推」（另一标签页 / 上次未收尾）时才轮询；自己在推时每一片都带最新状态
		refetchInterval: q => (!driving && q.state.data?.status === "running" ? 2000 : false),
	});

	const setView = (v: SyncView) => queryClient.setQueryData(KEY, v);

	const drive = async () => {
		setDriving(true);
		let last: SyncView | null = null;
		try {
			for (let i = 0; i < MAX_SLICES; i++) {
				const startedAt = Date.now();
				const view = await pushSlice();
				if (!aliveRef.current)
					return;
				last = view;
				setView(view);
				if (view.status !== "running") {
					if (view.status === "done")
						message.success(t("system:wecom.sync.done", { depts: view.stats.departments, members: view.stats.members }));
					onFinished();
					return;
				}
				// 短片（限流退避 / 空转）会连着打：补足间隔，别自己撞后端 10 次/分的限速
				const spent = Date.now() - startedAt;
				if (spent < MIN_GAP_MS) {
					await sleep(MIN_GAP_MS - spent);
					if (!aliveRef.current)
						return;
				}
			}
			message.warning(t("system:wecom.sync.paused", { depts: last?.stats.departments ?? 0 }));
		}
		catch (e) {
			message.error(errMsg(e));
		}
		finally {
			if (aliveRef.current)
				setDriving(false);
			queryClient.invalidateQueries({ queryKey: KEY });
		}
	};

	const stop = async () => {
		setCancelling(true);
		try {
			setView(await cancelSync());
			message.success(t("system:wecom.sync.cancelled"));
		}
		catch (e) {
			message.error(errMsg(e));
		}
		finally {
			if (aliveRef.current)
				setCancelling(false);
		}
	};

	// 未连接 / 无权限 / 站点没接企微：整条不出现。403 与 400 都是「正常情况下就该没有」，
	// 别的错误（500、网络）才值得占版面，让人知道「是有同步功能但它坏了」。
	if (query.error && statusOf(query.error) !== 403 && statusOf(query.error) !== 400)
		return <Alert type="warning" showIcon message={errMsg(query.error)} />;

	const view = query.data;
	if (!view || !view.connected)
		return null;

	// 成员授权卡片只对代开发成立：自建应用没有「授权模式」，authMode 恒 0（双保险，防上游写脏数据）
	if (view.credentialKind !== "corp" && view.authMode !== 0) {
		return (
			<Alert
				type="warning"
				showIcon
				message={t("system:wecom.sync.memberAuth.title")}
				description={t("system:wecom.sync.memberAuth.hint")}
			/>
		);
	}

	if (view.profileStatus === "disabled") {
		return (
			<Alert
				type="warning"
				showIcon
				message={t("system:wecom.sync.frozen.title")}
				description={t("system:wecom.sync.frozen.hint")}
			/>
		);
	}

	const running = view.status === "running";
	const lastAt = view.finishedAt || view.updateTime;
	const percent = view.progress.total > 0 ? Math.round((view.progress.done / view.progress.total) * 100) : 0;

	const headline = running
		? (view.progress.total > 0
			? t("system:wecom.sync.syncingProgress", { done: view.progress.done, total: view.progress.total })
			: t("system:wecom.sync.syncing"))
		: lastAt > 0
			? `${t("system:wecom.sync.updatedAt", { time: agoLabel(Math.max(0, view.updateTime - lastAt), t) })} · ${t("system:wecom.sync.auto")}`
			: t("system:wecom.sync.neverSynced");

	return (
		<Alert
			type={view.status === "failed" ? "error" : "info"}
			showIcon
			message={(
				<Space size="middle" wrap>
					<Typography.Text>{headline}</Typography.Text>
					{!running && view.stats.skipped > 0 && (
						<Typography.Text type="warning">
							{t("system:wecom.sync.skipped", { count: view.stats.skipped })}
						</Typography.Text>
					)}
				</Space>
			)}
			description={view.status === "failed" && view.errCode
				? (
					<Space direction="vertical" size={0}>
						<Typography.Text strong>{errorCard(view.errCode, t).title}</Typography.Text>
						<Typography.Text type="secondary">{errorCard(view.errCode, t).hint}</Typography.Text>
					</Space>
				)
				: running && view.progress.total > 0
					? <Progress percent={percent} size="small" style={{ maxWidth: 320 }} />
					: undefined}
			action={(
				<Space direction="vertical" size={4}>
					<Button type="primary" size="small" loading={driving} onClick={drive}>
						{running
							? t("system:wecom.sync.resume")
							: view.status === "failed" ? t("system:wecom.sync.retry") : t("system:wecom.sync.syncNow")}
					</Button>
					{running && (
						<Popconfirm
							title={t("system:wecom.sync.cancelConfirm")}
							okText={t("system:wecom.sync.cancel")}
							cancelText={t("system:common.cancel")}
							onConfirm={stop}
						>
							<Button size="small" type="text" danger loading={cancelling}>
								{t("system:wecom.sync.cancel")}
							</Button>
						</Popconfirm>
					)}
				</Space>
			)}
		/>
	);
}
