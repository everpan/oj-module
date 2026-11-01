// 企微后台（服务商运营面 + 自建应用接入面）：企业应用清单、启停、开通入口、验证并接入。
//
// 四个反常识点，都是踩过的坑：
//   1. **不读部署常量也能停用**：`wecom_base_url` 配错时正是最需要「先把这个企业停掉」的时刻，
//      所以清单与启停都不依赖 `readSuiteConfig`，只有开通入口要（它得调企微换预授权码）。
//   2. **不能用 `asTenant` 清会话**：管理员请求自带自己的租户头（多半是 `default`），
//      而 `asTenant` 只能在「请求还没有租户」时调用，否则抛错。故吊销目标企业会话走带
//      `tenant_id = ?` 的裸 SQL（守卫是 check-on-miss，带了租户条件即放行）。
//   3. **停用单个应用 ≠ 停用企业**：会话是按租户（= 企业）发的，一个企业可能有测试/正式两个应用。
//      只有该企业**再没有启用中的应用**时才吊销会话——否则停用测试应用会把正式环境的人踢下线。
import type { WecomClient } from "./client";
import type { WecomConfig, WecomCorpConfig, WecomKind } from "./config";
import type { WecomStoreDeps } from "./store";
import { invalidateAllUsers } from "#/_platform/_shared/service/infra/access";
import { assertProviderConfig, eventUrlOf } from "./config";
import { provisionTenantAdmin } from "./tenant-admin";
import { corpScope, revokeTenantSessions, saveProfile, tenantOfCorp } from "./store";

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
	/** 应用来源：suite=代开发 / corp=企业内部应用（自建） */
	credential_kind: WecomKind
	/** 0=管理员授权 / 1=成员授权：成员授权下这家企业的应用做不了组织架构同步（§2.3）；自建行恒 0 */
	auth_mode: number
	installed_at: number
	update_time: number
}

export async function listApps(): Promise<AppRow[]> {
	const rows = await db.table("wecom_app_profile")
		.select(["suite_id", "corp_id", "agent_id", "auth_corp_id", "env", "corp_name", "status", "credential_kind", "auth_mode", "installed_at", "update_time"])
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
			corpScope(corpId),
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
			corpScope(corpId),
			{ field: "status", op: "eq", value: "active" },
		],
	}).all();
	if (others.length)
		return { updated, revokedSessions: 0 };

	const revoked = await revokeTenantSessions(tenantOfCorp(corpId));
	invalidateAllUsers();
	return { updated, revokedSessions: revoked };
}

export interface InstallResult {
	/** 开通链接（代开发 = `get_customized_auth_url` 返回的 qrcode_url，企业管理员扫/开即授权） */
	installUrl: string
	/** 企微后台「指令回调 URL」应填这个（逐字） */
	callbackUrl: string
	/** 链接有效期（秒，以企微返回为准，可达 10 天） */
	expiresIn: number
}

/**
 * 生成开通入口（代开发）：provider_access_token → get_customized_auth_url → qrcode_url。
 * 与第三方应用的「预授权码拼安装链接」不是一个接口——代开发**不支持** get_pre_auth_code
 * （errcode 48002），必须用这个。授权完成由企微回调 create_auth 落库，与这里无关。
 */
export async function createInstall(
	cfg: WecomConfig,
	client: WecomClient,
	state: string,
): Promise<InstallResult> {
	assertProviderConfig(cfg);
	const providerToken = await client.providerAccessToken(cfg.providerId, cfg.providerSecret);
	const auth = await client.customizedAuthUrl(providerToken, [cfg.suiteId], state);
	return {
		installUrl: auth.url,
		callbackUrl: eventUrlOf(cfg),
		expiresIn: auth.expiresIn,
	};
}

/** 接入校验最多探多少个部门找人（顶层部门常只有子部门，只看第一个会误判「读不到人」） */
const CONNECT_SAMPLE_DEPTS = 10;

export interface ConnectResult {
	corpId: string
	agentId: string
	/** 应用可见范围内的部门数 */
	departments: number
	/** 示例部门里的直属成员数（>0 才说明通讯录权限真的通了） */
	members: number
}

/**
 * 自建应用「验证并接入」：**四步全过才落库**（plan §4.3）。
 *
 * 为什么不能启动时自动写一行：自检失败会变成启动失败，而自建模式最常见的失败是客户还没加可信 IP、
 * 可见范围没配——那是运营动作，不该让服务起不来。所以这一步放在人点的按钮后面。
 *
 * 顺序有讲究：
 *   1. 先**作废 token 缓存**再换 token。换过 Secret 的部署若命中旧缓存，校验会「通过」，
 *      而真正的问题（旧 secret 已失效）会在下一个登录请求上以 40001 冒出来。
 *   2. gettoken 验 secret、department/simplelist 验通讯录读权限、user/simplelist 验能读到人——
 *      这三件事对应三个最容易配错的开关（Secret 抄错 / 可见范围空 / 通讯录权限没给）。
 */
export async function connectCorp(cfg: WecomCorpConfig, client: WecomClient, deps: WecomStoreDeps): Promise<ConnectResult> {
	await client.invalidateCorpToken(cfg.corpId, cfg.agentId);
	await client.corpAccessToken(cfg.corpId, cfg.agentId, cfg.corpSecret);

	const depts = await client.departmentChildren(cfg.corpId, cfg.agentId, cfg.corpSecret);
	if (!depts.length)
		throw Object.assign(new Error("接入校验失败：应用可见范围里没有任何部门（把「应用可见范围」设为全公司，或至少包含一个部门）"), { status: 400 });

	// 顶层部门常常只有子部门、没有直属成员，所以往后再看几个再下结论
	let members = 0;
	for (const d of depts.slice(0, CONNECT_SAMPLE_DEPTS)) {
		members = (await client.deptMembers(cfg.corpId, cfg.agentId, cfg.corpSecret, d.id)).length;
		if (members)
			break;
	}
	if (!members)
		throw Object.assign(new Error("接入校验失败：可见范围内读不到成员（请把应用可见范围扩大到至少一名成员）"), { status: 400 });

	await saveProfile({
		// corp 行没有套件：suite_id 用空串（主键第一段），来源由 credential_kind 表达
		suiteId: "",
		corpId: cfg.corpId,
		authCorpId: cfg.corpId,
		agentId: cfg.agentId,
		env: "prod",
		corpName: null,
		credentialKind: "corp",
		permanentCode: cfg.corpSecret,
		// 自建应用没有「管理员授权 / 成员授权」之分：恒 0，同步闸门据此直接放行
		authMode: 0,
	}, deps);

	// 换过 AgentId 的部署会留下旧应用的活跃行：旧行的 secret 已不可用，留着只会让
	// 「同一企业多应用」的分辨逻辑误判，故随本次接入一并停用。
	const stale = await db.table("wecom_app_profile").select(["agent_id"]).where({
		and: [
			corpScope(cfg.corpId),
			{ field: "credential_kind", op: "eq", value: "corp" },
			{ field: "status", op: "eq", value: "active" },
		],
	}).all() as Array<{ agent_id: string }>;
	for (const r of stale) {
		const old = String(r.agent_id);
		if (old === cfg.agentId)
			continue;
		await db.table("wecom_app_profile").update({ status: "disabled", update_time: deps.now() }).where({
			and: [corpScope(cfg.corpId), { field: "agent_id", op: "eq", value: old }],
		}).run();
		await client.invalidateCorpToken(cfg.corpId, old);
	}
	// 租户具象化：给这个企业配一个本租户的管理员（admin，非 superadmin），否则
	// 该租户里只有 JIT 出来的员工号，没人能做组织架构同步、也没人能在租户内授权。
	await provisionTenantAdmin(cfg.corpId);
	invalidateAllUsers();
	return { corpId: cfg.corpId, agentId: cfg.agentId, departments: depts.length, members };
}
