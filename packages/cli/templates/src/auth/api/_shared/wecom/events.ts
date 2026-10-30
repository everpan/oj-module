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
// 响应纪律：处理完返回（路由回纯文本 success）。企微 5 秒内拿不到 success 会重推三次；
// 重推对我们是幂等的（profile upsert / ticket 覆盖），但 AuthCode 一次有效，重推时已换取过 → 502，
// 属预期（日志留痕即可，不影响已落库的 profile）。
import { invalidateAllUsers } from "#/_platform/_shared/service/infra/access";
import { recordOp } from "#/_platform/_shared/service/infra/audit";
import { ensureTenant, getSuiteTicket, putSuiteTicket, saveProfile, setProfileStatus, tenantOfCorp } from "./store";
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

/** 该 corp 的所有应用都标记为停用，并吊销其租户下的全部会话 */
async function disableCorp(corpId: string, deps: SuiteEventDeps): Promise<void> {
	const rows = await db.table("wecom_app_profile").select(["agent_id"]).where({
		or: [
			{ field: "corp_id", op: "eq", value: corpId },
			{ field: "auth_corp_id", op: "eq", value: corpId },
		],
	}).all() as Array<{ agent_id: string }>;
	for (const r of rows)
		await deps.client.invalidateCorpToken(corpId, String(r.agent_id));
	await setProfileStatus(corpId, "disabled", deps.store);
	// 会话必须与授权同频：解绑后旧 refresh 串不得继续换新 access token。
	// truncate 在租户表上只清当前租户（oj 契约），故先绑租户再清。
	ensureTenant(tenantOfCorp(corpId));
	await db.table("sys_refresh_token").truncate().run();
	invalidateAllUsers();
}

/** AuthCode → permanent_code → 按 agent 逐个 upsert profile（幂等；同一企业多应用各自一行） */
async function applyAuthCode(authCode: string, state: string | null, deps: SuiteEventDeps): Promise<{ corpId: string, agentIds: string[] }> {
	const { cfg, client, store } = deps;
	const suiteTicket = await getSuiteTicket(cfg.suiteId, store);
	const suiteToken = await client.suiteAccessToken(cfg.suiteId, cfg.suiteSecret, suiteTicket.ticket);
	const granted = await client.permanentCodeByAuthCode(suiteToken, authCode);
	const env = envOfState(state ?? granted.state);
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
	await recordOp({ action: "wecom.auth.apply", module: "auth", target: granted.corpId, detail: { agentIds: granted.agentIds, env } });
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
			await recordOp({ action: "wecom.auth.cancel", module: "auth", target: authCorpId, level: 4 });
			log.warn("wecom auth cancelled", "corpId", authCorpId);
			return infoType;
		}
		default:
			// 通讯录变更等事件本模块不消费：记账即可，回 success 让企微别再推
			log.info("wecom event ignored", "infoType", infoType);
			return infoType;
	}
}
