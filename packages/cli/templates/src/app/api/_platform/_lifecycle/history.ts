// market_history 留痕（P1-15a 缺口 A，P4 上收 _platform）：install / enable / disable / uninstall
// 四类动作共用的平台级留痕出口（前端 HistoryDrawer 消费面）；v4 起 publish（签名推送）/
// yank（目录下线）同通道留痕（成败俱记）。表由 _platform 自带迁移创建
// （0012__market_history），归平台核心所有；守卫式 insert 仍兜底表缺失/写失败，静默跳过，
// 不阻断主流程（历史是观测面，不是业务正确性依赖；与终态审计附录 B-5 同语义）。
// 参数化 insert，与 audit.ts 同纪律（值不拼字符串）。
// 2026-11-08 扩展：安装失败也要留痕（terminalNote 出口在 installer.ts），并提供「删除未成功版本」的
// 数据面——记录清洗 + 残留版本目录清理，见 purgeFailedInstall。

import type { StateStore } from "./state";
import { fsFace } from "./atomic";
import { readLock } from "./lock";
import { redact } from "./tasks";

// db 为 oj isolate 注入全局（同模板 service 层惯例，installer.ts 同款；测试由夹具装 globalThis.db）
declare const db: { exec: (sql: string, params: unknown[]) => Promise<unknown>, table: (name: string) => any };

export interface HistoryRow {
	solution: string
	version: string
	action: "install" | "enable" | "disable" | "uninstall" | "publish" | "yank" | "unyank"
	status: string
	/** 操作人（用户名；编排层可得则传，缺省 null） */
	operator: string | null
	message: string
}

/**
 * 守卫式 insert：表不存在/写失败一律静默（留痕失败不影响主流程）。
 * message 落表前统一脱敏（与任务文件同口径）：安装失败的明细来自迁移 stderr / 下载 URL，
 * 可能带连接串口令或 token——市场历史对 admin 可见，且会长期留存，不能只信调用方干净。
 */
export async function recordHistory(row: HistoryRow): Promise<void> {
	try {
		await db.table("market_history").insert({
			solution: row.solution,
			version: row.version,
			action: row.action,
			status: row.status,
			operator: row.operator,
			message: redact(row.message),
			created_at: Math.floor(Date.now() / 1000),
		}).run();
	}
	catch {
		// 表不存在（市场方案未装）或写失败：静默跳过，不阻断主流程
	}
}

/**
 * 安装「成功」的 status 集合：done = 完整生效；partial = 产物已生效、只差宿主重启（restartRequired）。
 * 其余（failed / needs_trust / cancelled）都是「这个版本没装上」，可被 purgeFailedInstall 清理。
 */
export const INSTALL_SUCCESS_STATUSES: readonly string[] = ["done", "partial"];

/** 第一方平台模块：版本目录随平台内置（dist/api/<name>-<ver>），任何「删除版本」都不许碰 */
const PLATFORM_OWNED = new Set(["oj-market", "_platform"]);

/** 方案名/版本白名单（与 yank 端点同源口径；同时挡住路径穿越——拼目录前先过闸） */
const SAFE_SOLUTION = /^[a-z][a-z0-9-]{0,63}$/i;
const SAFE_VERSION = /^[0-9A-Z][0-9A-Z.+-]{0,63}$/i;

export interface PurgeFailedInstallInput {
	name: string
	version: string
	/** 共享根（版本目录父级） */
	sharedRoot: string
	/** 锁路径（<sharedRoot>/manifests.yaml） */
	lockPath: string
	state: StateStore
}

export interface PurgeFailedInstallResult {
	ok: boolean
	/** 删除的安装记录条数 */
	deleted: number
	/** 是否清理了残留版本目录 */
	removedDir: boolean
	message: string
}

/**
 * 删除「未安装成功」的版本（2026-11-08 用户需求）：清掉该版本全部 install 记录（多次失败尝试一并删），
 * 并 best-effort 移除残留版本目录。守卫（与 uninstall/setEnabled 同纪律，领域拒绝走 ok:false 人话）：
 * - 第一方平台模块（oj-market/_platform）不删——版本目录是平台内置，删了整站编排面消失；
 * - 曾安装成功（历史里有 done/partial）不删——那不是「失败版本」，要移除请走卸载/回滚；
 * - 当前生效（锁或 sidecar 指向该版本）不删——避免把正在服务的版本抽走。
 * 删除记录与目录非原子：目录清理失败仍返回 ok:true + 如实文案（记录已清，残留目录可由运维手工删）。
 */
export async function purgeFailedInstall(input: PurgeFailedInstallInput): Promise<PurgeFailedInstallResult> {
	const { name, version } = input;
	const refuse = (message: string): PurgeFailedInstallResult => ({ ok: false, deleted: 0, removedDir: false, message });
	if (!SAFE_SOLUTION.test(name) || !SAFE_VERSION.test(version))
		return refuse(`name/version 非法：「${name}@${version}」——solution ^[a-z][a-z0-9-]{0,63}$、版本字母数字开头`);
	if (PLATFORM_OWNED.has(name))
		return refuse(`删除被拒：「${name}」是第一方平台模块，其版本目录随平台内置，不能按方案版本删除`);
	let rows: Array<{ status?: unknown }>;
	try {
		rows = await db.table("market_history")
			.select(["id", "status"])
			.where({ field: "solution", op: "eq", value: name })
			.where({ field: "version", op: "eq", value: version })
			.where({ field: "action", op: "eq", value: "install" })
			.all() as Array<{ status?: unknown }>;
	}
	catch {
		return refuse("操作历史不可读（表不存在或查询失败），未做任何删除");
	}
	if (rows.length === 0)
		return refuse(`没有「${name}@${version}」的安装记录（可能已被清理）`);
	if (rows.some(r => INSTALL_SUCCESS_STATUSES.includes(String(r.status))))
		return refuse(`「${name}@${version}」曾安装成功（含部分生效），不能按「未成功版本」删除；如需移除请用卸载或回滚`);
	// 当前生效保护：锁 / sidecar 任一指向该版本即拒绝（先读后删，与 uninstall 同口径）
	let locked: string | undefined;
	try {
		locked = (await readLock(input.lockPath))[name];
	}
	catch {
		locked = undefined; // 锁不可读不阻断判定：下面 sidecar 还会兜一层
	}
	let current: string | undefined;
	try {
		current = input.state.read().solutions[name]?.version;
	}
	catch {
		current = undefined;
	}
	if (locked === version || current === version)
		return refuse(`「${name}@${version}」当前仍在生效（锁或 sidecar 指向该版本），不能删除；请先回滚/卸载到其他版本`);
	try {
		await db.table("market_history")
			.where({ field: "solution", op: "eq", value: name })
			.where({ field: "version", op: "eq", value: version })
			.where({ field: "action", op: "eq", value: "install" })
			.delete()
			.run();
	}
	catch (e) {
		return refuse(`删除安装记录失败：${String(e)}`);
	}
	// 残留版本目录清理（best-effort）：目录不存在不算失败，存在但删不掉如实报告
	const dir = `${input.sharedRoot}/${name}-${version}`;
	let removedDir = false;
	let dirError: string | null = null;
	try {
		await fsFace().readdir(dir);
		try {
			await fsFace().remove(dir, { recursive: true, force: true });
			removedDir = true;
		}
		catch (e) {
			dirError = String(e);
		}
	}
	catch {
		// 目录不存在 = 失败发生在锁前（迁移/验签等），无残留可清
	}
	return {
		ok: true,
		deleted: rows.length,
		removedDir,
		message: `已删除「${name}@${version}」的 ${rows.length} 条未成功安装记录${removedDir ? "，并清理了残留版本目录" : "（无残留版本目录）"}${dirError !== null ? `；版本目录清理失败：${dirError}` : ""}`,
	};
}
