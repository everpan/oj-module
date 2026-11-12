// 机器人凭据共享内核（mcp-bot-guide.md / api-manual §14，oj v0.1.130）。
// 三张表 oj_svc_token / oj_bot_binding / oj_obo_audit 上收 _platform（租户表，带 tenant_id）：
// system 运营端点与 auth/obo 换签都经 #/_platform 读写，冻结码/常量/审计/表访问只留一份真源。
// 域函数只在这里碰这三张表（外加换签必需的 users / sys_user_role），handler 一律薄封装：
// 判权 → respond(() => 域函数) → .schema/.response。表归属清晰，且全部 db.table 落在 _platform
// 模块上下文（三表本就归 _platform），不依赖各消费模块的 deps 门禁。

// 顶层 select 未写 limit() 会被 db_query.default_limit（默认 100）静默截断：审计表随换签线性
// 增长，名单也可能破百，故所有全量读一律经 allRows 分批取全（见 infra/query.ts）。
import { allRows } from "#/_platform/_shared/service/infra/query";

/**
 * 构造器 where 条件结构（对齐 global.d.ts 的 WhereCond）。本文件是 ES module，而模板
 * global.d.ts 末尾有 `export {}`——其顶层 Row/WhereCond 是模块内私有、非全局名，故这里
 * 用本地结构声明，行形状沿用全仓惯例 Record<string, unknown>，不取全局裸名。
 */
interface Cond { field?: string, op?: string, value?: unknown, and?: Cond[], or?: Cond[], not?: Cond }

/** svc 档位白名单（与 oj serve 侧 tier_of 同词表：read/write/destructive）。 */
export const SVC_SCOPES = ["read", "write", "destructive"] as const;

/** svc token 上限 90d（与 oj JWT_TTL_CAP_SECS 同值，越界按上限取不报错）。 */
export const SVC_TTL_SECS = 90 * 86400;

/** 翻旧行宽限 24h（与 oj R6 rotate 同值）：旧 bearer 在途仍可放行，过期由 SvcGate 自动移出有效集。 */
export const SVC_GRACE_SECS = 24 * 86400;

/** 受托 token 10 分钟（obo 换签产物，勿预缓存：401 才重换签、限一次）。 */
export const OBO_TTL_SECS = 600;

/** obo 换签业务码冻结（消费方一律读信封 code；>599 经 clamp_status 落 HTTP 500）。 */
export const OBO = {
	UNBOUND: 40310, // (provider, external_sub) 无绑定行
	REVOKED: 40311, // jti 不在 oj_svc_token（已吊销/不存在；fail-closed）
	NOT_SVC: 40312, // claims.svc 缺失/非串，或 roles 不含 bot（双查纵深）
	DISABLED: 40313, // 员工停用
} as const;

export const OBO_MSG: Record<number, string> = {
	[OBO.UNBOUND]: "该账号未绑定机器人代操作，请联系管理员",
	[OBO.REVOKED]: "服务凭据已吊销或不存在",
	[OBO.NOT_SVC]: "仅服务凭据（svc token）可换签员工身份",
	[OBO.DISABLED]: "该账号已停用",
};

/** 绑定 CSV 导入/导出同列序（roundtrip 兼容）。 */
export const BINDING_COLS = ["provider", "external_sub", "user_id"] as const;

export interface OboActor {
	svc: string
	provider: string
	external_sub: string
	user_id: string
}

/** 秒级时间戳（模板无 nowSecs 全局，统一走这里；三方言无关）。 */
export function nowSecs(): number {
	return Math.floor(Date.now() / 1000);
}

/** respond 风格端点用：抛 Error & {status}，由 failWith 收口成 json.fail（不进则被抹成 500）。 */
export function botFail(status: number, msg: string): never {
	throw Object.assign(new Error(msg), { status });
}

/** 每次换签（成败均）写一行审计；system/obo-audit 端点只读消费此表。 */
export async function auditObo(a: OboActor, ok: boolean, reason: string): Promise<void> {
	await db.table("oj_obo_audit").insert({
		svc: a.svc,
		provider: a.provider,
		external_sub: a.external_sub,
		user_id: a.user_id,
		ok: ok ? 1 : 0,
		reason,
		ts: nowSecs(),
	}).run();
}

/** DML run() 返回 number | 行数组，无 returning 时恒为受影响行数。 */
function affected(r: number | Array<Record<string, unknown>>): number {
	return typeof r === "number" ? r : 0;
}

// ---- 服务凭据（oj_svc_token）----

export interface SvcTokenRow {
	jti: string
	name: string
	scopes: string[]
	created_by: string
	created_at: number
	expires_at: number
	// v0.1.132 SvcGate/rotate 契约：status ∈ {active,superseded}（缺省 active）；
	// grace_until 为 epoch 秒，仅 superseded 宽限期内 > now（24h 活门票）。
	status: string
	grace_until: number
}

export async function listSvcTokens(): Promise<SvcTokenRow[]> {
	const rows = await allRows<Record<string, unknown>>(() => db.table("oj_svc_token")
		.select(["jti", "name", "scopes", "created_by", "created_at", "expires_at", "status", "grace_until"])
		// jti 作 tie-breaker：created_at 相同（秒级批量签发）时 offset 分批不重不漏。
		.orderBy([{ field: "created_at", dir: "desc" }, { field: "jti", dir: "asc" }]));
	return rows.map((r) => {
		let scopes: string[] = [];
		try {
			scopes = JSON.parse(String(r.scopes ?? "[]")) as string[];
		}
		catch {
			scopes = [];
		}
		return {
			jti: String(r.jti),
			name: String(r.name),
			scopes,
			created_by: String(r.created_by),
			created_at: Number(r.created_at),
			expires_at: Number(r.expires_at ?? 0),
			status: String(r.status ?? "active"),
			grace_until: Number(r.grace_until ?? 0),
		};
	});
}

/**
 * 同 (租户, name) 既有 active 或宽限期内 superseded 行，翻为 superseded 并给 24h 宽限
 * （存量 active 直接置宽限；已在宽限内的保留原 grace_until）。保证每 (租户, name) 至多一行 active。
 * oj_svc_token 是租户表，sql_guard 自动按当前租户注入，故按 name 匹配即可，无需显式带 tenant_id。
 * 注：admin 并发重签发同名仍有极小竞态（两请求都读到「无 active」后各插一行）——属 oj R6 上游
 * 已标注的「admin create 存量语义」边界（current 的 jti 字典序 tie-break 兜读侧）；高频重签发场景
 * 应走轮换端点（本模板未暴露 oj 内置 rotate/current，因其会写明文列）。见 plan §9.2。
 */
async function supersedeActiveByName(name: string): Promise<number> {
	const now = nowSecs();
	const rows = await db.table("oj_svc_token")
		.select(["jti", "status", "grace_until"])
		.where({ field: "name", op: "eq", value: name })
		.all() as Array<Record<string, unknown>>;
	let n = 0;
	for (const r of rows) {
		const status = String(r.status ?? "active");
		const grace = Number(r.grace_until ?? 0);
		if (status === "active" || (status === "superseded" && grace > now)) {
			const setGrace = status === "active" ? now + SVC_GRACE_SECS : grace;
			await db.table("oj_svc_token")
				.update({ status: "superseded", grace_until: setGrace })
				.where({ field: "jti", op: "eq", value: String(r.jti) })
				.run();
			n++;
		}
	}
	return n;
}

/**
 * 明文 token 只在返回里出现一次（不落库不回显）；jti 登记行即吊销真相源。
 * @param ttlDays Q-B 有效期契约（方案 §4.1）：缺省/`<=0` = 长期固定（系统上限 90d，到期轮换 SOP）；
 *   `>0` = min(days,90) 天。oj 0.1.130 下 `jwt.sign` 把 ttl_secs 钳 ≤90d 且 `ttl_secs:0` 会令 `exp=now` 立即过期，
 *   故本仓翻译为「签 90d」，绝不把 0 透传为 ttl_secs（字面永不过期需走 §8 R6 上游需求）。
 * 同名重签发 = 轮换：插新 active 前先把同 (租户,name) 既有 active/宽限行翻 superseded（见 supersedeActiveByName）。
 */
export async function issueSvcToken(name: string, scopes: string[], createdBy: string, tenant: string, ttlDays?: number): Promise<{ token: string, jti: string }> {
	if (!name.trim())
		botFail(400, "name required");
	if (!scopes.length)
		botFail(400, "scopes must not be empty");
	const bad = scopes.filter(s => !(SVC_SCOPES as readonly string[]).includes(s));
	if (bad.length)
		botFail(400, `scopes must be a subset of: ${SVC_SCOPES.join("/")}`);
	const ttlSecs = ttlDays && ttlDays > 0 ? Math.min(ttlDays, 90) * 86400 : SVC_TTL_SECS;
	const jti = crypto.randomHex(16);
	const token = jwt.sign({
		sub: `svc:${name}`,
		roles: ["bot"],
		claims: { svc: name, jti, scopes, tenant },
		ttl_secs: ttlSecs,
	});
	const now = nowSecs();
	// 插新 active 前先翻旧行，保证每 (租户,name) 至多一行 active（修复同名重复签发累积多 active 行）。
	await supersedeActiveByName(name);
	await db.table("oj_svc_token").insert({
		jti,
		name,
		scopes: JSON.stringify(scopes),
		created_by: createdBy,
		created_at: now,
		// 到期看板 / 批量轮换导出（K6 缓解）直接读列，不依赖解 JWT 取 exp。
		expires_at: now + ttlSecs,
		// v0.1.132 契约：新签发即 active；grace_until=0 表示不在宽限（SvcGate 判 grace_until>now）。
		status: "active",
		grace_until: 0,
	}).run();
	return { token, jti };
}

export async function revokeSvcToken(jti: string): Promise<{ revoked: number }> {
	const n = affected(await db.table("oj_svc_token").delete().where({ field: "jti", op: "eq", value: jti }).run());
	if (!n)
		botFail(404, "no such token");
	return { revoked: n };
}

// ---- 员工绑定（oj_bot_binding）----

export interface BindingRow {
	provider: string
	external_sub: string
	user_id: string
	last_used_at: number
	created_by: string
	created_at: number
}

export async function listBindings(): Promise<BindingRow[]> {
	const rows = await allRows<Record<string, unknown>>(() => db.table("oj_bot_binding")
		.select(["provider", "external_sub", "user_id", "last_used_at", "created_by", "created_at"])
		// 复合唯一键 (provider, external_sub) 兜底，保证 offset 分批稳定。
		.orderBy([{ field: "created_at", dir: "desc" }, { field: "provider", dir: "asc" }, { field: "external_sub", dir: "asc" }]));
	return rows.map(r => ({
		provider: String(r.provider),
		external_sub: String(r.external_sub),
		user_id: String(r.user_id),
		last_used_at: Number(r.last_used_at),
		created_by: String(r.created_by),
		created_at: Number(r.created_at),
	}));
}

async function upsertBinding(provider: string, externalSub: string, userId: string, by: string): Promise<"insert" | "update"> {
	const n = affected(await db.table("oj_bot_binding").update({ user_id: userId }).where({ and: [
		{ field: "provider", op: "eq", value: provider },
		{ field: "external_sub", op: "eq", value: externalSub },
	] }).run());
	if (n > 0)
		return "update";
	await db.table("oj_bot_binding").insert({
		provider,
		external_sub: externalSub,
		user_id: userId,
		last_used_at: 0,
		created_by: by,
		created_at: nowSecs(),
	}).run();
	return "insert";
}

export async function setBinding(provider: string, externalSub: string, userId: string, by: string): Promise<{ op: "insert" | "update" }> {
	if (!provider || !externalSub || !userId)
		botFail(400, "provider/external_sub/user_id required");
	return { op: await upsertBinding(provider, externalSub, userId, by) };
}

export async function deleteBinding(provider: string, externalSub: string): Promise<{ deleted: number }> {
	const n = affected(await db.table("oj_bot_binding").delete().where({ and: [
		{ field: "provider", op: "eq", value: provider },
		{ field: "external_sub", op: "eq", value: externalSub },
	] }).run());
	if (!n)
		botFail(404, "no such binding");
	return { deleted: n };
}

/** 静默删：行不存在当作已删（返回 0），不抛 404。供企微 delete_user 事件回收绑定用—— */
/** 成员离职权与本事件不一定成对到达，缺失即视为无需回收，绝不该让事件处理失败。 */
export async function deleteBindingIfExists(provider: string, externalSub: string): Promise<{ deleted: number }> {
	const n = affected(await db.table("oj_bot_binding").delete().where({ and: [
		{ field: "provider", op: "eq", value: provider },
		{ field: "external_sub", op: "eq", value: externalSub },
	] }).run());
	return { deleted: n };
}

/** CSV 批量导入：body.csv 全文，首行表头 provider,external_sub,user_id；最简 split（三元组不含逗号）。 */
export async function importBindings(csv: string, by: string): Promise<{ imported: number, skipped: string[], total: number }> {
	const lines = csv.split(/\r?\n/).filter(l => l.trim());
	if (!lines.length)
		botFail(400, "empty csv");
	const header = lines[0].split(",").map(s => s.trim());
	if (header.join(",") !== BINDING_COLS.join(","))
		botFail(400, `csv header must be ${BINDING_COLS.join(",")}`);
	let imported = 0;
	const skipped: string[] = [];
	for (let i = 1; i < lines.length; i++) {
		const parts = lines[i].split(",").map(s => s.trim());
		if (parts.length !== 3 || parts.some(p => !p)) {
			skipped.push(`line ${i + 1}`);
			continue;
		}
		await upsertBinding(parts[0], parts[1], parts[2], by);
		imported++;
	}
	return { imported, skipped, total: lines.length - 1 };
}

/** 导出用：只需三列，按复合唯一键升序（与 import 同列序，且 offset 分批稳定）。 */
export async function bindingExportRows(): Promise<Array<{ provider: string, external_sub: string, user_id: string }>> {
	const rows = await allRows<Record<string, unknown>>(() => db.table("oj_bot_binding")
		.select(["provider", "external_sub", "user_id"])
		.orderBy([{ field: "provider", dir: "asc" }, { field: "external_sub", dir: "asc" }]));
	return rows.map(r => ({
		provider: String(r.provider),
		external_sub: String(r.external_sub),
		user_id: String(r.user_id),
	}));
}

// ---- 换签审计（oj_obo_audit）----

export interface AuditRow {
	id: number
	svc: string
	provider: string
	external_sub: string
	user_id: string
	ok: number
	reason: string
	ts: number
}

export interface OboAuditQuery {
	svc: string
	ok: string
	pageSize: number
	current: number
}

function toAuditRows(rows: Array<Record<string, unknown>>): AuditRow[] {
	return rows.map(r => ({
		id: Number(r.id),
		svc: String(r.svc),
		provider: String(r.provider),
		external_sub: String(r.external_sub),
		user_id: String(r.user_id),
		ok: Number(r.ok),
		reason: String(r.reason ?? ""),
		ts: Number(r.ts),
	}));
}

export async function searchOboAudit(q: OboAuditQuery): Promise<{ list: AuditRow[], total: number, pageSize: number, current: number }> {
	const conds: Cond[] = [];
	if (q.svc)
		conds.push({ field: "svc", op: "like", value: `%${q.svc}%` });
	if (q.ok === "0" || q.ok === "1")
		conds.push({ field: "ok", op: "eq", value: Number(q.ok) });
	const build = () => {
		let b = db.table("oj_obo_audit")
			.select(["id", "svc", "provider", "external_sub", "user_id", "ok", "reason", "ts"]);
		if (conds.length)
			b = b.where({ and: conds });
		return b.orderBy([{ field: "id", dir: "desc" }]);
	};
	// 内存分页照抄 sample 契约（pageSize/current）；但取数必须经 allRows 取全，否则顶层 select
	// 被默认 100 行截断，total 恒 ≤100、第二页起恒空。id 主键 desc 保证 offset 分批稳定。
	const all = toAuditRows(await allRows<Record<string, unknown>>(build));
	const pageSize = q.pageSize > 0 ? q.pageSize : 50;
	const current = q.current > 0 ? q.current : 1;
	return {
		list: all.slice((current - 1) * pageSize, current * pageSize),
		total: all.length,
		pageSize,
		current,
	};
}

export async function auditExportRows(): Promise<AuditRow[]> {
	const rows = await allRows<Record<string, unknown>>(() => db.table("oj_obo_audit")
		.select(["id", "svc", "provider", "external_sub", "user_id", "ok", "reason", "ts"])
		.orderBy([{ field: "id", dir: "desc" }]));
	return toAuditRows(rows);
}

// ---- obo 换签（auth/obo 端点调用）----

export interface OboContext {
	provider: string
	external_sub: string
	/** http.user.claims.svc（缺失/非串 → 40312） */
	svc: unknown
	/** http.user.claims.jti（缺失/非串或 oj_svc_token 查无 → 40311） */
	jti: unknown
	/** http.user.roles（须含 "bot"） */
	roles: string[]
	/** http.user.claims.tenant（字符串则原样复制进受托 token） */
	tenant: unknown
}

/**
 * 机器人以 svc token 代表员工换 10-min 受托 token。守卫已验签（Bearer svc token，roles:["bot"]）。
 * 顺序即冻结码：非 svc(40312) → jti 吊销(40311) → 绑定缺失(40310) → 员工停用(40313) → 实时查 roles 换签。
 * 每条路径（成败均）落一行 oj_obo_audit。失败抛 botFail(code, msg) 交 respond → json.fail（信封 code 保留）。
 * 受托 token 的 roles 来自 sys_user_role（模板 D10：users 无 roles 列，角色权威源是关系表）；
 * 禁用态看 users.is_forbidden（模板无 disabled 列）；act.sub 指回 svc 名（act_mask_destructive 据此遮蔽）。
 */
export async function exchangeObo(ctx: OboContext): Promise<{ access_token: string, expires_in: number }> {
	const svc = typeof ctx.svc === "string" ? ctx.svc : "";
	const jti = ctx.jti;
	const actor: OboActor = { svc, provider: ctx.provider, external_sub: ctx.external_sub, user_id: "" };
	const audit = (uid: string, ok: boolean, reason: string) =>
		auditObo({ ...actor, user_id: uid }, ok, reason);

	// 40312 非 svc 凭据：svc 名与 bot 角色双查（admin 签发恒 roles:["bot"]，手签漏 bot 的 token 在此拦下）。
	if (!svc || !ctx.roles.includes("bot")) {
		await audit("", false, "not_svc");
		botFail(OBO.NOT_SVC, OBO_MSG[OBO.NOT_SVC]);
	}
	// 40311 已吊销：缺 jti claim，或登记表查无此 jti（fail-closed）。
	if (typeof jti !== "string" || !jti) {
		await audit("", false, "revoked");
		botFail(OBO.REVOKED, OBO_MSG[OBO.REVOKED]);
	}
	const tok = await db.table("oj_svc_token")
		.select(["jti"])
		.where({ field: "jti", op: "eq", value: jti })
		.all();
	if (!tok.length) {
		await audit("", false, "revoked");
		botFail(OBO.REVOKED, OBO_MSG[OBO.REVOKED]);
	}
	// 40310 未绑定：(provider, external_sub) 无绑定行。
	const bindCond: Cond = { and: [
		{ field: "provider", op: "eq", value: ctx.provider },
		{ field: "external_sub", op: "eq", value: ctx.external_sub },
	] };
	const bind = await db.table("oj_bot_binding").select(["user_id"]).where(bindCond).all();
	if (!bind.length) {
		await audit("", false, "unbound");
		botFail(OBO.UNBOUND, OBO_MSG[OBO.UNBOUND]);
	}
	const uid = String((bind[0] as Record<string, unknown>).user_id);
	// 绑定活跃度（运营观测；失败路径不更新）。
	await db.table("oj_bot_binding").update({ last_used_at: nowSecs() }).where(bindCond).run();
	// 40313 停用（模板列名 is_forbidden）+ 用户存在性。
	const userRows = await db.table("users")
		.select(["id", "is_forbidden"])
		.where({ field: "id", op: "eq", value: Number(uid) })
		.all();
	const user = userRows[0] as Record<string, unknown> | undefined;
	if (!user || Number(user.is_forbidden) === 1) {
		await audit(uid, false, "disabled");
		botFail(OBO.DISABLED, OBO_MSG[OBO.DISABLED]);
	}
	// 员工 roles 实时查（D10：sys_user_role 是唯一权威源，换签产物按员工本人 roles 生效）。
	const roleRows = await db.table("sys_user_role")
		.select(["role_name"])
		.where({ field: "user_id", op: "eq", value: Number(uid) })
		.all() as Array<Record<string, unknown>>;
	const roles = roleRows.map(r => String(r.role_name));
	const extra: Record<string, unknown> = { act: { sub: `svc:${svc}` } };
	if (typeof ctx.tenant === "string")
		extra.tenant = ctx.tenant;
	const access_token = jwt.sign({
		sub: String(user!.id),
		roles,
		claims: extra,
		ttl_secs: OBO_TTL_SECS,
	});
	await audit(uid, true, "");
	return { access_token, expires_in: OBO_TTL_SECS };
}

// ---- 租户级资源回收（卸载机器人接入 / 租户重置）----

export interface BotCleanupResult {
	svc_tokens: number
	bindings: number
	audit_rows: number
}

/**
 * 一次性清空当前租户的三张 bot 表（服务凭据 / 员工绑定 / 换签审计），返回各表删除行数（幂等，二次调用为 0）。
 *
 * 这是「卸载机器人接入」的唯一数据出口——**不要**挂到方案卸载流程：_platform 的卸载纪律是
 * 「只删代码/锁/路由/权限，绝不删业务数据，业务表只回传名单供人工清理」（见 _lifecycle/uninstall.ts:36-38），
 * 因此清数据必须是一次显式、带二次确认的运营操作。
 *
 * 租户边界由 sql_guard 注入的 tenant_id 谓词决定，调用方拿不到跨租户删除能力。
 * 构造器表达不了「无条件删除」，故用各表 NOT NULL 列做恒真谓词（jti / provider / id）。
 *
 * 范围外：受托 token（obo 产物）是无状态 10min JWT，服务端无存储、无法单条吊销——卸载后已签出的
 * 最长 10 分钟内仍有效；需即时止血时先 revokeSvcToken（阻断新换签）。SvcGate 正缓存 30s 内仍可能
 * 放行已删 jti，与「吊销 ≤30s 生效」是同一窗口。
 */
export async function cleanupTenantBotResources(): Promise<BotCleanupResult> {
	const svc_tokens = affected(await db.table("oj_svc_token").delete().where({ field: "jti", op: "ne", value: "" }).run());
	const bindings = affected(await db.table("oj_bot_binding").delete().where({ field: "provider", op: "ne", value: "" }).run());
	const audit_rows = affected(await db.table("oj_obo_audit").delete().where({ field: "id", op: "gt", value: 0 }).run());
	return { svc_tokens, bindings, audit_rows };
}
