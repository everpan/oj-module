// 代开发后台（服务商运营面）的领域逻辑：企业应用清单、启停、开通入口。
//
// 三个反常识点，都是踩过的坑：
//   1. **不读部署常量也能停用**：`wecom_base_url` 配错时正是最需要「先把这个企业停掉」的时刻，
//      所以清单与启停都不依赖 `readWecomConfig`，只有开通入口要（它得调企微换预授权码）。
//   2. **不能用 `asTenant` 清会话**：管理员请求自带自己的租户头（多半是 `default`），
//      而 `asTenant` 只能在「请求还没有租户」时调用，否则抛错。故吊销目标企业会话走带
//      `tenant_id = ?` 的裸 SQL（守卫是 check-on-miss，带了租户条件即放行）。
//   3. **停用单个应用 ≠ 停用企业**：会话是按租户（= 企业）发的，一个企业可能有测试/正式两个应用。
//      只有该企业**再没有启用中的应用**时才吊销会话——否则停用测试应用会把正式环境的人踢下线。
import type { WecomClient } from "./client";
import type { WecomConfig } from "./config";
import type { WecomStoreDeps } from "./store";
import { invalidateAllUsers } from "#/_platform/_shared/service/infra/access";
import { eventUrlOf, installUrlOf } from "./config";
import { getSuiteTicket, tenantOfCorp } from "./store";

export interface WecomAdminDeps {
	client: WecomClient
	store: WecomStoreDeps
}

/** 清单行：不含 `permanent_code_enc`（secret 不出库，连超级管理员也不给看） */
export interface AppRow {
	suite_id: string
	corp_id: string
	agent_id: string
	auth_corp_id: string
	env: string
	corp_name: string | null
	status: string
	installed_at: number
	update_time: number
}

export async function listApps(): Promise<AppRow[]> {
	const rows = await db.table("wecom_app_profile")
		.select(["suite_id", "corp_id", "agent_id", "auth_corp_id", "env", "corp_name", "status", "installed_at", "update_time"])
		.all() as unknown as AppRow[];
	// 稳定序：先按企业、再按应用；同企业多环境并排，运维一眼能看出「哪两个是同一家」
	return rows.sort((a, b) => a.corp_id.localeCompare(b.corp_id) || a.agent_id.localeCompare(b.agent_id));
}

export interface StatusResult {
	/** 影响行数（0 = 该企业没开通这个应用） */
	updated: number
	/** 本次顺带吊销的 refresh token 数（0 = 还有别的应用在用，或本来就没有会话） */
	revokedSessions: number
}

/**
 * 启用/停用某个企业的某个应用。
 * 停用语义包含「不再发放新 token 且旧 refresh 失效（当企业整体停用时）」——授权与会话必须同频。
 */
export async function setAppStatus(
	corpId: string,
	agentId: string,
	status: "active" | "disabled",
	deps: WecomAdminDeps,
): Promise<StatusResult> {
	const scope = {
		and: [
			{ or: [{ field: "corp_id", op: "eq", value: corpId }, { field: "auth_corp_id", op: "eq", value: corpId }] },
			{ field: "agent_id", op: "eq", value: agentId },
		],
	};
	const updated = Number(await db.table("wecom_app_profile").update({ status, update_time: deps.store.now() }).where(scope).run());
	if (!updated)
		throw Object.assign(new Error("该企业未开通此应用（或企业代码/应用 id 不匹配）"), { status: 404 });

	// secret 可能仍在另一状态被缓存：无论启停都先让企业 token 失效，下一次登录重新换
	await deps.client.invalidateCorpToken(corpId, agentId);
	if (status === "active")
		return { updated, revokedSessions: 0 };

	const others = await db.table("wecom_app_profile").select(["agent_id"]).where({
		and: [
			{ or: [{ field: "corp_id", op: "eq", value: corpId }, { field: "auth_corp_id", op: "eq", value: corpId }] },
			{ field: "status", op: "eq", value: "active" },
		],
	}).all();
	if (others.length)
		return { updated, revokedSessions: 0 };

	const revoked = Number(await db.exec("DELETE FROM sys_refresh_token WHERE tenant_id = ?", [tenantOfCorp(corpId)]));
	invalidateAllUsers();
	return { updated, revokedSessions: revoked };
}

export interface InstallResult {
	installUrl: string
	/** 企微后台「指令回调 URL」应填这个（逐字） */
	callbackUrl: string
	expiresIn: number
}

/** 生成开通入口：suite_access_token → 预授权码 → install URL（企业管理员点开即进入授权安装向导） */
export async function createInstall(
	cfg: WecomConfig,
	client: WecomClient,
	store: WecomStoreDeps,
	state: string,
): Promise<InstallResult> {
	const ticket = await getSuiteTicket(cfg.suiteId, store);
	const token = await client.suiteAccessToken(cfg.suiteId, cfg.suiteSecret, ticket.ticket);
	const pre = await client.preAuthCode(token);
	return {
		installUrl: installUrlOf(cfg, pre.code, state),
		callbackUrl: eventUrlOf(cfg),
		expiresIn: pre.expiresIn,
	};
}
