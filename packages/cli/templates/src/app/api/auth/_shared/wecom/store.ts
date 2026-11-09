// 企微三张表 + 租户上下文的持久化面（全部走构造器，交给 sql_guard 管租户）。
//
// 表定性（与 schema.yaml / config.shared_allow 三处一致）：
//   wecom_app_profile / wecom_suite_ticket / wecom_login_ticket 均 `tenant: false`（D9）——
//   它们本身就是「corp → 租户」的映射权威与套件级凭证，查它们的时候必然还没有租户上下文。
//   共享 = 不受守卫约束，故只放映射/凭证/一次性票据，不放任何租户业务数据。
//
// permanent_code（= 代开发应用的 secret，全 corp 数据权限）只以 AES-GCM 密文落库（§7.5），
// 加解密经 deps 注入：Node 侧测试用假实现，运行时走 crypto.aesGcmEncrypt/Decrypt。
import type { WecomBase, WecomKind } from "./config";

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
	/**
	 * 这一行的凭据来源（0003 列）。**不是标签，是语义**：
	 *   · suite 行由 create_auth 写入，permanent_code 里是代开发换来的 secret；
	 *   · corp 行由「验证并接入」写入，里面是应用详情页的 Secret（suite_id 为空串）。
	 * 同一 corp_id 两行共存时，靠它决定「取消代开发授权该停哪一行」。
	 */
	credentialKind: WecomKind
	permanentCode: string
	/** 0=管理员授权 / 1=成员授权（成员授权下应用无任何部门权限，组织架构同步必然 60011，§2.3） */
	authMode: number
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
 * 企业范围 + 可选的来源过滤。
 *
 * 共存部署里**同一家**企业可能同时有代开发行与自建行（迁移期最常见），而「取消代开发授权」
 * 「复核授权模式」「找 secret」这三件事都只对 suite 行成立。不传 kind = 不过滤（保持
 * 单来源部署的原行为，`suite_id` 主键天然只有一类行）。
 */
function corpKindScope(corpId: string, kind?: WecomKind) {
	const base = corpScope(corpId);
	if (!kind)
		return base;
	return {
		and: [
			base,
			{ field: "credential_kind", op: "eq", value: kind },
		],
	};
}

/** 行 → 来源（库里的列是 text；只有明确写了 corp 才算自建，其余按代开发） */
function kindOfRow(r: Record<string, unknown>): WecomKind {
	return String(r.credential_kind) === "corp" ? "corp" : "suite";
}

/**
 * 吊销某租户的全部会话（refresh token）。
 *
 * `forTenant(tenantId)`（oj v0.1.129 起）让这条语句以目标租户执行：语句级覆盖，防护照常，
 * 只换注入值，不关守卫；`truncate()` 是构造器里唯一的无 where 写动词，在租户表上只清该
 * 租户。两者合起来精确等价于旧的裸 `DELETE … WHERE tenant_id = ?`，但不绕开构造器、也不
 * 依赖本次请求是否处于匿名态，同请求其它语句仍注入当前请求租户。
 *
 * 红线：tenantId 必须服务端派生（这里是 `tenantOfCorp(corpId)`），绝不可取请求参数。
 */
export async function revokeTenantSessions(tenantId: string): Promise<number> {
	return Number(await db.table("sys_refresh_token").forTenant(tenantId).truncate().run());
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
		// 来源同时落在两处：主键里的 suite_id（corp 行为空串）与这一列（可读、可过滤）。
		// 更新路径也写：存量 suite 行被 corp 接入覆盖时（人工导错）不该留着旧标注。
		credential_kind: p.credentialKind,
		permanent_code_enc: deps.encrypt(p.permanentCode),
		// 授权模式是「该企业应用能不能做组织架构同步」的判据（§2.3）；重授权时必须跟着刷新
		auth_mode: Number(p.authMode ?? 0),
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
 *
 * `agentId` 已唯一确定一行（主键第三段），所以 `kind` 只是**加一层保险**：
 * 事件路径知道自己验签过的是哪套凭据，带上它就不会在同名 agent 撞车时取错 secret。
 */
export async function findProfile(corpId: string, agentId: string | null, deps: WecomStoreDeps, kind?: WecomKind): Promise<AppProfile> {
	const rows = await db.table("wecom_app_profile").select(["*"]).where(corpKindScope(corpId, kind)).all() as Array<Record<string, unknown>>;
	const active = rows.filter(r => String(r.status) === "active");
	const picked = agentId ? active.filter(r => String(r.agent_id) === agentId) : active;
	if (picked.length === 0)
		fail(400, "企业代码无效或应用未开通");
	if (picked.length > 1)
		fail(400, "该企业开通了多个应用，登录链接必须带 agent 参数");
	const r = picked[0]!;
	return {
		suiteId: String(r.suite_id ?? ""),
		corpId: String(r.corp_id),
		authCorpId: r.auth_corp_id == null ? String(r.corp_id) : String(r.auth_corp_id),
		agentId: String(r.agent_id),
		env: r.env == null ? "prod" : String(r.env),
		corpName: r.corp_name == null ? null : String(r.corp_name),
		status: String(r.status) === "disabled" ? "disabled" : "active",
		credentialKind: kindOfRow(r),
		permanentCode: deps.decrypt(String(r.permanent_code_enc)),
		authMode: Number(r.auth_mode ?? 0),
	};
}

/** 「这家企业能不能同步」的三个事实：装没装 / 什么授权模式 / 是否还启用 */
export interface ProfileProbe {
	agentId: string
	authMode: number
	status: AppProfile["status"]
	/** 来源：corp 行没有「授权模式」概念，页面不该给它画成员授权卡片 */
	credentialKind: WecomKind
}

/**
 * 授权探针（组织架构同步面的准入用）：与 `findProfile` 只差一件事——**查不到返回 null 而不是 400**。
 *
 * 为什么敢把「没有」当正常状态：调用方是本租户管理员在自己的组织架构页自省，`corp_id`
 * 取自租户头而不是外部输入，不存在 `findProfile` 要防的枚举面（§5.3）。「本站没装企微」
 * 是一个要能画成空态的事实，不是错误。
 *
 * 选中口径与 `findProfile` 对齐（优选启用中的应用；全停用时退回停用行，让页面能画
 * 「已取消授权」冻结态），只多一条：没有启用应用时也返回，而不是 400。
 */
export async function probeProfile(corpId: string, agentId: string | null, kind?: WecomKind): Promise<ProfileProbe | null> {
	const rows = await db.table("wecom_app_profile").select(["agent_id", "auth_mode", "status", "credential_kind"]).where(corpKindScope(corpId, kind)).all() as Array<Record<string, unknown>>;
	if (rows.length === 0)
		return null;
	const active = rows.filter(r => String(r.status) === "active");
	const pool = active.length > 0 ? active : rows;
	const picked = agentId ? pool.filter(r => String(r.agent_id) === agentId) : pool;
	if (picked.length === 0)
		return null;
	if (picked.length > 1)
		fail(400, "该企业开通了多个应用，同步入口必须带 agent 参数");
	const r = picked[0]!;
	return {
		agentId: String(r.agent_id),
		authMode: Number(r.auth_mode ?? 0),
		status: String(r.status) === "disabled" ? "disabled" : "active",
		credentialKind: kindOfRow(r),
	};
}

/**
 * 停用/解绑：只改状态，不删行（取消授权也要留痕，§7.5 审计）。
 * `kind` 缺省 = 该企业的全部行（单来源部署的原行为）；传 `suite` 才是 cancel_auth 该做的——
 * 代开发被取消授权时不能顺手把同一家企业的自建应用一起停掉。
 */
export async function setProfileStatus(corpId: string, status: AppProfile["status"], deps: WecomStoreDeps, kind?: WecomKind): Promise<number> {
	return Number(await db.table("wecom_app_profile").update({ status, update_time: deps.now() }).where(corpKindScope(corpId, kind)).run());
}

/**
 * 该企业已授权的应用 + 共享的永久授权码。
 * 用于 `change_auth` 复核授权模式：事件只带 AuthCorpId（**没有 AuthCode**），
 * 只能拿已落库的 permanent_code 去 `get_auth_info` 反查。未授权企业返回 null。
 *
 * 一并返回 `corpId`（真实企业 ID）：事件里给的可能是 `AuthCorpId`（第三方体系下是 open_corpid），
 * 而租户键只能用真实 corp_id（D10），故由这里统一把「事件身份 → 租户身份」的翻译交出来。
 *
 * `kind` 由**事件入口**传下来（本次验签命中的是哪套凭据）：同一家企业双应用时，
 * 取错 kind 就会拿另一套 secret 去换 token，症状是 40001 而不是「配置错了」。
 */
export async function findCorpAuth(corpId: string, deps: WecomStoreDeps, kind?: WecomKind): Promise<{ corpId: string, permanentCode: string, agentIds: string[], credentialKind: WecomKind } | null> {
	const rows = await db.table("wecom_app_profile").select(["corp_id", "agent_id", "permanent_code_enc", "credential_kind"]).where(corpKindScope(corpId, kind)).all() as Array<Record<string, unknown>>;
	if (rows.length === 0)
		return null;
	return {
		corpId: String(rows[0]!.corp_id),
		permanentCode: deps.decrypt(String(rows[0]!.permanent_code_enc)),
		agentIds: rows.map(r => String(r.agent_id)),
		credentialKind: kindOfRow(rows[0]!),
	};
}

/** 授权模式变更：只改 auth_mode，不动 secret / 状态（改状态是 cancel_auth 的事） */
export async function setAuthMode(corpId: string, agentId: string, authMode: number, deps: WecomStoreDeps): Promise<void> {
	await db.table("wecom_app_profile").update({ auth_mode: Number(authMode), update_time: deps.now() }).where(corpAgentScope(corpId, agentId)).run();
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
export function runtimeStoreDeps(cfg: WecomBase): WecomStoreDeps {
	return {
		encrypt: (plain: string) => crypto.aesGcmEncrypt(plain, cfg.encKey),
		decrypt: (blob: string) => crypto.aesGcmDecrypt(blob, cfg.encKey),
		now: () => Math.floor(Date.now() / 1000),
	};
}
