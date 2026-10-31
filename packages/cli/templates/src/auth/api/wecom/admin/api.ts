// 代开发后台（服务商运营面）：GET /auth/wecom/admin/apps · POST /auth/wecom/admin/status · GET /auth/wecom/admin/install
//
// 权限：仅超级管理员（`assertSuperAdmin`）。这三件事都是**跨租户**的站点级操作
// （看所有已授权企业、停用某企业、生成安装链接），不是某个租户的管理员能做的；
// 用 `assertSystemAdmin` 会把 admin 也放进来，而 admin 属于某个租户，等于让他看别家企业的 corp_id。
//
// 三个端点都不挂在 `tenant.anonymous_paths` 里：它们是正常登录后的管理面，必须带租户头，
// 也就不会走 `db.asTenant`（见 _shared/wecom/admin.ts 头注释第 2 点）。
import { respond } from "#/_platform/_shared/respond";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
import { recordOp } from "#/_platform/_shared/service/infra/audit";
import { createInstall, listApps, setAppStatus } from "../../_shared/wecom/admin";
import { createWecomClient, runtimeCache, runtimeHttp } from "../../_shared/wecom/client";
import { readWecomConfig } from "../../_shared/wecom/config";

/** 清单：已授权企业 × 应用（不含 permanent_code，secret 不出库） */
async function get() {
	await respond(async () => {
		await assertSuperAdmin();
		return listApps();
	});
}
get.response = {
	type: "array",
	items: {
		type: "object",
		required: ["suite_id", "corp_id", "agent_id", "auth_corp_id", "env", "status", "installed_at", "update_time"],
		properties: {
			suite_id: { type: "string" },
			corp_id: { type: "string" },
			agent_id: { type: "string" },
			auth_corp_id: { type: "string" },
			env: { type: "string" },
			corp_name: { type: ["string", "null"] },
			status: { type: "string", enum: ["active", "disabled"] },
			installed_at: { type: "number" },
			update_time: { type: "number" },
		},
	},
};

const status = {
	// 启停某个企业的一个应用。停用是安全动作：企业整体停用时同步吊销其会话（见 admin.ts）。
	async post() {
		await respond(async () => {
			await assertSuperAdmin();
			const body = (http.body ?? {}) as { corpId?: unknown, agentId?: unknown, status?: unknown };
			const corpId = String(body.corpId ?? "").trim();
			const agentId = String(body.agentId ?? "").trim();
			const next = String(body.status ?? "").trim();
			if (!corpId || !agentId)
				throw Object.assign(new Error("缺少企业代码或应用 id"), { status: 400 });
			if (next !== "active" && next !== "disabled")
				throw Object.assign(new Error("status 只能是 active 或 disabled"), { status: 400 });

			const result = await setAppStatus(corpId, agentId, next, {
				client: createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }),
				// 只有 update_time 用到 now，加解密用不上：这里给空实现，避免为一个时间戳去读部署常量
				store: { encrypt: () => "", decrypt: () => "", now: () => Math.floor(Date.now() / 1000) },
			});
			await recordOp({
				action: next === "active" ? "wecom.admin.enable" : "wecom.admin.disable",
				module: "auth",
				target: corpId,
				detail: { agentId, revokedSessions: result.revokedSessions },
				// 停用是断人访问的动作，按安全事件留痕（与 cancel_auth 同级）
				level: next === "active" ? 2 : 4,
			});
			return result;
		});
	},
};
status.post.schema = {
	body: {
		type: "object",
		required: ["corpId", "agentId", "status"],
		properties: {
			corpId: { type: "string", minLength: 1 },
			agentId: { type: "string", minLength: 1 },
			status: { type: "string", enum: ["active", "disabled"] },
		},
	},
};
status.post.response = {
	type: "object",
	required: ["updated", "revokedSessions"],
	properties: {
		updated: { type: "number" },
		revokedSessions: { type: "number" },
	},
};

const install = {
	// 开通入口（代开发）：provider_access_token → get_customized_auth_url → qrcode_url。
	// 该接口**只**对代开发开放（第三方应用那个 get_pre_auth_code 对代开发报 48002）；
	// 链接有效期以企微返回为准，故不缓存，每次点都重新换。顺带回「指令回调 URL」——
	// 服务商后台要把它逐字填进企微「代开发」配置页。
	async get() {
		await respond(async () => {
			await assertSuperAdmin();
			const cfg = readWecomConfig();
			const state = String((http.query as Record<string, unknown>)?.state ?? "").trim();
			return createInstall(
				cfg,
				createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }),
				state,
			);
		});
	},
};
install.get.response = {
	type: "object",
	required: ["installUrl", "callbackUrl", "expiresIn"],
	properties: {
		installUrl: { type: "string" },
		callbackUrl: { type: "string" },
		expiresIn: { type: "number" },
	},
};

export default { apps: { get }, status, install };
