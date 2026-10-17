// 迁移步骤（P1-7，十阶段 stage 5 migrating；D11 核心裁决：迁移成功后才允许后续落锁）。
// R14：迁移前置备份——sqlite 库 copy 为 <db>.bak-<ts>（fsFace.copyFile，本任务补面），无备份不迁移
// （fail-closed：备份不可用则不执行 oj migrate，库保持原状）；完成后清理仅保留最近 3 份 .bak-*
// （按时间戳后缀数值比较；清理失败仅告警，多留备份无害，不阻断主流程）。
// S1-6 实测契约（oj 0.1.76）：exec.run(["oj","migrate","--format","json","-d",dir,module])——"oj" 由
// oj 特判解析为当前进程 exe，platform.exec 白名单逐字匹配，argv 不得增删改；stdout 恰一行 JSON
// {"results":[{module,ok,applied:[{version,name}],error?}]}（装配期全局失败时顶层 error + results 空）；
// 成败真源 = exit code（exit 0 = 全部成功），逐模块 continue-and-collect，一个模块失败不阻断其余。
// 失败语义：StageResult{ok:false} + 可诊断摘要（含原始 error/results 截断入 message）——本步绝不触碰
// 锁与 state（落锁在 P1-10 编排；release 门禁 M003 账本超前拒启 / M004 账本落后拒启要求锁与账本
// 永不半落）。rollbackGuard 纯函数：目标产物最大 seq < 账本 head = 降版部署，禁止（OJ-9 红线，
// M003 同源）；seq 是迁移序号非版本号，直接数值比较（semver.ts 不适用）。

import type { FsFace } from "../atomic";
import type { ExecFace } from "./extract";
import type { InstallContext } from "./preflight";
import { fsFace } from "../atomic";

export interface MigrateContext extends InstallContext {
	/** 站点数据目录（`oj migrate -d` 实参） */
	dataDir: string
	/** sqlite 库文件路径（R14 备份源；备份落同目录 <db>.bak-<ts>） */
	dbPath: string
	/** 注入式 exec 面（生产 = 平台 exec.run 包装；测试 stub 不真跑 oj，同 extract DIP） */
	exec: ExecFace
	/** 当前迁移账本 head（P1-10 对账产物）；缺省跳过禁降版判定 */
	ledgerHead?: number | bigint | null
}

export interface StageResult {
	stage: "migrating"
	ok: boolean
	message: string
	retryable?: boolean
}

export interface MigrateApplied {
	/** 迁移 seq（数值序号非版本号，rollbackGuard 数值比较的来源） */
	version: number
	name: string
}

export interface MigrateModuleResult {
	module: string
	ok: boolean
	applied: MigrateApplied[]
	/** 失败原因原文（S1-6：DSN 已脱敏；仅诊断用，不参与判定） */
	error?: unknown
}

export interface MigrateOutput {
	results: MigrateModuleResult[]
	/** 装配期全局失败原因（S1-6：此时 results 为空；成败仍以 exit code 为真源） */
	error?: unknown
}

/** oj migrate 命令（逐字断言）：与 platform.exec 白名单逐字对齐（S1-2/S1-6 基座），不得增删旗标 */
export function buildMigrateCmd(dir: string, module: string): string[] {
	return ["oj", "migrate", "--format", "json", "-d", dir, module];
}

/**
 * 解析 stdout 恰一行的 json 输出（纯函数，直测用）。严格形状校验：顶层键值对象 + results 数组 +
 * 条目 {module:string, ok:boolean, applied:{version:number,name:string}[]}；任何偏差都算契约破坏
 * （fail-closed）。尾随换行/空白先 trim（stdout 恒带换行）。results 为空 + 顶层 error 是合法形态
 * （装配期全局失败），成败判定交由 exit code。
 */
export function parseMigrateOutput(stdout: string): { ok: true, output: MigrateOutput } | { ok: false, message: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(stdout.trim());
	}
	catch (e) {
		return { ok: false, message: `oj migrate stdout 不是合法 JSON（S1-6 契约：恰一行 {"results":[...]}）：${String(e)}` };
	}
	if (!isObj(raw)) {
		return { ok: false, message: `oj migrate stdout 顶层不是键值对象（实为 ${raw === null ? "null" : Array.isArray(raw) ? "数组" : typeof raw}）` };
	}
	const resultsRaw = raw.results;
	if (!Array.isArray(resultsRaw)) {
		return { ok: false, message: "oj migrate stdout 缺少 results 数组（S1-6 契约）" };
	}
	const results: MigrateModuleResult[] = [];
	for (const entry of resultsRaw) {
		if (!isObj(entry) || typeof entry.module !== "string" || typeof entry.ok !== "boolean" || !Array.isArray(entry.applied)) {
			return { ok: false, message: `oj migrate results 条目形状不符（须为 {module:string, ok:boolean, applied:array}，实为 ${JSON.stringify(entry)?.slice(0, 200)}）` };
		}
		const applied: MigrateApplied[] = [];
		for (const a of entry.applied) {
			if (!isObj(a) || typeof a.version !== "number" || typeof a.name !== "string") {
				return { ok: false, message: `oj migrate「${entry.module}」applied 条目形状不符（须为 {version:number, name:string}）` };
			}
			applied.push({ version: a.version, name: a.name });
		}
		results.push({ module: entry.module, ok: entry.ok, applied, error: entry.error });
	}
	return { ok: true, output: { results, error: raw.error } };
}

/** 目标产物最大迁移 seq（裁决：seq 从 applied[] 的 max(version) 取得）；无任何 applied（no-op）返回 null */
export function maxAppliedSeq(output: MigrateOutput): number | null {
	let max: number | null = null;
	for (const r of output.results) {
		for (const a of r.applied) {
			if (max === null || a.version > max) {
				max = a.version;
			}
		}
	}
	return max;
}

/**
 * 禁降版守卫（纯函数，OJ-9 红线）：true=放行——目标产物最大 seq ≥ 当前账本 head，或账本为空
 * （0/null = 首装）；目标 < head 返回 false（禁降版部署，M003 同源）。number/bigint 混比安全
 * （关系运算符语义），调用方按各自信源的实际类型传入。
 */
export function rollbackGuard(targetMaxSeq: number | bigint, ledgerHead: number | bigint | null | undefined): boolean {
	if (ledgerHead === null || ledgerHead === undefined || ledgerHead === 0 || ledgerHead === 0n) {
		return true;
	}
	return targetMaxSeq >= ledgerHead;
}

/** R14 清理策略：完成后仅保留最近 3 份 .bak- */
const KEEP_BACKUPS = 3;

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function backupDb(dbPath: string): Promise<string> {
	const f = fsFace();
	const bak = `${dbPath}.bak-${Date.now()}`;
	await f.copyFile(dbPath, bak);
	await pruneBackups(dbPath, f);
	return bak;
}

/** 清理旧备份仅保留最近 KEEP_BACKUPS 份；任一失败仅告警（多留一份无害），不阻断迁移主流程 */
async function pruneBackups(dbPath: string, f: FsFace): Promise<void> {
	const slash = dbPath.lastIndexOf("/");
	const dir = slash === -1 ? "." : dbPath.slice(0, slash);
	const base = slash === -1 ? dbPath : dbPath.slice(slash + 1);
	const prefix = `${base}.bak-`;
	let entries: string[];
	try {
		entries = await f.readdir(dir);
	}
	catch (e) {
		console.warn(`migrate: 备份清理失败（.bak-* 全量保留，不影响迁移）：${String(e)}`);
		return;
	}
	const stale = entries
		.filter(e => e.startsWith(prefix))
		.map((e) => {
			const n = Number(e.slice(prefix.length));
			return { e, ts: Number.isFinite(n) ? n : -1 };
		})
		.sort((a, b) => b.ts - a.ts)
		.slice(KEEP_BACKUPS);
	for (const { e } of stale) {
		try {
			await f.remove(`${dir}/${e}`, { recursive: true });
		}
		catch {
			// 单份清理失败不掩盖迁移结果
		}
	}
}

export async function migrate(ctx: MigrateContext): Promise<StageResult> {
	// 第一步 R14：前置备份——备份不可用即不迁移（fail-closed，exec 零调用，库保持原状）
	let bak: string;
	try {
		bak = await backupDb(ctx.dbPath);
	}
	catch (e) {
		return { stage: "migrating", ok: false, retryable: true, message: `迁移失败：前置备份不可用（${String(e)}）——无备份不迁移（R14），未执行 oj migrate，库保持原状` };
	}
	try {
		// 第二步 exec：成败真源 = exit code（S1-6 实测；逐模块 continue-and-collect 由 oj 保证）
		const r = await ctx.exec.run(buildMigrateCmd(ctx.dataDir, ctx.name));
		if (r.code !== 0) {
			return {
				stage: "migrating",
				ok: false,
				retryable: true,
				message: `迁移失败：oj migrate exit ${r.code}（附录 A migrating：数据已保留原状，请修复后重试；备份 ${bak} 可供回退）——输出摘要：${(r.stderr || r.stdout).trim().slice(0, 500)}`,
			};
		}
		// 第三步解析：exit 0 但输出违约属契约破坏，重试不自愈（retryable=false）
		const parsed = parseMigrateOutput(r.stdout);
		if (!parsed.ok) {
			return { stage: "migrating", ok: false, retryable: false, message: `迁移失败：${parsed.message}（备份 ${bak} 可供回退；附录 A migrating）` };
		}
		// 逐模块复核：exit 0 但含 ok=false 属输出自相矛盾，按失败处理（fail-closed）
		const failed = parsed.output.results.filter(x => !x.ok);
		if (failed.length > 0) {
			return {
				stage: "migrating",
				ok: false,
				retryable: true,
				message: `迁移失败：${failed.length} 个模块迁移未通过（附录 A migrating：数据已保留原状；备份 ${bak} 可供回退）——${failed.map(x => `${x.module}: ${String(x.error ?? "ok=false")}`).join("；").slice(0, 500)}`,
			};
		}
		// 第四步禁降版红线（OJ-9，M003 同源）：目标产物 max seq < 账本 head 拒切；applied 为空
		// （no-op 同版重装）无从判定，交由 oj 自身 M003/missing-from-filesystem 门禁兜底
		if (ctx.ledgerHead !== undefined) {
			const target = maxAppliedSeq(parsed.output);
			if (target !== null && !rollbackGuard(target, ctx.ledgerHead)) {
				return {
					stage: "migrating",
					ok: false,
					retryable: false,
					message: `迁移失败：目标产物最大 seq ${target} 低于账本 head ${ctx.ledgerHead}——禁降版部署（OJ-9 红线，M003 同源）；锁与状态保持原样（D11），备份 ${bak} 可供回退`,
				};
			}
		}
		const appliedCount = parsed.output.results.reduce((n, x) => n + x.applied.length, 0);
		return {
			stage: "migrating",
			ok: true,
			message: `迁移完成：${parsed.output.results.length} 个模块、共 ${appliedCount} 条迁移已应用（账据 = oj migrate --format json 的 applied[]；备份 ${bak}，保留最近 ${KEEP_BACKUPS} 份；迁移成功后才允许后续落锁，D11/R2）`,
		};
	}
	catch (e) {
		return { stage: "migrating", ok: false, retryable: true, message: `迁移失败：${String(e)}（备份 ${bak} 可供回退；附录 A migrating）` };
	}
}
