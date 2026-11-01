import type { WecomClient } from "./client";
import type { WecomConfig } from "./config";
import type { WecomStoreDeps } from "./store";
// 企微「指令回调」事件处理：suite_ticket / create_auth / change_auth / cancel_auth /
// reset_permanent_code（代开发重置 secret 走后者）。
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
import { corpScope, ensureTenant, getSuiteTicket, putSuiteTicket, revokeTenantSessions, saveProfile, setProfileStatus, tenantOfCorp } from "./store";
import { xmlField } from "./xml";

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

function requireField(xml: string, name: string, infoType: string): string {
	const value = xmlField(xml, name);
	if (!value)
		throw Object.assign(new Error(`企微事件 ${infoType} 缺少 ${name}`), { status: 400 });
	return value;
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

/** 该 corp 的所有应用都标记为停用，并吊销其租户下的全部会话 */
async function disableCorp(corpId: string, deps: SuiteEventDeps): Promise<void> {
	// 取消授权同样是匿名回调：会话清理走裸 SQL，`sql_guard: deny` 下没有租户上下文会被拒——
	// 而这里拒掉的后果是「旧 refresh 串仍能续命」，属安全红线，故必须绑成功再往下走。
	ensureTenant(tenantOfCorp(corpId));
	const rows = await db.table("wecom_app_profile").select(["agent_id"]).where(corpScope(corpId)).all() as Array<{ agent_id: string }>;
	for (const r of rows)
		await deps.client.invalidateCorpToken(corpId, String(r.agent_id));
	await setProfileStatus(corpId, "disabled", deps.store);
	// 会话必须与授权同频：解绑后旧 refresh 串不得继续换新 access token。
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
			permanentCode: granted.permanentCode,
		}, store);
		// secret 可能已轮换：旧 token 必须立刻作废，否则下一个登录会带着失效 token 打 userinfo
		await client.invalidateCorpToken(granted.corpId, agentId);
	}
	await auditAuth("wecom.auth.apply", granted.corpId, { agentIds: granted.agentIds, env });
	return { corpId: granted.corpId, agentIds: granted.agentIds };
}

/** 处理一条已验签并解密的回调明文；返回值仅用于日志（未知 InfoType 也回 success，不触发重推） */
export async function handleSuiteEvent(plaintext: string, deps: SuiteEventDeps): Promise<string> {
	const infoType = xmlField(plaintext, "InfoType") ?? "";
	const suiteId = xmlField(plaintext, "SuiteId") ?? "";
	if (suiteId && suiteId !== deps.cfg.suiteId)
		throw Object.assign(new Error("企微事件 SuiteId 与本部署配置不一致"), { status: 400 });

	switch (infoType) {
		case "suite_ticket": {
			const ticket = requireField(plaintext, "SuiteTicket", infoType);
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
			const authCode = requireField(plaintext, "AuthCode", infoType);
			const applied = await applyAuthCode(authCode, xmlField(plaintext, "State"), deps);
			log.info("wecom auth applied", "event", infoType, "corpId", applied.corpId, "agents", applied.agentIds.join(","));
			return infoType;
		}
		case "change_auth": {
			// 可见范围/权限/启停变化：MVP 只做「数据可见性不加码」——不改状态、不动 secret，
			// 靠下次登录重新走 userinfo（企微会拒掉已移出可见范围的成员）。停用/解绑走 cancel_auth。
			const authCorpId = requireField(plaintext, "AuthCorpId", infoType);
			log.info("wecom auth changed", "corpId", authCorpId);
			return infoType;
		}
		case "cancel_auth": {
			const authCorpId = requireField(plaintext, "AuthCorpId", infoType);
			await disableCorp(authCorpId, deps);
			await auditAuth("wecom.auth.cancel", authCorpId, undefined, 4);
			log.warn("wecom auth cancelled", "corpId", authCorpId);
			return infoType;
		}
		default:
			// 通讯录变更等事件本模块不消费：记账即可，回 success 让企微别再推
			log.info("wecom event ignored", "infoType", infoType);
			return infoType;
	}
}
