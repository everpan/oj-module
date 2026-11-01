// 企微组织架构**全量同步**（B2 / 方案 §6.2）：唯一权威来源。
//
// 形态是「分片推进」而不是「一个长任务」——服务端 isolate 没有定时器，路由也有超时，
// 所以一次请求只推一片（默认 12 秒的预算），进度落在 wecom_sync_job 的游标里，
// 由调用方轮询驱动。好处是：可续跑、可观测、不受路由超时限制、崩了也不丢进度。
//
// 三个阶段（相序固定，游标就是在这三个之间迁移）：
//   departments → 一次 simplelist 拿可见范围内全部部门（兜底 department/list），按父子序落库；
//   members     → 逐部门 user/list（要职务/排序/主部门，只有重量接口有），按片处理；
//   reconcile   → **仅当本轮完整且零跳过**才把上一轮见过、这一轮没见的部门置隐（D9）。
//
// 三条纪律：
//   · 归属权（D13）：所有写路径都带 `origin = 'wecom'`，本地建的部门一根毛都不碰；
//   · 错码三分（§5.1）：权限类跳过并计数、限流类退避（client 内已重试，还错就停片等下轮）、
//     致命类计入熔断（连续 FATAL_LIMIT 次 → job failed）；
//   · 错误落库只存脱敏结构（`{errcode, phase, deptId, at}`）：异常原文里可能夹带 URL 上的 token。
import type { WecomClient, WecomMember } from "./client";
import type { ProfileProbe } from "./store";

import { markSeen, reconcileHidden, upsertDepartment } from "#/_platform/_shared/service/domain/org";
import { upsertSourceUser } from "#/_platform/_shared/service/domain/users";
import { WecomApiError } from "./client";
import { applyMemberDetail, externalUsername } from "./login";

export type SyncStatus = "idle" | "running" | "done" | "failed" | "cancelled";
export type SyncPhase = "departments" | "members" | "reconcile";

export interface SyncStats {
	/** 本轮落库的部门数 */
	departments: number
	/** 本轮结束时本企业的企微来源账号数（不是「人×部门」的调用次数） */
	members: number
	/** 因权限（60011/48002）跳过成员列表的部门数——页面要显示「N 个部门因权限跳过」 */
	skipped: number
	/** 是否执行了墓碑回收（有跳过就不敢回收，见 D9） */
	reconciled: boolean
}

export interface SyncCursor {
	phase: SyncPhase
	/**
	 * 轮次号（单调递增，落 `sys_department.seen_job_id`）。
	 * 不用时间戳：同秒内重跑一轮会让「上一轮见过」和「本轮见过」撞成同一个值，
	 * 墓碑回收（`seen_job_id < round`）就永远不生效。
	 */
	round: number
	/** departments 阶段产出的部门清单；members 阶段按它逐部门拉人（游标只存本地 id + 企微 id） */
	depts: Array<{ id: number, originId: string }>
	/** 已处理到 depts 的下标（续跑锚点，避免同一部门重复拉） */
	at: number
	/** 连续致命错误计数（熔断） */
	fatalRun: number
}

/** 同步任务本身的状态（只来自 `wecom_sync_job` 这一张表） */
export interface SyncJobView {
	status: SyncStatus
	phase: SyncPhase
	stats: SyncStats
	/** 进度：done/total 均以「部门」计（成员阶段按已处理部门推进） */
	progress: { done: number, total: number }
	/** 脱敏后的错码与明细；非 failed 时为空 */
	errCode: string | null
	errDetail: { errcode?: number, phase: SyncPhase, deptId?: string, at: number } | null
	startedAt: number
	finishedAt: number
	updateTime: number
}

/**
 * 给页面看的完整状态 = 任务状态 + 授权事实。
 * 两者刻意分开：`status` 是「同步跑到哪了」，`connected`/`authMode` 是「这家企业能不同步」，
 * 后者来自授权面、前者来自执行面，混在一张表里就会在「取消授权后同步状态还写着 done」时自相矛盾。
 */
export interface SyncView extends SyncJobView {
	/** 本站是否装过企微（有授权记录，含已停用）——false 时页面整条不显示 */
	connected: boolean
	/** 0=管理员授权 / 1=成员授权（1 时任何通讯录调用都是 60011，同步入口直接拒绝） */
	authMode: number
	/** 授权记录的应用状态；disabled = 已取消授权/被停用，同步冻结但数据保留（§7 黄条） */
	profileStatus: "active" | "disabled" | null
}

export interface SyncDeps {
	client: WecomClient
	now: () => number
	/** 单片时间预算（测试可调小；缺省见 DEFAULT_BUDGET_MS） */
	budgetMs?: number
}

const ORIGIN = "wecom";
/**
 * 单片的墙钟预算。定 12 秒是两头夹出来的：
 *   · 上界——路由全局超时 30 秒（`config.yaml server.timeout` 缺省 "30s"），而单次上游调用
 *     自带 5 秒软超时（client.ts TIMEOUT_MS），预算到期后最多再等一次调用，12+5 < 30；
 *   · 下界——4 秒（初版）配合 5 次/分的限速，前端串行驱动第 6 次就被 429 掐断，
 *     500 人的企业要跑好几分钟；12 秒下一片能干完 100+ 次上游调用，正常规模两三次到底。
 */
const DEFAULT_BUDGET_MS = 12000;
/** 连续致命错误上限（方案 §5.1「连续 10 次 → failed」） */
const FATAL_LIMIT = 10;
/** 抢锁租约：单片最长 12+5 秒，120 秒留给「请求被平台强杀、finally 都没跑到」的场景 */
const LOCK_TTL_SECS = 120;

function fail(status: number, message: string): never {
	throw Object.assign(new Error(message), { status });
}

function emptyStats(): SyncStats {
	return { departments: 0, members: 0, skipped: 0, reconciled: false };
}

function emptyCursor(): SyncCursor {
	return { phase: "departments", round: 0, depts: [], at: 0, fatalRun: 0 };
}

function parseJson<T>(raw: unknown, fallback: T): T {
	if (raw == null || raw === "")
		return fallback;
	try {
		return JSON.parse(String(raw)) as T;
	}
	catch {
		return fallback;
	}
}

interface JobRow {
	status: string
	phase: string
	cursor_text: string | null
	stats_text: string | null
	err_code: string | null
	err_detail: string | null
	started_at: number
	finished_at: number
	update_time: number
}

function jobScope(corpId: string, agentId: string) {
	return {
		and: [
			{ field: "corp_id", op: "eq", value: corpId },
			{ field: "agent_id", op: "eq", value: agentId },
		],
	};
}

async function readJob(corpId: string, agentId: string): Promise<JobRow | null> {
	const rows = await db.table("wecom_sync_job").select(["*"]).where(jobScope(corpId, agentId)).all() as unknown as JobRow[];
	return rows[0] ?? null;
}

function toView(job: JobRow | null): SyncJobView {
	if (!job) {
		return {
			status: "idle",
			phase: "departments",
			stats: emptyStats(),
			progress: { done: 0, total: 0 },
			errCode: null,
			errDetail: null,
			startedAt: 0,
			finishedAt: 0,
			updateTime: 0,
		};
	}
	const cursor = parseJson<SyncCursor>(job.cursor_text, emptyCursor());
	return {
		status: (job.status as SyncStatus) ?? "idle",
		phase: (job.phase as SyncPhase) ?? cursor.phase,
		stats: parseJson<SyncStats>(job.stats_text, emptyStats()),
		progress: { done: cursor.at, total: cursor.depts.length },
		errCode: job.err_code,
		errDetail: parseJson<SyncJobView["errDetail"]>(job.err_detail, null),
		startedAt: Number(job.started_at ?? 0),
		finishedAt: Number(job.finished_at ?? 0),
		updateTime: Number(job.update_time ?? 0),
	};
}

/** 当前进度（只读本地行，不打上游）：轮询用它，不用 start */
export async function syncStatus(corpId: string, agentId: string): Promise<SyncJobView> {
	return toView(await readJob(corpId, agentId));
}

/** 拼上授权事实（见 SyncView 注释）。probe 为 null = 本站没装企微 */
export function attachProfile(view: SyncJobView, probe: ProfileProbe | null): SyncView {
	return {
		...view,
		connected: probe !== null,
		authMode: probe?.authMode ?? 0,
		profileStatus: probe?.status ?? null,
	};
}

async function writeJob(corpId: string, agentId: string, patch: Record<string, unknown>, now: number): Promise<void> {
	const cols = { ...patch, update_time: now };
	const rows = await db.table("wecom_sync_job").select(["agent_id"]).where(jobScope(corpId, agentId)).all();
	if (rows.length) {
		await db.table("wecom_sync_job").update(cols).where(jobScope(corpId, agentId)).run();
		return;
	}
	try {
		await db.table("wecom_sync_job").insert({ corp_id: corpId, agent_id: agentId, started_at: now, finished_at: 0, ...cols }).run();
	}
	catch (e) {
		// 唯一约束撞车（两片同时起）：转为更新，同 saveProfile 先例
		if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e)))
			throw e;
		await db.table("wecom_sync_job").update(cols).where(jobScope(corpId, agentId)).run();
	}
}

/**
 * 抢锁：**靠复合主键插入**判原子，不靠读 status 再改。
 * 过期租约（请求崩溃留下的行）允许抢占——否则一次 OOM 会让这个企业永远不能同步。
 */
async function acquireLock(agentId: string, owner: string, now: number): Promise<void> {
	try {
		await db.table("wecom_sync_lock").insert({ agent_id: agentId, owner, taken_at: now }).run();
		return;
	}
	catch (e) {
		if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e)))
			throw e;
	}
	const rows = await db.table("wecom_sync_lock").select(["taken_at"]).where({ field: "agent_id", op: "eq", value: agentId }).all() as Array<{ taken_at: number }>;
	const takenAt = Number(rows[0]?.taken_at ?? 0);
	if (now - takenAt < LOCK_TTL_SECS)
		fail(409, "同步正在进行，请稍后再试");
	await db.table("wecom_sync_lock").update({ owner, taken_at: now }).where({ field: "agent_id", op: "eq", value: agentId }).run();
}

async function releaseLock(agentId: string): Promise<void> {
	await db.table("wecom_sync_lock").where({ field: "agent_id", op: "eq", value: agentId }).delete().run();
}

/**
 * 部门清单：主路径 `department/simplelist`（不带父 id = 应用可见范围内全部部门，一次拿完）。
 * 上游明确写过 `department/list` 性能低（90208），故只当兜底——它多返回 `order`，
 * 但大企业回包更容易撞 45029。
 */
async function fetchDepartments(client: WecomClient, corpId: string, agentId: string, secret: string) {
	try {
		return await client.departmentChildren(corpId, agentId, secret);
	}
	catch (e) {
		if (e instanceof WecomApiError && e.kind === "permission")
			throw e;
		return await client.departmentList(corpId, agentId, secret);
	}
}

/**
 * 按父子序排好再落库：`upsertDepartment` 要的是**本地父 id**，所以父必须先存在。
 * 孤儿（父不在结果集，通常是可见范围导致的）按方案挂到根，不报错；真成环的兜底也挂根
 * （企微侧不会给出环，但这里绝不能死循环）。
 */
function orderTopDown<T extends { id: string, parentId: string }>(list: T[]): T[] {
	const pending = new Map<string, T>(list.map(d => [d.id, d]));
	const resolved = new Set<string>();
	const out: T[] = [];
	while (pending.size) {
		let progressed = false;
		for (const [id, d] of pending) {
			const parent = d.parentId;
			// 父为空、父不在本批（孤儿）、或父已排好 → 现在就能落
			if (!parent || !pending.has(parent) || resolved.has(parent)) {
				out.push(d);
				resolved.add(id);
				pending.delete(id);
				progressed = true;
			}
		}
		if (!progressed) {
			for (const d of pending.values())
				out.push(d);
			break;
		}
	}
	return out;
}

function scrubError(e: unknown, phase: SyncPhase, deptId: string | null, now: number): { errCode: string, errDetail: SyncJobView["errDetail"] } {
	if (e instanceof WecomApiError)
		return { errCode: String(e.errcode), errDetail: { errcode: e.errcode, phase, deptId: deptId ?? undefined, at: now } };
	const message = e instanceof Error ? e.message : String(e);
	// 非企微错码（网络/超时）：只留类别，不留原文（原文可能带 URL 上的 access_token）
	return { errCode: /超时/.test(message) ? "timeout" : "network", errDetail: { phase, deptId: deptId ?? undefined, at: now } };
}

/** 没有 job 行时的空视图（导出给「本站没装企微」的空态用） */
export function emptyView(status: SyncStatus): SyncJobView {
	return { ...toView(null), status };
}

/**
 * 开始 / 继续一次同步——**每调一次推一片**。
 *
 * 语义取「开始或继续」而不是「必须从零开始」：可续跑是这套分片设计的全部意义，
 * 前端只要在 `status === "running"` 时继续调它（或由用户点「继续」），直到 done/failed。
 */
export async function startSync(ctx: { corpId: string, agentId: string, secret: string, authMode: number }, deps: SyncDeps): Promise<SyncJobView> {
	// 准入判据：成员授权（auth_mode=1）下应用无任何部门权限，跑起来只会得到一片 60011
	if (Number(ctx.authMode) !== 0)
		fail(400, "该企业为「成员授权」模式，应用没有通讯录权限：请企业管理员在企微后台把授权模式改为「管理员授权」后再同步");

	const now = Math.floor(deps.now() / 1000);
	await acquireLock(ctx.agentId, `u${Number((globalThis as { http?: { user?: { id?: number } } }).http?.user?.id ?? 0)}`, now);
	try {
		const existing = await readJob(ctx.corpId, ctx.agentId);
		const resumable = existing && existing.status === "running";
		const prevCursor = existing ? parseJson<SyncCursor>(existing.cursor_text, emptyCursor()) : null;
		let cursor = resumable && prevCursor
			? prevCursor
			: { ...emptyCursor(), round: (prevCursor?.round ?? 0) + 1 };
		let stats = resumable ? parseJson<SyncStats>(existing.stats_text, emptyStats()) : emptyStats();
		const startedAt = resumable ? Number(existing.started_at) : now;
		const roundId = cursor.round;

		await writeJob(ctx.corpId, ctx.agentId, {
			status: "running",
			phase: cursor.phase,
			cursor_text: JSON.stringify(cursor),
			stats_text: JSON.stringify(stats),
			err_code: null,
			err_detail: null,
			started_at: startedAt,
			finished_at: 0,
		}, now);

		const result = await runSlice(ctx.corpId, ctx.agentId, ctx.secret, cursor, stats, roundId, deps);
		cursor = result.cursor;
		stats = result.stats;
		// 三态收敛：失败 / 片内收手（还在 running，等下一次 start）/ 全部跑完
		const status: SyncStatus = result.failed ? "failed" : result.paused ? "running" : "done";
		await writeJob(ctx.corpId, ctx.agentId, {
			status,
			phase: cursor.phase,
			cursor_text: JSON.stringify(cursor),
			stats_text: JSON.stringify(stats),
			err_code: result.errCode,
			err_detail: result.errDetail ? JSON.stringify(result.errDetail) : null,
			finished_at: status === "running" ? 0 : now,
		}, now);
		return toView(await readJob(ctx.corpId, ctx.agentId));
	}
	finally {
		await releaseLock(ctx.agentId);
	}
}

interface SliceResult {
	cursor: SyncCursor
	stats: SyncStats
	failed: boolean
	/** 片内收手（预算用完 / 限流 / 可恢复的致命错）：进度已落库，下次接着推 */
	paused: boolean
	errCode: string | null
	errDetail: SyncJobView["errDetail"]
}

async function runSlice(
	corpId: string,
	agentId: string,
	secret: string,
	cursor: SyncCursor,
	stats: SyncStats,
	roundId: number,
	deps: SyncDeps,
): Promise<SliceResult> {
	const orgDeps = { now: deps.now };
	const deadline = deps.now() + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
	const done = (extra: Partial<SliceResult> = {}): SliceResult => ({ cursor, stats, failed: false, paused: false, errCode: null, errDetail: null, ...extra });
	const paused = (): SliceResult => done({ paused: true });

	if (cursor.phase === "departments") {
		let list: Array<{ id: string, parentId: string, name: string | null, order: number }>;
		try {
			list = await fetchDepartments(deps.client, corpId, agentId, secret);
		}
		catch (e) {
			const scrubbed = scrubError(e, "departments", null, Math.floor(deps.now() / 1000));
			return done({ failed: true, errCode: scrubbed.errCode, errDetail: scrubbed.errDetail });
		}
		const ordered = orderTopDown(list);
		const localByOrigin = new Map<string, number>();
		const placedIds: number[] = [];
		for (const d of ordered) {
			const parentLocal = d.parentId && localByOrigin.has(d.parentId) ? localByOrigin.get(d.parentId)! : null;
			const id = await upsertDepartment({ origin: ORIGIN, originId: d.id, parentId: parentLocal, name: d.name, orderNo: d.order }, orgDeps);
			localByOrigin.set(d.id, id);
			placedIds.push(id);
		}
		await markSeen(ORIGIN, placedIds, roundId, orgDeps);
		cursor.depts = ordered.map(d => ({ id: localByOrigin.get(d.id)!, originId: d.id }));
		cursor.at = 0;
		cursor.phase = "members";
		stats.departments = cursor.depts.length;
	}

	if (cursor.phase === "members") {
		// 部门 id 映射：一次查询覆盖整片（500 部门以内一条 SQL；逐人查会把同步打成 N×M 次）
		const rows = await db.table("sys_department").select(["id", "origin_id"]).where({ field: "origin", op: "eq", value: ORIGIN }).all() as Array<{ id: number, origin_id: string }>;
		const deptByOrigin = new Map(rows.map(r => [String(r.origin_id), Number(r.id)]));
		while (cursor.at < cursor.depts.length) {
			if (deps.now() >= deadline)
				return paused();
			const dept = cursor.depts[cursor.at]!;
			let members: WecomMember[];
			try {
				members = await deps.client.deptMembersDetail(corpId, agentId, secret, dept.originId);
				cursor.fatalRun = 0;
			}
			catch (e) {
				const kind = e instanceof WecomApiError ? e.kind : "fatal";
				if (kind === "permission") {
					// 单个部门无权限是常态（可见范围外的部门）：跳过并计数，不升级成失败
					stats.skipped++;
					cursor.at++;
					continue;
				}
				if (kind === "ratelimit")
					return paused(); // 限流已在 client 内退避三次，还错就停片，游标留在本部门
				cursor.fatalRun++;
				if (cursor.fatalRun >= FATAL_LIMIT) {
					const scrubbed = scrubError(e, "members", dept.originId, Math.floor(deps.now() / 1000));
					return done({ failed: true, errCode: scrubbed.errCode, errDetail: scrubbed.errDetail });
				}
				return paused();
			}
			for (const m of members)
				await applyMember(m, corpId, deptByOrigin, orgDeps);
			cursor.at++;
		}
		cursor.phase = "reconcile";
	}

	if (cursor.phase === "reconcile") {
		// D9：只有「本轮完整且零跳过」才敢回收——否则一次上游抖动会被读成「这些部门被删了」
		if (stats.skipped === 0) {
			await reconcileHidden(ORIGIN, roundId, orgDeps);
			stats.reconciled = true;
		}
		stats.members = await countMembers(corpId);
	}

	return done();
}

async function countMembers(corpId: string): Promise<number> {
	const rows = await db.table("users").select(["id"]).where({ and: [
		{ field: "source", op: "eq", value: ORIGIN },
		{ field: "corp_id", op: "eq", value: corpId },
	] }).all();
	return rows.length;
}

/**
 * 一个成员：建档（activated=0）→ 交给 `applyMemberDetail` 写资料与组织关系。
 *
 * 这里**只做「建档 + 传参」**：真正的字段口径（只写自己拥有的行、未知部门跳过、主部门兜底）
 * 在 login.ts::applyMemberDetail 里，登录自更新与事件增量也调它。deptByOrigin 是本片预取的，
 * 逐人去查会把这个 500 部门的同步打成 N×M 次查询。
 */
async function applyMember(m: WecomMember, corpId: string, deptByOrigin: Map<string, number>, orgDeps: { now: () => number }): Promise<void> {
	const uid = await upsertSourceUser({ username: externalUsername(m.userid), displayName: m.name, source: ORIGIN, corpId });
	await applyMemberDetail({ uid, userid: m.userid }, m, { ...orgDeps, deptByOrigin });
}

/** 取消：清游标、置 cancelled（不回滚已写入的组织数据——同步幂等，重跑即可） */
export async function cancelSync(corpId: string, agentId: string, deps: { now: () => number }): Promise<SyncJobView> {
	const now = Math.floor(deps.now() / 1000);
	const job = await readJob(corpId, agentId);
	if (!job)
		return emptyView("idle");
	await writeJob(corpId, agentId, {
		status: "cancelled",
		cursor_text: JSON.stringify(emptyCursor()),
		err_code: null,
		err_detail: null,
		finished_at: now,
	}, now);
	await releaseLock(agentId);
	return toView(await readJob(corpId, agentId));
}
