import type { WecomClient } from "./client";
import type { WecomConfig } from "./config";
import type { WecomStoreDeps } from "./store";
// 企微「指令回调」事件处理：suite_ticket / create_auth / change_auth / cancel_auth /
// reset_permanent_code（代开发重置 secret 走后者），以及轨三的通讯录变更（contacts.ts）。
//
// 为什么这几件事必须由回调驱动（而不是管理端手工录）：
//   · suite_ticket 每 10 分钟推一次、30 分钟过期，拿不到就换不出 suite_access_token，
//     整套「企业授权 → 应用 secret → 企业 token」链路全断；
//   · permanent_code（= 代开发应用的 secret）只在 create_auth / reset_permanent_code 时
//     由 AuthCode 一次性换取，企微后台**不显示**它；
//   · 企业解绑/取消授权只在 cancel_auth 出现。
// 因此这里不是「可选的后台功能」，是代开发模式的下限能力。
//
// 响应纪律：处理完返回（路由回纯文本 success）。企微对 `create_auth` 的窗口是 **约 1 秒**
// （官方文档写 5 秒，实际按 1 秒卡；超时/非 success 一律在企业管理员浏览器上显示
// 「应用安装失败，联系服务商」）。拿不到 success 会重推三次；重推对我们是幂等的
// （profile upsert / ticket 覆盖），但 AuthCode 一次有效，重推时已换取过 → 502，
// 属预期（日志留痕即可，不影响已落库的 profile）。
import { invalidateAllUsers } from "#/_platform/_shared/service/infra/access";
import { recordOp } from "#/_platform/_shared/service/infra/audit";
import { handleContactChange } from "./contacts";
import { callbackFields, field, requireField } from "./payload";
import { provisionTenantAdmin } from "./tenant-admin";
import { corpScope, ensureTenant, findCorpAuth, getSuiteTicket, putSuiteTicket, revokeTenantSessions, saveProfile, setAuthMode, setProfileStatus, tenantOfCorp } from "./store";

/** suite_ticket 官方有效期 30 分钟（10 分钟推一次）；本地按 30 分钟作废，宁可拒一次也不拿过期票打企微 */
const SUITE_TICKET_TTL_SECS = 30 * 60;

export interface SuiteEventDeps {
	cfg: WecomConfig
	client: WecomClient
	store: WecomStoreDeps
}

/** 事件里带的 State（授权链接自定义参数）：只认 `env=xxx` 或裸环境名，其余一律按正式环境 */
export function envOfState(state: string | null): string {
	if (!state)
		return "prod";
	const trimmed = state.trim();
	const kv = /^env=([\w-]+)$/i.exec(trimmed);
	if (kv)
		return kv[1]!.toLowerCase();
	return /^(?:prod|test|staging|dev)$/i.test(trimmed) ? trimmed.toLowerCase() : "prod";
}

/**
 * 事件路径的审计。两处纪律：
 *   1. 调用前必须先 `ensureTenant(corp)`——`sys_oplog` 是租户表，本端点又是匿名路径（企微带不了
 *      `X-TENANT-ID`），`sql_guard: deny` 下不带租户上下文的 insert 会被守卫直接拒；
 *   2. 审计失败**只告警**：它发生在 profile 已落库之后，一次成功的授权不能因为写日志失败
 *      变成企业管理员看到的「应用安装失败」。
 */
async function auditAuth(action: string, corpId: string, detail?: unknown, level?: number): Promise<void> {
	try {
		await recordOp({ action, module: "auth", target: corpId, detail, level });
	}
	catch (e) {
		log.warn("wecom auth audit skipped", "action", action, "corpId", corpId, "reason", (e as Error).message);
	}
}

/** 该 corp 的代开发应用全部标记为停用；**只有该企业再没有启用中的应用时才吊销会话 */
async function disableCorp(corpId: string, deps: SuiteEventDeps): Promise<void> {
	// 取消授权同样是匿名回调：会话清理走裸 SQL，`sql_guard: deny` 下没有租户上下文会被拒——
	// 而这里拒掉的后果是「旧 refresh 串仍能续命」，属安全红线，故必须绑成功再往下走。
	ensureTenant(tenantOfCorp(corpId));
	// 只取 suite 行：共存部署里同一家企业可能还有自建应用，cancel_auth 与它无关（C4）
	const rows = await db.table("wecom_app_profile").select(["agent_id"]).where({
		and: [corpScope(corpId), { field: "credential_kind", op: "eq", value: "suite" }],
	}).all() as Array<{ agent_id: string }>;
	for (const r of rows)
		await deps.client.invalidateCorpToken(corpId, String(r.agent_id));
	await setProfileStatus(corpId, "disabled", deps.store, "suite");
	await revokeOrKeep(corpId);
}

/**
 * 会话与授权同频：解绑后旧 refresh 串不得继续换新 access token。
 * 但「还有别的应用在用」时不吊销（同 `admin.ts::setAppStatus` 的语义）——否则取消代开发授权
 * 会把同一家企业自建应用的在线用户一起踢下线。
 */
async function revokeOrKeep(corpId: string): Promise<void> {
	const still = await db.table("wecom_app_profile").select(["agent_id"]).where({
		and: [corpScope(corpId), { field: "status", op: "eq", value: "active" }],
	}).all();
	if (still.length)
		return;
	// tenant 条件写死在 SQL 里（不用 truncate：它的清理范围取决于本请求是否已绑过租户），
	// 取消授权回调是匿名端点，不该依赖那种隐式前提。
	await revokeTenantSessions(tenantOfCorp(corpId));
	invalidateAllUsers();
}

/** AuthCode → permanent_code → 按 agent 逐个 upsert profile（幂等；同一企业多应用各自一行） */
async function applyAuthCode(authCode: string, state: string | null, deps: SuiteEventDeps): Promise<{ corpId: string, agentIds: string[] }> {
	const { cfg, client, store } = deps;
	const suiteTicket = await getSuiteTicket(cfg.suiteId, store);
	const suiteToken = await client.suiteAccessToken(cfg.suiteId, cfg.suiteSecret, suiteTicket.ticket);
	const granted = await client.permanentCodeByAuthCode(suiteToken, authCode);
	const env = envOfState(state ?? granted.state);
	// 拿到企业身份就绑租户：profile 表虽共享，但其后的审计与后续写库都在这个租户下。
	// 顺序不能挪到审计里——那样 saveProfile 之后才发现守卫拒，profile 已落库却回失败。
	ensureTenant(tenantOfCorp(granted.corpId));
	for (const agentId of granted.agentIds) {
		await saveProfile({
			suiteId: cfg.suiteId,
			corpId: granted.corpId,
			authCorpId: granted.corpId,
			agentId,
			env,
			corpName: granted.corpName,
			// 来源由这一条路径决定：能走到 create_auth 的只可能是代开发
			credentialKind: "suite",
			permanentCode: granted.permanentCode,
			authMode: granted.authModes[agentId] ?? 0,
		}, store);
		// secret 可能已轮换：旧 token 必须立刻作废，否则下一个登录会带着失效 token 打 userinfo
		await client.invalidateCorpToken(granted.corpId, agentId);
	}
	// 租户具象化：代开发企业授权成功即配一个本租户管理员（尽力而为，绝不拖垮 1 秒回调窗口）
	await provisionTenantAdmin(granted.corpId);
	await auditAuth("wecom.auth.apply", granted.corpId, { agentIds: granted.agentIds, env });
	return { corpId: granted.corpId, agentIds: granted.agentIds };
}

/**
 * `change_auth` 后复核授权模式并落库。
 *
 * 失败**只告警**：回调窗口 1 秒，一次上游抖动不该把通知打成失败（重推也补不回被误判的
 * 授权模式，反而让企业管理员看到「配置失败」）。代价是 auth_mode 短期仍是旧值，
 * 同步闸门那侧还有 60011 兜底（见 sync 的 permission 分支）。
 */
async function refreshAuthModes(corpId: string, deps: SuiteEventDeps): Promise<void> {
	try {
		// 只对 suite 行成立：自建应用没有「授权模式」这个概念，给它刷 auth_mode 只会写脏数据（C5）
		const auth = await findCorpAuth(corpId, deps.store, "suite");
		if (!auth)
			return;
		const ticket = await getSuiteTicket(deps.cfg.suiteId, deps.store);
		const suiteToken = await deps.client.suiteAccessToken(deps.cfg.suiteId, deps.cfg.suiteSecret, ticket.ticket);
		const modes = await deps.client.authModesByPermanentCode(suiteToken, corpId, auth.permanentCode);
		for (const agentId of auth.agentIds) {
			const mode = modes[agentId];
			if (mode == null)
				continue;
			await setAuthMode(corpId, agentId, mode, deps.store);
			log.info("wecom auth_mode refreshed", "corpId", corpId, "agentId", agentId, "authMode", mode);
		}
	}
	catch (e) {
		log.warn("wecom auth_mode refresh skipped", "corpId", corpId, "reason", (e as Error).message);
	}
}

/** 处理一条已验签并解密的回调明文；返回值仅用于日志（未知 InfoType 也回 success，不触发重推） */
export async function handleSuiteEvent(payload: unknown, deps: SuiteEventDeps): Promise<string> {
	// 入参是「原始报文」（对象 / JSON 串 / XML 串都行，见 payload.ts）；归一化只在这里做一次，
	// 往下全是字段名，函数体里再也看不到格式。
	const fields = callbackFields(payload);
	const infoType = field(fields, "InfoType");
	const suiteId = field(fields, "SuiteId");
	if (suiteId && suiteId !== deps.cfg.suiteId)
		throw Object.assign(new Error("企微事件 SuiteId 与本部署配置不一致"), { status: 400 });

	// 通讯录变更（轨三）：**必须在 switch 之前分流**。两种形态都认——
	// 应用侧数据回调是 `MsgType=event` + `Event=change_contact`（InfoType 为空），
	// 代开发指令回调是 `InfoType=change_contact`；后者与 suite_ticket 同用 InfoType 这一列，
	// 落进 default 只会被记成「不消费的事件」。
	// 与下面几个分支的不同：通讯录事件失败**不抛**（事件是加速器，重推补不回来，见 contacts.ts）。
	if (field(fields, "Event") === "change_contact" || infoType === "change_contact")
		return await handleContactChange(fields, { client: deps.client, store: deps.store, credentialKind: "suite" });

	switch (infoType) {
		case "suite_ticket": {
			const ticket = requireField(fields, "SuiteTicket", infoType);
			await putSuiteTicket(deps.cfg.suiteId, ticket, deps.store.now() + SUITE_TICKET_TTL_SECS, deps.store);
			log.info("wecom suite_ticket updated", "suiteId", deps.cfg.suiteId);
			// 顺势换一次 suite_access_token（命中缓存则 0 次往返）：create_auth 只有约 1 秒窗口，
			// 这里先换掉，企业管理员扫码那条路径就只剩 get_permanent_code 一次出网。
			// 副产品：suite_secret 配错会在票据推送时就进日志，而不是等某家企业扫码失败。
			await deps.client.suiteAccessToken(deps.cfg.suiteId, deps.cfg.suiteSecret, ticket)
				.catch((e: Error) => log.warn("wecom suite token warmup failed", "reason", e.message));
			return infoType;
		}
		case "create_auth":
		case "reset_permanent_code": {
			const authCode = requireField(fields, "AuthCode", infoType);
			const applied = await applyAuthCode(authCode, field(fields, "State") || null, deps);
			log.info("wecom auth applied", "event", infoType, "corpId", applied.corpId, "agents", applied.agentIds.join(","));
			return infoType;
		}
		case "change_auth": {
			// 可见范围/权限/启停变化。其中**「管理员授权 ⇄ 成员授权」切换**必须跟：切到成员授权后
			// 部门接口一律 60011，同步闸门还按旧值放行就会一直 502。官方要求服务商自行调
			// `get_auth_info` 复核——通知本身只带 AuthCorpId（没有 AuthCode），只能拿已存永久码反查。
			// 其余变化（可见范围收窄等）仍是「下次登录重新走 userinfo」，不在回调里处理。
			const authCorpId = requireField(fields, "AuthCorpId", infoType);
			ensureTenant(tenantOfCorp(authCorpId));
			await refreshAuthModes(authCorpId, deps);
			log.info("wecom auth changed", "corpId", authCorpId);
			return infoType;
		}
		case "cancel_auth": {
			const authCorpId = requireField(fields, "AuthCorpId", infoType);
			await disableCorp(authCorpId, deps);
			await auditAuth("wecom.auth.cancel", authCorpId, undefined, 4);
			log.warn("wecom auth cancelled", "corpId", authCorpId);
			return infoType;
		}
		default: {
			// 余下的事件（标签变更、外部联系人等）本模块不消费：记账即可，回 success 让企微别再推。
			//
			// 记账要记够「这条报文能不能用」的量：指令回调（有 InfoType）与数据回调
			// （`MsgType=event` + `Event=xxx`，没有 InfoType）走的是同一个 `/event`，
			// 而两者的 Token/AESKey 未必是同一套。真机验形态时只凭 InfoType 为空无法区分
			// 「收到了一条事件」与「收到了一条别的消息」，所以把 Event 与字段清单一起记下。
			// **只记字段名不记值**：明文里有姓名与工号。
			const eventName = field(fields, "Event");
			log.info(
				"wecom event ignored",
				"infoType",
				infoType,
				"msgType",
				field(fields, "MsgType"),
				"event",
				eventName,
				"fields",
				fields.names.join(","),
			);
			return eventName || infoType;
		}
	}
}
