// 企微组织架构同步面：POST /auth/wecom/sync/start · GET /auth/wecom/sync/status · POST /auth/wecom/sync/cancel
//
// 三条纪律（方案 §3 D7 / §5.3 / §9.5）：
//   1. **不接受 corpId**：只同步调用方当前租户（企微部署下 tenant_id 就是 corp_id）。
//      跨租户那套（superadmin 代触发）不在这里——它需要绕过 sql_guard，尚未落地，见计划文档。
//   2. **必须带租户头**：这三个端点不进 tenant.anonymous_paths，`assertTenantSelf` 再兜一层
//      ——伪造 X-TENANT-ID 时 token 的 sub 在目标租户里查无此人，一步拦掉。
//   3. 门禁：`auth.wecom.sync`（admin/superadmin 天然通过；可绑给自定义角色）。
//
// 限速只加在 start/cancel 上（`orgsync:<uid>` 10 次/分）：status 是纯本地读取、不打上游，
// 而进度条要 1~2 秒轮询一次——给它套限速等于把页面焊死。
//
// 10 次/分是跟单片预算（sync.ts DEFAULT_BUDGET_MS = 12 秒）配平的：一片打满 12 秒，
// 串行驱动天然只有 5 次/分，10 次是「不挡住正常推进」的余量；再低（初版 5 次）会在
// 第 6 片直接 429，大企业同步永远走不完。要动其中一个数，两个一起看。
import { respond } from "#/_platform/_shared/respond";
import { assertPermission, assertTenantSelf } from "#/_platform/_shared/service/infra/access";
import { recordOp } from "#/_platform/_shared/service/infra/audit";
import { rateLimit } from "#/_platform/_shared/service/infra/rate";
import { createWecomClient, runtimeCache, runtimeHttp } from "../../_shared/wecom/client";
import { readWecomConfig } from "../../_shared/wecom/config";
import { findProfile, probeProfile, runtimeStoreDeps } from "../../_shared/wecom/store";
import { attachProfile, cancelSync, emptyView, startSync, syncStatus } from "../../_shared/wecom/sync";

function currentTenant(): string {
	const t = (http as unknown as { tenantId?: unknown }).tenantId;
	return typeof t === "string" ? t.trim() : "";
}

function currentUid(): number {
	return Number(http.user?.id ?? 0);
}

const STATS = {
	type: "object",
	required: ["departments", "members", "skipped", "reconciled"],
	properties: {
		departments: { type: "number" },
		members: { type: "number" },
		skipped: { type: "number" },
		reconciled: { type: "boolean" },
	},
} as const;

const VIEW = {
	type: "object",
	required: ["connected", "authMode", "profileStatus", "status", "phase", "stats", "progress", "errCode", "errDetail", "startedAt", "finishedAt", "updateTime"],
	properties: {
		// 授权事实（页面据此决定「整条隐藏 / 成员授权卡片 / 冻结黄条 / 正常同步栏」）
		connected: { type: "boolean" },
		authMode: { type: "number" },
		profileStatus: { type: ["string", "null"] },
		status: { type: "string", enum: ["idle", "running", "done", "failed", "cancelled"] },
		phase: { type: "string", enum: ["departments", "members", "reconcile"] },
		stats: STATS,
		progress: {
			type: "object",
			required: ["done", "total"],
			properties: { done: { type: "number" }, total: { type: "number" } },
		},
		// 脱敏：只有错码与「哪一环、哪个部门、什么时候」，没有异常原文（原文可能夹带 token）
		errCode: { type: ["string", "null"] },
		errDetail: {
			type: ["object", "null"],
			properties: {
				errcode: { type: "number" },
				phase: { type: "string", enum: ["departments", "members", "reconcile"] },
				deptId: { type: "string" },
				at: { type: "number" },
			},
		},
		startedAt: { type: "number" },
		finishedAt: { type: "number" },
		updateTime: { type: "number" },
	},
} as const;

function agentOf(raw: unknown): string | null {
	const s = String(raw ?? "").trim();
	return s.length > 0 ? s : null;
}

/**
 * 解析当前租户的授权档案（企业代码 = 租户；多应用时必须带 agent）。
 *
 * 先 probe 再 findProfile：探针负责把「没装 / 已取消授权」翻译成人话（`findProfile` 为防
 * 枚举把两者统一成「企业代码无效或应用未开通」，那句文案摆在自家组织架构页上会让人以为
 * 是自己填错了），findProfile 负责解密出 permanent_code。
 */
async function profileOf(tenantId: string, agent: unknown) {
	const probe = await probeProfile(tenantId, agentOf(agent));
	if (!probe) {
		throw Object.assign(new Error("本站尚未开通企业微信：没有可同步的授权记录"), { status: 400 });
	}
	if (probe.status !== "active") {
		throw Object.assign(new Error("该企业已取消授权或应用已停用：组织架构同步已冻结，请联系服务商重新开通"), { status: 400 });
	}
	const cfg = readWecomConfig();
	const profile = await findProfile(tenantId, probe.agentId, runtimeStoreDeps(cfg));
	return { profile, probe, cfg };
}

const start = {
	/**
	 * 开始 / 继续一次同步：**每调一次推一片**，直到 status 变成 done/failed。
	 * 可续跑是这套分片设计的全部意义（isolate 无定时器、路由有超时），所以不是「必须从零开始」。
	 */
	async post() {
		await respond(async () => {
			await assertPermission("auth.wecom.sync");
			await assertTenantSelf();
			const tenantId = currentTenant();
			if (!tenantId)
				throw Object.assign(new Error("缺少租户上下文"), { status: 400 });
			await rateLimit(`orgsync:${currentUid()}`, 10, 60_000);

			const body = (http.body ?? {}) as { agent?: unknown };
			const { profile, probe, cfg } = await profileOf(tenantId, body.agent);
			const view = await startSync(
				{ corpId: profile.corpId, agentId: profile.agentId, secret: profile.permanentCode, authMode: profile.authMode },
				{ client: createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }), now: () => Date.now() },
			);
			// 审计落在**本租户**（同步只动自己租户的数据）：企业管理员在自己的日志里就能看到是谁同步的
			await recordOp({
				action: "wecom.org.sync",
				module: "auth",
				target: profile.corpId,
				detail: { agentId: profile.agentId, status: view.status, phase: view.phase, stats: view.stats, baseUrl: cfg.baseUrl },
			});
			return attachProfile(view, probe);
		});
	},
};
start.post.schema = {
	body: {
		type: "object",
		properties: { agent: { type: "string" } },
	},
};
start.post.response = VIEW;

const status = {
	// 进度轮询：只读 wecom_sync_job + 一次授权探针，不打上游、不占限速额度。
	// 「本站没装企微」在这里是**正常返回**（connected:false），不是 400——页面整条状态栏据此隐藏。
	async get() {
		await respond(async () => {
			await assertPermission("auth.wecom.sync");
			await assertTenantSelf();
			const tenantId = currentTenant();
			if (!tenantId)
				throw Object.assign(new Error("缺少租户上下文"), { status: 400 });
			const probe = await probeProfile(tenantId, agentOf((http.query as Record<string, unknown>).agent));
			if (!probe)
				return attachProfile(emptyView("idle"), null);
			return attachProfile(await syncStatus(tenantId, probe.agentId), probe);
		});
	},
};
status.get.schema = {
	query: {
		type: "object",
		properties: { agent: { type: "string" } },
	},
};
status.get.response = VIEW;

const cancel = {
	// 取消：清游标、置 cancelled。**不回滚**已写入的组织数据——同步幂等，重跑只是覆盖
	async post() {
		await respond(async () => {
			await assertPermission("auth.wecom.sync");
			await assertTenantSelf();
			const tenantId = currentTenant();
			if (!tenantId)
				throw Object.assign(new Error("缺少租户上下文"), { status: 400 });
			await rateLimit(`orgsync:${currentUid()}`, 10, 60_000);

			const { profile, probe } = await profileOf(tenantId, (http.body as Record<string, unknown> | undefined)?.agent);
			const view = await cancelSync(profile.corpId, profile.agentId, { now: () => Date.now() });
			await recordOp({
				action: "wecom.org.sync.cancel",
				module: "auth",
				target: profile.corpId,
				detail: { agentId: profile.agentId, phase: view.phase, stats: view.stats },
				level: 4,
			});
			return attachProfile(view, probe);
		});
	},
};
cancel.post.schema = {
	body: {
		type: "object",
		properties: { agent: { type: "string" } },
	},
};
cancel.post.response = VIEW;

export default { start, status, cancel };
