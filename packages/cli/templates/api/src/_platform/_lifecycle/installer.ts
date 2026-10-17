// 安装状态机编排（P1-10，D11/OCP/SRP）：把既有九个 step 收敛成声明式十阶段状态机——
// STAGES 表逐序遍历，步骤实现从各 step 模块导入适配，依赖（fetch/exec/reload/sha/db）经
// InstallRequest 注入（DIP，测试全 stub）。lockCommit 是显式 stage（位于 migrate 后，D11/R2：
// 迁移成功后才允许落锁；锁指向的目录先于锁落盘，S1-4 同 oj build 时序）。
// 失败语义三分（D11/契约附录 A）：
//   ① 锁前（preflight..lock_commit）失败 → 清场（staging 删除、status failed、零改锁零改库表
//      含零审计——什么都没发生就什么都不留），可重跑；
//   ② 锁后（registering..smoke）失败 → status:"partial"（部分生效）+ 指引 key lifecycle.stage.*；
//   ③ 切换前 verifyTarget() 复验 staging 产物完整性（sha256/迁移 seq 对齐分别在 verifying/
//      migrating 段复核，不在此重做）。
// 终态审计（AC-P1-14）：audit 恒末位，done/partial 都跑；audit 失败仅日志不阻断任务终态（附录 B-5）。
// reconcile() 入口对账自愈（D11）：锁 ↔ 账本 head——锁指新版但账本落后 → 回指旧版（.bak + 旧版本
// 目录俱在）或摘除记 failed；超时 running 判 failed 同点执行（R13/B9/R31）。
// setEnabled 四处同写（D12/AC-P1-6）：锁摘除/恢复 + sidecar + sys_solution_route.enabled +
// modules.json enabled；启用从 sidecar 摘除前记录恢复版本。db 为 isolate 全局（同模板 service 层）。

import type { OpEntry } from "../_shared/service/audit";
import type { TaskLock } from "./lock";
import type { StateStore } from "./state";
import type { FetchFace } from "./steps/download";
import type { ExecFace } from "./steps/extract";
import type { SettingDecl, SolutionDecl, SolutionSnapshot } from "./steps/register";
import type { ReloadFace } from "./steps/reload";
import type { InstallContext, InstallStage, StageResult, TaskRecord, TaskStatus } from "./types";
import { auditOp } from "../_shared/service/audit";
import { atomicWriteText, fsFace, randomId } from "./atomic";
import { recordHistory } from "./history";
import { acquireTaskLock, commitLockEntry, readLock, writeLock } from "./lock";
import { deployWeb } from "./steps/deploy-web";
import { download } from "./steps/download";
import { extract } from "./steps/extract";
import { maxAppliedSeq, migrate, parseMigrateOutput } from "./steps/migrate";
import { preflight } from "./steps/preflight";
import { registerSolution } from "./steps/register";
import { reloadAndAssert } from "./steps/reload";
import { smoke } from "./steps/smoke";
import { verify } from "./steps/verify";
import { getTask, readTasks, sweepTimedOut, writeTask } from "./tasks";
import { bumpInstallSeq } from "./text-edit";

// db/http 为 oj isolate 注入全局（同模板 service 层惯例，register.ts/audit.ts 同款；测试由夹具装 globalThis.db）
declare const db: { exec: (sql: string, params: unknown[]) => Promise<unknown> };

export type { InstallContext, InstallStage, StageResult, TaskRecord, TaskStatus };

/**
 * 安装请求：身份 + 全部站点路径 + 注入面（DIP）。路径全部注入不硬编码站点布局（P1-9 同纪律）；
 * `oj migrate -d` 实参由 migrate 段自暂存根推导（迁移服务目录，B-11——不再注入 dataDir），
 * `dbPath`（R14 备份源）仍显式注入。
 */
export interface InstallRequest extends InstallContext {
	/** 分发包完整 URL（download stage；安装器不拼 URL——Form B 索引解析属市场/CLI 侧） */
	archiveUrl: string
	/** 共享根（manifests.yaml 所在目录 = 版本目录父级，D3 单 mount 形态） */
	sharedRoot: string
	/** 暂存目录（.staging；download/verify/extract 接力，migrate svc 物化源，lockCommit rename 源） */
	staging: string
	/** 任务状态目录（.install-tasks） */
	taskDir: string
	/** sqlite 库文件路径（R14 前置备份源；备份落同目录，保留 3 份由 migrate 段管） */
	dbPath: string
	/** 站点 web 模块目录（<dist>/modules） */
	siteModulesDir: string
	/** 站点 modules.json 路径（与 siteModulesDir 同属 <dist>） */
	modulesJsonPath: string
	/** API 前缀（smoke 探针 URL 前缀，C2-13） */
	apiPrefix: string
	/** 站点 config.yaml 路径（reloading 段 vars.ojm_install_seq 自增落盘处；缺省 config.yaml） */
	configPath?: string
	/** 注入面（DIP）：下载 / exec（tar+oj）/ 热更 / sha384（R10 integrity 重算） */
	fetch: FetchFace
	exec: ExecFace
	reload: ReloadFace
	sha384B64: (data: Uint8Array) => string
	/** sha256 摘要面（verifying 段；缺省回落运行时全局，同 verify.ts） */
	sha256Hex?: (data: Uint8Array) => string
	/** 迁移账本 head（rollbackGuard 真源；缺省跳过禁降版判定，同 migrate.ts） */
	ledgerHead?: number | bigint | null
	/** 注册快照查询（smoke；缺省回落 queryRegistered 的 db 全局） */
	query?: (name: string) => Promise<SolutionSnapshot | null>
	/** 审计出口（缺省 auditOp；测试注入记录器） */
	audit?: (entry: OpEntry) => void
	/** reload 终态断言期望生效段键（缺省 ["vars"]，同 reload.ts——B-11 安装触发面） */
	expected?: string[]
	/** 安装器内部通道（外部调用方忽略）：终态审计读 status/failedStage/taskId + migrate 捕获 appliedSeq */
	outcome?: { taskId?: string, status?: TaskStatus, failedStage?: InstallStage, appliedSeq?: number | null }
}

/** 单个 stage 的声明式定义（OCP：新增/调整阶段只动本表与适配函数，不动遍历器） */
export interface StageDef {
	name: InstallStage
	run: (req: InstallRequest) => Promise<StageResult>
}

/** 锁前 stage 集合（失败语义①清场重跑；lock_commit 收 D11①锁前语义——落锁即生效点之前最后一步） */
const PRE_LOCK_STAGES = new Set<InstallStage>(["preflight", "downloading", "verifying", "extracting", "migrating", "lock_commit"]);

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 捕获 oj migrate 输出的 exec 包装：成功运行后解析 applied max seq（对账 floor 依据） */
function captureMigrateExec(exec: ExecFace): { exec: ExecFace, seq: () => number | null } {
	let seq: number | null = null;
	return {
		seq: () => seq,
		exec: {
			run: async (argv) => {
				const r = await exec.run(argv);
				if (r.code === 0 && argv[0] === "oj" && argv[1] === "migrate") {
					const p = parseMigrateOutput(r.stdout);
					if (p.ok) {
						seq = maxAppliedSeq(p.output);
					}
				}
				return r;
			},
		},
	};
}

async function migrateStage(req: InstallRequest): Promise<StageResult> {
	const cap = captureMigrateExec(req.exec);
	const r = await migrate({ ...req, exec: cap.exec });
	if (r.ok) {
		req.outcome = { ...req.outcome, appliedSeq: cap.seq() };
	}
	return r;
}

/** 切换前复验（失败语义③）：staging 产物完整性——manifest.yaml 在、web 声明的 entry 在包内（R10 错配防线） */
async function verifyTarget(req: InstallRequest): Promise<{ ok: boolean, message: string }> {
	const f = fsFace();
	try {
		await f.readFile(`${req.staging}/manifest.yaml`);
	}
	catch {
		return { ok: false, message: "生效切换复验失败：staging 缺 manifest.yaml（解压产物不完整？）——附录 A lock_commit" };
	}
	const m = isObj(req.manifest) ? req.manifest : {};
	const web = isObj(m.web) ? m.web : undefined;
	const entry = web !== undefined && typeof web.entry === "string" ? web.entry : undefined;
	if (entry !== undefined) {
		try {
			await f.readFile(`${req.staging}/web/${entry}`);
		}
		catch {
			return { ok: false, message: `生效切换复验失败：web.entry「${entry}」在包内缺失——manifest 与产物错配（R10），拒绝切换` };
		}
	}
	return { ok: true, message: "复验通过" };
}

async function lockCommitStage(req: InstallRequest): Promise<StageResult> {
	const vt = await verifyTarget(req);
	if (!vt.ok) {
		return { stage: "lock_commit", ok: false, retryable: false, message: vt.message };
	}
	const f = fsFace();
	const versionDir = `${req.sharedRoot}/${req.name}-${req.version}`;
	try {
		await f.mkdir(req.sharedRoot, { recursive: true });
	}
	catch (e) {
		return { stage: "lock_commit", ok: false, retryable: true, message: `生效切换失败：共享根不可建（${String(e)}）——附录 A lock_commit：请稍后重试` };
	}
	// 同版本重装：目标已存在先移除（重装 = 目录内容 fresh copy，幂等）；不同版本目录共存
	// （AC-P1-3：旧版本目录永不 prune——回滚保留，GC 属 P3）。fsp.rm 对缺失路径会抛，缺省即首装。
	try {
		await f.remove(versionDir, { recursive: true });
	}
	catch {
		// 目标不存在 = 首装，正常路径
	}
	// B-11：发布面 = 包内 api 模块目录（oj 原生清单 + routes.js + migrations/，serve 装配
	// parse_one 消费面——staging 整体发布会让版本目录缺模块清单/多 web 树）；web/ 与 C2 manifest
	// 留在 staging（deploying_web 段消费）。无 api 段（web-only 包，extracting C2-31 已放行）
	// 回退整体 rename——版本目录 = 包内容（无 serve 装配面的残留形态）。
	let src = req.staging;
	try {
		await f.readdir(`${req.staging}/api/${req.name}-${req.version}`);
		src = `${req.staging}/api/${req.name}-${req.version}`;
	}
	catch {
		// 无 api 段：整体 rename
	}
	try {
		await f.rename(src, versionDir);
	}
	catch (e) {
		return { stage: "lock_commit", ok: false, retryable: true, message: `生效切换失败：${src} rename 失败（${String(e)}）——附录 A lock_commit：请稍后重试` };
	}
	const c = await commitLockEntry(`${req.sharedRoot}/manifests.yaml`, req.name, req.version);
	if (!c.ok) {
		// 锁写失败回退 rename（锁未变则多余版本目录撤回，由锁前清场统一删；回退失败由 reconcile 兜底，D11）
		try {
			await f.rename(versionDir, src);
		}
		catch {
			// 残留版本目录不在锁内，release 装配忽略；对账自愈兜底
		}
		return { stage: "lock_commit", ok: false, retryable: true, message: c.message };
	}
	return { stage: "lock_commit", ok: true, message: `生效切换完成：${src} → ${versionDir} 就位 + ${c.message}（.bak 已备份原锁，D12；web 树留 staging 由部署段消费）` };
}

/**
 * manifest.yaml（C2 形状）→ SolutionDecl（D10 出口入参）：roles[].title_key → title、
 * settings.groups[].items[] 摊平、enum options 序列化为 JSON 字符串（sys_setting.options 形态）。
 */
export function declOf(req: InstallRequest): SolutionDecl {
	const m = isObj(req.manifest) ? req.manifest : {};
	const settings: SettingDecl[] = [];
	const groups = isObj(m.settings) && Array.isArray(m.settings.groups) ? m.settings.groups : [];
	for (const grp of groups) {
		if (!isObj(grp) || !Array.isArray(grp.items)) {
			continue;
		}
		for (const it of grp.items) {
			if (!isObj(it) || typeof it.key !== "string") {
				continue;
			}
			settings.push({
				key: it.key,
				group: typeof grp.group === "string" ? grp.group : "",
				type: typeof it.type === "string" ? it.type : "string",
				value: typeof it.value === "string" ? it.value : undefined,
				default_value: it.default_value == null ? null : String(it.default_value),
				label_key: typeof it.label_key === "string" ? it.label_key : null,
				options: Array.isArray(it.options) ? JSON.stringify(it.options) : it.options == null ? null : String(it.options),
				secret: it.secret === true,
			});
		}
	}
	return {
		module: req.name,
		version: req.version,
		roles: (Array.isArray(m.roles) ? m.roles : []).filter(isObj).map(r => ({
			name: typeof r.name === "string" ? r.name : "",
			title: typeof r.title_key === "string" ? r.title_key : "",
			permissions: Array.isArray(r.permissions) ? r.permissions.map(String) : [],
		})),
		settings,
		routes: (Array.isArray(m.routes) ? m.routes : []).filter(isObj).map(r => ({
			path: typeof r.path === "string" ? r.path : "",
			category: r.category === "admin" || r.category === "hidden" ? r.category : "main",
			order: typeof r.order === "number" ? r.order : 0,
			title_key: typeof r.title_key === "string" ? r.title_key : undefined,
			required_permission: typeof r.required_permission === "string" ? r.required_permission : undefined,
		})),
	};
}

async function registerStage(req: InstallRequest): Promise<StageResult> {
	return registerSolution(declOf(req));
}

async function deployWebStage(req: InstallRequest): Promise<StageResult> {
	// R10 包内容口径：对验签后落位的 entry 产物重算 sha384 传入（防 manifest 与产物错配；
	// 缺 web 段时 deployWeb 自行 no-op）。B-11 后 web 树不再随 lockCommit 进版本目录（发布面 =
	// api 模块目录），故 stagingDir/integrity 源都在 staging。
	const m = isObj(req.manifest) ? req.manifest : {};
	const web = isObj(m.web) ? m.web : undefined;
	const entry = web !== undefined && typeof web.entry === "string" ? web.entry : undefined;
	let integrity: string | undefined;
	if (entry !== undefined) {
		try {
			integrity = `sha384-${req.sha384B64(await fsFace().readFile(`${req.staging}/web/${entry}`))}`;
		}
		catch (e) {
			return { stage: "deploying_web", ok: false, retryable: false, message: `部署失败：web.entry「${entry}」在 staging 不可读（${String(e)}）——manifest 与产物错配（R10）` };
		}
	}
	return deployWeb({ ...req, stagingDir: req.staging, integrity });
}

/**
 * 热更段适配（B-11 reload 触发面）：先落盘触发变更再 reloadAndAssert——reloadConfig 的
 * unchanged 判定基于 config 文档 sha（oj-bin reload_bridge 真源），不落盘变更则热更恒
 * unchanged 必失败。触发变更 = vars.ojm_install_seq 自增（PRD E5 实测先例：vars 段语义值
 * 改动 applied 可热生效，无需改 mounts），经 text-edit 纯文本行操作（R18，注释/键序逐字保留）。
 */
async function reloadStage(req: InstallRequest): Promise<StageResult> {
	const path = req.configPath ?? "config.yaml";
	try {
		const content = new TextDecoder().decode(await fsFace().readFile(path));
		const bumped = bumpInstallSeq(content);
		await atomicWriteText(path, bumped.content);
	}
	catch (e) {
		return { stage: "reloading", ok: false, retryable: true, message: `热更失败：config.yaml 安装序号自增失败（${String(e)}）——reload unchanged 判定基于 config 文档 sha，无变更则热更不可能生效（B-11，PRD E5 口径）` };
	}
	return reloadAndAssert(req);
}

/** 终态审计（AC-P1-14）：done/partial 都落 oplog；自身失败仅日志（附录 B-5，不阻断任务终态） */
async function auditStage(req: InstallRequest): Promise<StageResult> {
	const status = req.outcome?.status ?? "done";
	const detail = { status, failedStage: req.outcome?.failedStage, taskId: req.outcome?.taskId };
	try {
		(req.audit ?? auditOp)({ action: "solution.install", module: req.name, version: req.version, target: req.name, detail });
		return { stage: "audit", ok: true, message: `终态审计已落 oplog（solution.install，status=${status}；失败也审计，AC-P1-14）` };
	}
	catch (e) {
		console.warn(`installer: 终态审计失败（仅日志，不阻断任务终态，附录 B-5）：${String(e)}`);
		return { stage: "audit", ok: true, message: `终态审计失败仅记日志：${String(e)}` };
	}
}

/**
 * 十阶段声明式状态机表（契约附录 A stage 名逐字；lock_commit 为 D11①扩展组）。
 * audit 恒末位：runInstall 两段调用——前十个 stage 顺序遍历，done/partial 终态确定后跑 audit
 * （终态审计含 partial；预检段失败零痕迹含审计——失败语义①什么都没发生就什么都不留）。
 */
export const STAGES: StageDef[] = [
	{ name: "preflight", run: req => preflight(req) },
	{ name: "downloading", run: req => download(req) },
	{ name: "verifying", run: req => verify(req) },
	{ name: "extracting", run: req => extract(req) },
	{ name: "migrating", run: migrateStage },
	{ name: "lock_commit", run: lockCommitStage },
	{ name: "registering", run: registerStage },
	{ name: "deploying_web", run: deployWebStage },
	{ name: "reloading", run: reloadStage },
	{ name: "smoke", run: req => smoke(req) },
	{ name: "audit", run: auditStage },
];

const PIPELINE = STAGES.filter(s => s.name !== "audit");
const AUDIT_DEF = STAGES[STAGES.length - 1]!;

/**
 * 声明式遍历 stage 表执行安装（§10.2 任务模型）：任务文件逐 stage 落盘（800ms 轮询消费面）、
 * .install-tasks/.lock 互斥（R17/R31）、失败语义三分、终态审计含 partial（AC-P1-14）。
 * 返回终态 TaskRecord（done / failed / partial / busy failed）。
 */
export async function runInstall(req: InstallRequest): Promise<TaskRecord> {
	const now = Date.now();
	const id = `install-${now}-${randomId().slice(0, 8)}`;
	const task: TaskRecord = {
		id,
		name: req.name,
		version: req.version,
		status: "running",
		stage: null,
		progress: 0,
		message: "任务已创建",
		stages: [],
		startedAt: now,
	};
	req.outcome = { ...req.outcome, taskId: id };
	// 同名已装 = 升级/重装路径（AC-P1-3）：放行位交 preflight（缺省拒装钉面不变）
	req.reinstall = req.state.read().solutions[req.name] !== undefined;
	// 任务互斥（R17/R31）：并发安装 busy 即终（retryable——稍后重试）
	let lock: TaskLock;
	try {
		lock = await acquireTaskLock(req.taskDir, { now });
	}
	catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		task.status = "failed";
		task.message = msg;
		task.error = { reason: msg, retryable: true };
		task.finishedAt = Date.now();
		try {
			await writeTask(req.taskDir, task);
		}
		catch {
			// 任务面写入失败不掩盖 busy 终态
		}
		return task;
	}
	try {
		// 对账时点纪律（R13/B9/R31）：残留 running 超时判 failed，再开新任务
		await sweepTimedOut(req.taskDir, now);
		await writeTask(req.taskDir, task);
		for (let i = 0; i < PIPELINE.length; i++) {
			const def = PIPELINE[i]!;
			task.stage = def.name;
			task.message = `执行中：${def.name}`;
			await writeTask(req.taskDir, task);
			let r: StageResult;
			try {
				r = await def.run(req);
			}
			catch (e) {
				const stack = e instanceof Error && e.stack !== undefined ? ` @ ${e.stack.split("\n")[1]?.trim() ?? ""}` : "";
				r = { stage: def.name, ok: false, retryable: true, message: `${def.name} 阶段异常：${String(e)}${stack}` };
			}
			task.stages.push({ stage: def.name, ok: r.ok, message: r.message });
			if (task.appliedSeq === undefined && req.outcome?.appliedSeq != null) {
				task.appliedSeq = req.outcome.appliedSeq;
			}
			if (!r.ok) {
				task.stage = def.name;
				task.message = r.message;
				task.error = { reason: r.message, retryable: r.retryable ?? true, hintKey: `lifecycle.stage.${def.name}.hint` };
				if (PRE_LOCK_STAGES.has(def.name)) {
					// 失败语义①：锁前清场重跑——staging 删除；锁/库表/清单/sidecar/审计零改动
					task.status = "failed";
					try {
						await fsFace().remove(req.staging, { recursive: true });
					}
					catch {
						// 清场失败不掩盖失败终态（staging 不在锁内，release 装配忽略）
					}
				}
				else {
					// 失败语义②：锁后 partial——部分生效，不回滚已落位产物，给回滚指引 key
					task.status = "partial";
				}
				req.outcome = { ...req.outcome, status: task.status, failedStage: def.name };
				break;
			}
			task.progress = Math.round(((i + 1) / STAGES.length) * 100);
			task.message = r.message;
			await writeTask(req.taskDir, task);
		}
		if (task.status === "running") {
			task.status = "done";
			req.outcome = { ...req.outcome, status: "done" };
		}
		if (task.status === "done" || task.status === "partial") {
			// 终态审计（audit 恒末位，进 stages 明细；失败仅日志不阻断）
			const ar = await AUDIT_DEF.run(req);
			task.stages.push({ stage: AUDIT_DEF.name, ok: ar.ok, message: ar.message });
			// sidecar 同步（D12 元数据；done/partial 均记录——版本已实际落位，enabled 与锁一致）
			try {
				await req.state.write({ solutions: { [req.name]: { version: req.version, enabled: true, installedAt: Date.now() } } });
			}
			catch (e) {
				console.warn(`installer: sidecar 写入失败（元数据滞后，不影响安装主流程）：${String(e)}`);
			}
			// market_history 留痕（P1-15a 缺口 A，history.ts 守卫式：表不存在/写失败静默，不阻断终态）。
			// message 按终态生成人话（task.message 此时是末 stage 文案，对历史消费面不可读）
			await recordHistory({
				solution: req.name,
				version: req.version,
				action: "install",
				status: task.status,
				operator: null,
				message: task.status === "done" ? `安装完成：${req.name}@${req.version}` : `安装部分生效（status=partial）：${req.name}@${req.version}`,
			});
		}
		if (task.status === "done") {
			task.stage = "done";
			task.progress = 100;
		}
		task.finishedAt = Date.now();
		await writeTask(req.taskDir, task);
	}
	finally {
		await lock.release();
	}
	return task;
}

/**
 * 单条任务查询（§10.2 轮询消费面）。偏离简报签名：oj 的 fs 面是异步的，同步 `getTask(id)`
 * 不可能——加 taskDir 首参（同 state/lock 各读函数的 AsyncFace 惯例）。
 */
export function taskOf(taskDir: string, id: string): Promise<TaskRecord | null> {
	return getTask(taskDir, id);
}

export interface ReconcileInput {
	/** 锁路径（<sharedRoot>/manifests.yaml） */
	lockPath: string
	sharedRoot: string
	taskDir: string
	/** 站点迁移账本 head（P1-16 接线 = oj journal 查询；测试注入） */
	ledgerHeadOf: (name: string) => Promise<number | bigint | null>
	/** 锁指版本要求的最低 head（生产缺省 = 安装任务记录 appliedSeq，见 latestAppliedSeqOf；P1-16 可换 oj journal 推导） */
	headFloorOf: (name: string, version: string) => Promise<number | bigint | null>
	/** sys_solution_route enabled 查询（缺省不查该项） */
	routeEnabledOf?: (name: string) => Promise<boolean | null>
	/** 站点 modules.json 路径（缺省不查该项） */
	modulesJsonPath?: string
	now?: number
}

export interface ReconcileReport {
	checked: string[]
	healed: { name: string, action: "repoint" | "remove", from: string, to: string | null, reason: string }[]
	inconsistencies: { name: string, kind: "lock_corrupt" | "modules_json" | "route_disabled", detail: string }[]
}

async function dirExists(path: string): Promise<boolean> {
	try {
		await fsFace().readdir(path);
		return true;
	}
	catch {
		return false;
	}
}

/** 对账摘除后的 failed 任务记录（可观测：市场页/CLI 能看到方案为何消失） */
async function writeReconcileFailed(taskDir: string, name: string, version: string, reason: string): Promise<void> {
	const now = Date.now();
	await writeTask(taskDir, {
		id: `reconcile-${now}-${randomId().slice(0, 8)}`,
		name,
		version,
		status: "failed",
		stage: null,
		progress: 0,
		message: reason,
		stages: [],
		startedAt: now,
		finishedAt: now,
		error: { reason, retryable: true },
	});
}

/**
 * 入口对账自愈（D11）：锁条目 ↔ 账本 head 一致性检查 + 自愈。锁指新版但账本 head 低于该版本
 * 要求的 floor（M004 账本落后拒启形态）→ 有 .bak 且旧版本目录俱在则回指旧版；无旧版可指则摘除
 * 条目并记 failed 任务。modules.json / route enabled 只检查报告（修复需条目数据，P1-16 接线）。
 * 对账时点顺带执行超时 running 判 failed（R13/B9/R31）。坏锁 fail-closed：只报告不猜。
 */
export async function reconcile(input: ReconcileInput): Promise<ReconcileReport> {
	const report: ReconcileReport = { checked: [], healed: [], inconsistencies: [] };
	const now = input.now ?? Date.now();
	await sweepTimedOut(input.taskDir, now);
	let lock: Record<string, string>;
	try {
		lock = await readLock(input.lockPath);
	}
	catch (e) {
		report.inconsistencies.push({ name: "*", kind: "lock_corrupt", detail: `坏锁（fail-closed 不猜）：${String(e)}` });
		return report;
	}
	for (const [name, version] of Object.entries(lock)) {
		report.checked.push(name);
		const head = await input.ledgerHeadOf(name);
		const floor = await input.headFloorOf(name, version);
		if (head == null || floor == null || Number(head) >= Number(floor)) {
			continue;
		}
		const reason = `账本 head ${head} 低于锁指 ${version} 要求的 seq ${floor}（M004 账本落后形态）——对账自愈`;
		let healed = false;
		try {
			const prev = (await readLock(`${input.lockPath}.bak`))[name];
			if (prev !== undefined && prev !== version && await dirExists(`${input.sharedRoot}/${name}-${prev}`)) {
				const entries = { ...lock, [name]: prev };
				await writeLock(input.lockPath, entries);
				lock = entries;
				report.healed.push({ name, action: "repoint", from: version, to: prev, reason: `${reason}：已回指旧版 ${prev}` });
				healed = true;
			}
		}
		catch {
			// .bak 不可读视同无旧版可指，走摘除
		}
		if (!healed) {
			const entries = { ...lock };
			delete entries[name];
			if (Object.keys(entries).length === 0) {
				report.inconsistencies.push({ name, kind: "lock_corrupt", detail: `${reason}：但摘除后锁为空（空锁拒启，S1-1.2）——需人工处置` });
				continue;
			}
			await writeLock(input.lockPath, entries);
			lock = entries;
			report.healed.push({ name, action: "remove", from: version, to: null, reason: `${reason}：无旧版可指，已摘除` });
			await writeReconcileFailed(input.taskDir, name, version, `${reason}：无旧版可指，已摘除`);
		}
	}
	// modules.json 一致性（只报不修——修复需 web 条目数据，P1-16 接线）
	if (input.modulesJsonPath !== undefined) {
		try {
			const list: unknown = JSON.parse(new TextDecoder().decode(await fsFace().readFile(input.modulesJsonPath)));
			const entries = Array.isArray(list) ? list.filter(isObj) : null;
			if (entries === null) {
				report.inconsistencies.push({ name: "*", kind: "modules_json", detail: "modules.json 顶层不是数组" });
			}
			else {
				for (const name of Object.keys(lock)) {
					const e = entries.find(x => x.name === name);
					if (e === undefined) {
						report.inconsistencies.push({ name, kind: "modules_json", detail: "锁有条目而 modules.json 缺条目（web 侧未部署或被清）" });
					}
					else if (e.enabled === false) {
						report.inconsistencies.push({ name, kind: "modules_json", detail: "锁在而 modules.json enabled=false（三处同写不齐，建议重跑 setEnabled 修复）" });
					}
				}
			}
		}
		catch {
			report.inconsistencies.push({ name: "*", kind: "modules_json", detail: "modules.json 不可读或损坏" });
		}
	}
	// route enabled 一致性（只报不修，同上）
	if (input.routeEnabledOf !== undefined) {
		for (const name of Object.keys(lock)) {
			const en = await input.routeEnabledOf(name).catch(() => null);
			if (en === false) {
				report.inconsistencies.push({ name, kind: "route_disabled", detail: "锁在而 sys_solution_route.enabled=0（建议重跑 setEnabled(true) 修复）" });
			}
		}
	}
	return report;
}

export interface SetEnabledInput {
	name: string
	enabled: boolean
	/** 共享根（版本目录父级，启用恢复时校验版本目录仍在） */
	sharedRoot: string
	/** 锁路径（<sharedRoot>/manifests.yaml） */
	lockPath: string
	state: StateStore
	/** 站点 modules.json 路径 */
	modulesJsonPath: string
	now?: number
}

/**
 * 禁用/启用四处同写（D12/AC-P1-6）：①锁摘除/恢复（禁用 = 从锁摘条目——目录保留，oj 按锁逐条
 * 装配，摘除即不挂载；启用 = 从 sidecar 摘除前记录恢复版本目录）→ ②sidecar enabled →
 * ③sys_solution_route.enabled → ④modules.json enabled。锁改写走 writeLock（.bak 备份）；
 * 摘除后锁为空拒绝（空锁拒启，S1-1.2）。生命周期开关操作不违 D10（D10 禁的是注册内容直写）。
 */
export async function setEnabled(input: SetEnabledInput): Promise<{ ok: boolean, message: string }> {
	const { name, enabled } = input;
	const now = input.now ?? Date.now();
	const f = fsFace();
	const side = input.state.read().solutions[name];
	const audit = (ok: boolean, detail: string): void => {
		auditOp({ action: enabled ? "solution.enable" : "solution.disable", module: name, target: name, detail: { ok, detail }, level: ok ? 6 : 4 });
	};
	// ① 锁摘除/恢复
	const lock = await readLock(input.lockPath);
	let version: string;
	if (enabled) {
		if (side === undefined) {
			const msg = `启用失败：sidecar 无「${name}」记录（从未安装成功或元数据丢失），无可恢复版本`;
			audit(false, msg);
			return { ok: false, message: msg };
		}
		if (!await dirExists(`${input.sharedRoot}/${name}-${side.version}`)) {
			const msg = `启用失败：版本目录 ${name}-${side.version} 缺失（已卸载？），无可恢复版本`;
			audit(false, msg);
			return { ok: false, message: msg };
		}
		version = side.version;
		lock[name] = version;
	}
	else {
		const v = lock[name] ?? side?.version;
		if (v === undefined) {
			const msg = `禁用失败：「${name}」未安装`;
			audit(false, msg);
			return { ok: false, message: msg };
		}
		version = v;
		delete lock[name];
		if (Object.keys(lock).length === 0) {
			const msg = "禁用失败：摘除后锁为空（空锁拒启，S1-1.2）——站点至少保留一个已锁模块";
			audit(false, msg);
			return { ok: false, message: msg };
		}
	}
	try {
		await writeLock(input.lockPath, lock);
	}
	catch (e) {
		audit(false, `锁写失败：${String(e)}`);
		return { ok: false, message: `禁用/启用失败：锁写失败（${String(e)}）——四处同写中止，状态未变` };
	}
	// ② sidecar（version 保留摘除前记录，启用从它恢复）
	try {
		await input.state.write({ solutions: { [name]: { version, enabled, installedAt: side?.installedAt ?? now } } });
	}
	catch (e) {
		audit(false, `sidecar 写失败：${String(e)}`);
		return { ok: false, message: `禁用/启用失败：sidecar 写失败（${String(e)}）——锁已更新，元数据滞后` };
	}
	// ③ route 表 enabled（生命周期开关，非注册内容直写，D10 不适用）
	try {
		await db.exec("update sys_solution_route set enabled = ? where module = ?", [enabled ? 1 : 0, name]);
	}
	catch (e) {
		audit(false, `route enabled 写失败：${String(e)}`);
		return { ok: false, message: `禁用/启用失败：sys_solution_route 写失败（${String(e)}）——锁与 sidecar 已更新，路由开关滞后` };
	}
	// ④ modules.json enabled（条目不存在 = api-only 方案，该项天然一致）
	try {
		const list = JSON.parse(new TextDecoder().decode(await f.readFile(input.modulesJsonPath))) as unknown[];
		if (!Array.isArray(list)) {
			throw new TypeError("modules.json 顶层不是数组");
		}
		let hit = false;
		const next = list.map(e => (isObj(e) && e.name === name) ? ((hit = true), { ...e, enabled }) : e);
		if (hit) {
			await atomicWriteText(input.modulesJsonPath, `${JSON.stringify(next, null, 2)}\n`);
		}
	}
	catch (e) {
		audit(false, `modules.json 写失败：${String(e)}`);
		return { ok: false, message: `禁用/启用失败：modules.json 写失败（${String(e)}）——锁/sidecar/route 已更新，前端开关滞后` };
	}
	const msg = `${enabled ? "启用" : "禁用"}完成：锁${enabled ? "恢复" : "摘除"} + sidecar + sys_solution_route.enabled + modules.json enabled 四处同写（D12/AC-P1-6）`;
	audit(true, msg);
	// market_history 留痕（P1-15a 缺口 A，history.ts 守卫式：表不存在/写失败静默，不阻断开关结果）
	await recordHistory({ solution: name, version, action: enabled ? "enable" : "disable", status: "success", operator: null, message: msg });
	return { ok: true, message: msg };
}

/**
 * 启用恢复的 floor 依据：安装任务记录里该 name@version 最近一次成功（done/partial）的 appliedSeq
 * （reconcile headFloorOf 的生产缺省实现；P1-16 可换 oj journal 推导）。
 */
export async function latestAppliedSeqOf(taskDir: string, name: string, version: string): Promise<number | null> {
	const hits = (await readTasks(taskDir))
		.filter(t => t.name === name && t.version === version && t.appliedSeq != null && (t.status === "done" || t.status === "partial"))
		.sort((a, b) => b.startedAt - a.startedAt);
	return hits[0]?.appliedSeq ?? null;
}
