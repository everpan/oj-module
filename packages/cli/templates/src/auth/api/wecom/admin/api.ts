// 企微后台：GET /auth/wecom/admin/apps · POST /auth/wecom/admin/status · GET /auth/wecom/admin/install
//          · GET /auth/wecom/admin/overview · POST /auth/wecom/admin/connect
//
// 权限：仅超级管理员（`assertSuperAdmin`）。这几件事都是**跨租户**的站点级操作
// （看所有已授权企业、停用某企业、生成安装链接、把本企业自建应用接进来），不是某个租户的
// 管理员能做的；用 `assertSystemAdmin` 会把 admin 也放进来，而 admin 属于某个租户，
// 等于让他看别家企业的 corp_id。
//
// 这些端点都不挂在 `tenant.anonymous_paths` 里：它们是正常登录后的管理面，必须带租户头，
// 也就不会走 `db.asTenant`（见 _shared/wecom/admin.ts 头注释第 2 点）。
import { respond } from "#/_platform/_shared/respond";
import { assertSuperAdmin } from "#/_platform/_shared/service/infra/access";
import { recordOp } from "#/_platform/_shared/service/infra/audit";
import { connectCorp, createInstall, listApps, setAppStatus } from "../../_shared/wecom/admin";
import { createWecomClient, runtimeCache, runtimeHttp } from "../../_shared/wecom/client";
import { configuredKinds, corpIdentity, eventUrlOf, readBase, readCorpConfig, readSuiteConfig, wecomKinds } from "../../_shared/wecom/config";
import { runtimeStoreDeps } from "../../_shared/wecom/store";

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
		required: ["suite_id", "corp_id", "agent_id", "auth_corp_id", "env", "status", "credential_kind", "auth_mode", "installed_at", "update_time"],
		properties: {
			suite_id: { type: "string" },
			corp_id: { type: "string" },
			agent_id: { type: "string" },
			auth_corp_id: { type: "string" },
			env: { type: "string" },
			corp_name: { type: ["string", "null"] },
			status: { type: "string", enum: ["active", "disabled"] },
			// 来源：代开发 / 企业内部应用（自建）。同一家企业可能两行都有（迁移期）
			credential_kind: { type: "string", enum: ["suite", "corp"] },
			// 权限三态（管理员授权 / 成员授权）——服务商一眼看出哪家企业「装了但同步不了」；自建行恒 0
			auth_mode: { type: "number" },
			installed_at: { type: "number" },
			update_time: { type: "number" },
		},
	},
};

const overview = {
	/**
	 * 部署概览：后台页据此决定画哪几张卡片、回调地址填什么。
	 *
	 * `configError` 而不是直接 400：配错时最需要页面把「配了什么、缺什么」摆出来，
	 * 抛错只会让管理员看到一片空白加一行红字。
	 *
	 * 形态必须是 `{ get }` 组而不是裸函数：oj 的路由表按「组名 = 路径段 + 动词」生成，
	 * 根层裸函数不产生路由（`ojm api --check` 会报「oj 树缺少 handler」）。
	 */
	async get() {
		await respond(async () => {
			await assertSuperAdmin();
			let configError: string | null = null;
			try {
				wecomKinds();
			}
			catch (e) {
				configError = (e as Error).message;
			}
			let callbackUrl: string | null = null;
			try {
				callbackUrl = eventUrlOf(readBase());
			}
			catch {
				// 基址没配：页面要能把「还差 wecom_base_url」显示出来，而不是整页失败
				callbackUrl = null;
			}
			const self = corpIdentity();
			return {
				kinds: configuredKinds(),
				configError,
				callbackUrl,
				corpId: self?.corpId ?? null,
				agentId: self?.agentId ?? null,
				corpCallbackConfigured: self?.hasCallback ?? false,
			};
		});
	},
};
overview.get.response = {
	type: "object",
	required: ["kinds", "configError", "callbackUrl", "corpId", "agentId", "corpCallbackConfigured"],
	properties: {
		kinds: { type: "array", items: { type: "string", enum: ["suite", "corp"] } },
		// 部署配置自检的结论（null = 无问题）：共存没显式开启、两套都缺等
		configError: { type: ["string", "null"] },
		// 回调地址：代开发填「指令回调」，自建填「通讯录同步 → 接收事件服务器」，同一个 URL
		callbackUrl: { type: ["string", "null"] },
		corpId: { type: ["string", "null"] },
		agentId: { type: ["string", "null"] },
		// 自建应用的回调凭据是否配齐（不配 = 没有事件增量，全量同步照常）
		corpCallbackConfigured: { type: "boolean" },
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
			const cfg = readSuiteConfig();
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

const connect = {
	// 自建应用没有 `create_auth` 回调：档案行只能由这里显式写入（四步校验全过才落库，见 admin.ts）。
	// 幂等：重复点 = 重写密文 + 清 token 缓存——**换过 Secret 必须重新点**，页面要把这句写出来。
	// 没配 corp 凭据的部署点这里直接 400：不写「空 suite_id 的怪档案」，那会让清单多一行查不出用途的行。
	async post() {
		await respond(async () => {
			await assertSuperAdmin();
			if (!configuredKinds().includes("corp"))
				throw Object.assign(new Error("本部署未配置企业内部应用凭据（wecom_corp_id / wecom_corp_secret / wecom_corp_agent_id）"), { status: 400 });
			const cfg = readCorpConfig();
			const result = await connectCorp(
				cfg,
				createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }),
				runtimeStoreDeps(cfg),
			);
			await recordOp({
				action: "wecom.admin.connect",
				module: "auth",
				target: result.corpId,
				detail: { agentId: result.agentId, departments: result.departments, members: result.members },
				// 接入 = 建立一条新的身份来源，属站点级配置变更
				level: 2,
			});
			return result;
		});
	},
};
connect.post.response = {
	type: "object",
	required: ["corpId", "agentId", "departments", "members"],
	properties: {
		corpId: { type: "string" },
		agentId: { type: "string" },
		// 可见范围内的部门数：远小于预期 = 应用可见范围没设全公司
		departments: { type: "number" },
		// 示例部门读到的人数：0 不会返回（校验失败），>0 才是「通讯录权限真的通了」
		members: { type: "number" },
	},
};

export default { apps: { get }, overview, status, install, connect };
