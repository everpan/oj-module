// 企微三张表 + 租户上下文的持久化面（全部走构造器，交给 sql_guard 管租户）。
//
// 表定性（与 schema.yaml / config.shared_allow 三处一致）：
//   wecom_app_profile / wecom_suite_ticket / wecom_login_ticket 均 `tenant: false`（D9）——
//   它们本身就是「corp → 租户」的映射权威与套件级凭证，查它们的时候必然还没有租户上下文。
//   共享 = 不受守卫约束，故只放映射/凭证/一次性票据，不放任何租户业务数据。
//
// permanent_code（= 代开发应用的 secret，全 corp 数据权限）只以 AES-GCM 密文落库（§7.5），
// 加解密经 deps 注入：Node 侧测试用假实现，运行时走 crypto.aesGcmEncrypt/Decrypt。
import type { WecomConfig } from "./config";

export interface WecomStoreDeps {
	encrypt: (plain: string) => string
	decrypt: (blob: string) => string
	now: () => number
}

export interface AppProfile {
	suiteId: string
	/** 真实企业 ID（get_permanent_code 的 auth_corp_info.corpid）：登录 URL 里的「企业代码」即它 */
	corpId: string
	/** 企微事件里的 AuthCorpId（第三方应用体系下可能是 open_corpid，故与 corp_id 分列存） */
	authCorpId: string
	agentId: string
	/** 测试/正式等部署标签（D5：只作标签，不参与主键） */
	env: string
	corpName: string | null
	status: "active" | "disabled"
	permanentCode: string
}

/** 套件票据：企微每 10 分钟推一次，有效期 30 分钟；过期不得发起任何套件级 API 调用 */
export interface SuiteTicket {
	ticket: string
	expiresAt: number
}

export interface LoginTicketRow {
	uid: number
	/** 票据所属租户（列名 `owner_tenant`：共享表不声明 tenant_id，见 migration 头注释） */
	ownerTenant: string
}

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

/**
 * 把请求绑到指定租户（L2 的第四层）：浏览器 302 回调带不了自定义头 → 请求是匿名态，
 * 用 db.asTenant(服务端推导值) 补身份。已带头则只做一致性复核（不符即伪造，403）。
 * 注意 asTenant 是**请求级且只能设一次**（oj 手册），故这里不重复调用。
 */
export function ensureTenant(tenantId: string): void {
	const current = http.tenantId;
	if (current == null || current === "") {
		db.asTenant(tenantId);
		return;
	}
	if (current !== tenantId)
		fail(403, "tenant header does not match the authenticated tenant");
}

/** 企微回调推导出来的租户键：直接就是企业 ID（D10：企业代码=corp_id，故 URL/头/隔离列三者同值） */
export function tenantOfCorp(corpId: string): string {
	return corpId;
}

/**
 * 企业匹配谓词（corp_id 与 auth_corp_id 双列等价命中：代开发拿到的是 corp_id，
 * 第三方/open_corpid 落到 auth_corp_id）。
 * 抽取理由：清单 / 启停 / 停企业三处原本各写一份 `or: [...]`，任一处漏一列的表现都是
 * 「某类企业查不到」，而它只在真实第三方身份下才出现。
 */
export function corpScope(corpId: string) {
	return {
		or: [
			{ field: "corp_id", op: "eq", value: corpId },
			{ field: "auth_corp_id", op: "eq", value: corpId },
		],
	};
}

/** 企业 + 应用（profile 主键的两段：一次授权多家应用时按 agent 逐个命中） */
export function corpAgentScope(corpId: string, agentId: string) {
	return {
		and: [
			corpScope(corpId),
			{ field: "agent_id", op: "eq", value: agentId },
		],
	};
}

/**
 * 吊销某租户的全部会话（refresh token）。
 *
 * 用带 `tenant_id` 的裸 SQL 而不是 `truncate()`：后者靠「守卫自动注入当前租户」生效，
 * 而 `db.asTenant` 一次请求只能设一次、且要求当时还没租户——本次请求是否处于匿名态
 * 决定了 truncate 的清理范围，边界交给了上游实现。条件写死在 SQL 里，范围自带。
 */
export async function revokeTenantSessions(tenantId: string): Promise<number> {
	return Number(await db.exec("DELETE FROM sys_refresh_token WHERE tenant_id = ?", [tenantId]));
}

function isUniqueViolation(e: unknown): boolean {
	return /unique|constraint/i.test(e instanceof Error ? e.message : String(e));
}

export async function saveProfile(p: Omit<AppProfile, "status"> & { status?: AppProfile["status"] }, deps: WecomStoreDeps): Promise<void> {
	const now = deps.now();
	const scope = {
		and: [
			{ field: "suite_id", op: "eq", value: p.suiteId },
			corpAgentScope(p.corpId, p.agentId),
		],
	};
	const rows = await db.table("wecom_app_profile").select(["suite_id"]).where(scope).all();
	const cols = {
		auth_corp_id: p.authCorpId,
		env: p.env,
		corp_name: p.corpName,
		status: p.status ?? "active",
		permanent_code_enc: deps.encrypt(p.permanentCode),
		update_time: now,
	};
	if (rows.length) {
		await db.table("wecom_app_profile").update(cols).where(scope).run();
		return;
	}
	try {
		await db.table("wecom_app_profile").insert({ suite_id: p.suiteId, corp_id: p.corpId, agent_id: p.agentId, installed_at: now, ...cols }).run();
	}
	catch (e) {
		// 并发插入者先落（企微 5 秒未拿到 success 就重推，两条 create_auth 撞车是常态）：
		// 撞 (suite_id, corp_id, agent_id) 即转为更新，不让它以 500 收场——
		// 否则企微再推第三次，这次授权就有可能在还剩一次重推时被判死。
		if (!isUniqueViolation(e))
			throw e;
		await db.table("wecom_app_profile").update(cols).where(scope).run();
	}
}

/**
 * 按企业代码找应用。`agentId` 为空时要求该企业只有一个启用中的应用。
 * 「企业不存在」与「已停用」返回**同一条文案**（§5.3 枚举风险：不让外部探测哪些企业装过）。
 */
export async function findProfile(corpId: string, agentId: string | null, deps: WecomStoreDeps): Promise<AppProfile> {
	const rows = await db.table("wecom_app_profile").select(["*"]).where(corpScope(corpId)).all() as Array<Record<string, unknown>>;
	const active = rows.filter(r => String(r.status) === "active");
	const picked = agentId ? active.filter(r => String(r.agent_id) === agentId) : active;
	if (picked.length === 0)
		fail(400, "企业代码无效或应用未开通");
	if (picked.length > 1)
		fail(400, "该企业开通了多个应用，登录链接必须带 agent 参数");
	const r = picked[0]!;
	return {
		suiteId: String(r.suite_id),
		corpId: String(r.corp_id),
		authCorpId: r.auth_corp_id == null ? String(r.corp_id) : String(r.auth_corp_id),
		agentId: String(r.agent_id),
		env: r.env == null ? "prod" : String(r.env),
		corpName: r.corp_name == null ? null : String(r.corp_name),
		status: String(r.status) === "disabled" ? "disabled" : "active",
		permanentCode: deps.decrypt(String(r.permanent_code_enc)),
	};
}

/** 停用/解绑：只改状态，不删行（取消授权也要留痕，§7.5 审计） */
export async function setProfileStatus(corpId: string, status: AppProfile["status"], deps: WecomStoreDeps): Promise<number> {
	return Number(await db.table("wecom_app_profile").update({ status, update_time: deps.now() }).where(corpScope(corpId)).run());
}

export async function putSuiteTicket(suiteId: string, ticket: string, expiresAt: number, deps: WecomStoreDeps): Promise<void> {
	const rows = await db.table("wecom_suite_ticket").select(["suite_id"]).where({ field: "suite_id", op: "eq", value: suiteId }).all();
	const cols = { suite_ticket: ticket, expires_at: expiresAt, update_time: deps.now() };
	if (rows.length)
		await db.table("wecom_suite_ticket").update(cols).where({ field: "suite_id", op: "eq", value: suiteId }).run();
	else
		await db.table("wecom_suite_ticket").insert({ suite_id: suiteId, ...cols }).run();
}

/** 套件票据（过期作废：过期后调 get_suite_token 会被企微拒，故本地先拒，省一次往返与一次失败计数） */
export async function getSuiteTicket(suiteId: string, deps: WecomStoreDeps): Promise<SuiteTicket> {
	const rows = await db.table("wecom_suite_ticket").select(["suite_ticket", "expires_at"]).where({ field: "suite_id", op: "eq", value: suiteId }).all() as Array<Record<string, unknown>>;
	const row = rows[0];
	if (!row)
		fail(503, "企微套件票据（suite_ticket）尚未收到：回调 URL 未打通或企微尚未推送");
	const expiresAt = Number(row.expires_at);
	if (!Number.isFinite(expiresAt) || expiresAt <= deps.now())
		fail(503, "企微套件票据（suite_ticket）已过期：企微每 10 分钟推送一次，请检查回调 URL");
	return { ticket: String(row.suite_ticket), expiresAt };
}

/** 一次性登录票据：只存 SHA-256，明文只出现在 302 的 URL 与 SPA 内存里 */
export async function issueLoginTicket(ticketHash: string, uid: number, ownerTenant: string, ttlSecs: number, deps: WecomStoreDeps): Promise<void> {
	const now = deps.now();
	// 顺手清过期票（共享表、无租户语义；避免长期累积；失败不影响签发）
	await db.table("wecom_login_ticket").where({ field: "expires_at", op: "lt", value: now }).delete().run();
	await db.table("wecom_login_ticket").insert({ ticket_hash: ticketHash, uid, owner_tenant: ownerTenant, expires_at: now + ttlSecs, used: 0, created_at: now }).run();
}

/**
 * 兑换登录票据（原子单次消费）：先 `update used=1 where used=0` 抢所有权——
 * 抢不到说明已被用/伪造；抢到再校验过期。并发双花只可能有一个 changes=1。
 */
export async function claimLoginTicket(ticketHash: string, deps: WecomStoreDeps): Promise<LoginTicketRow> {
	const changed = Number(await db.table("wecom_login_ticket").update({ used: 1 }).where({
		and: [
			{ field: "ticket_hash", op: "eq", value: ticketHash },
			{ field: "used", op: "eq", value: 0 },
		],
	}).run());
	if (changed !== 1)
		fail(401, "登录票据无效或已使用");
	const rows = await db.table("wecom_login_ticket").select(["uid", "owner_tenant", "expires_at"]).where({ field: "ticket_hash", op: "eq", value: ticketHash }).all() as Array<Record<string, unknown>>;
	const row = rows[0];
	if (!row)
		fail(401, "登录票据无效或已使用");
	if (Number(row.expires_at) <= deps.now())
		fail(401, "登录票据已过期，请重新登录");
	return { uid: Number(row.uid), ownerTenant: String(row.owner_tenant) };
}

/** 运行时依赖：密钥取自部署常量，加密原语取自 oj 运行时全局 */
export function runtimeStoreDeps(cfg: WecomConfig): WecomStoreDeps {
	return {
		encrypt: (plain: string) => crypto.aesGcmEncrypt(plain, cfg.encKey),
		decrypt: (blob: string) => crypto.aesGcmDecrypt(blob, cfg.encKey),
		now: () => Math.floor(Date.now() / 1000),
	};
}
