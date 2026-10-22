import type { VerifyItem } from "./verify-checks";
// 深检报告结构 + 时间序留存（P2-8，C2-42）：VerifyReport 定义、verify-reports 落盘、N=10 留存、
// 按 name 取最新。i18n 项本仓只下发待查 key 清单（advise），前端经 oj-market 解析；缺执行降级
// 「未校验」不阻断（不在此处解析文案）——编排见 solutions/api.ts。
// 设值永不进报告（checks 只报 id/path/code/key；secret 同只报 key）——与 verify-checks 同纪律。
import { atomicWriteText, fsFace } from "./atomic";

/** 深检报告（契约 §2.13：{ok, checks[], advise[]}） */
export interface VerifyReport {
	/** 是否存在 error 级检查项（无 error = 整体通过；warn/info 不阻断） */
	ok: boolean
	/** 检查项（routes/rbac/settings/ledger/trust/i18n）——每项 id/severity/subject/advise_key */
	checks: VerifyItem[]
	/** 待查 i18n key 清单（去重排序）：前端经 oj-market 解析文案；缺执行降级「未校验」不阻断 */
	advise: string[]
}

/** 落盘文件形态（文件名=createdAt.json，便于时间序排序与按 name 检索） */
export interface VerifyReportFile {
	createdAt: number
	name: string
	report: VerifyReport
}

// 报告留存条数（超出删最旧；与 tasks.ts TASK_KEEP 同口径「时间序保留 + 触发点」）
export const VERIFY_REPORTS_KEEP = 10;

/** 报告目录（默认随 statePath 同目录 verify-reports；与 .solutions 同根） */
export function verifyReportsDirOf(env: { statePath: string, verifyReportsDir?: string }): string {
	if (env.verifyReportsDir !== undefined)
		return env.verifyReportsDir;
	const slash = env.statePath.lastIndexOf("/");
	const base = slash === -1 ? "" : env.statePath.slice(0, slash);
	return base === "" ? "verify-reports" : `${base}/verify-reports`;
}

/** 文件名（纯数字 .json）判定，避免误吞非报告文件 */
function isReportName(n: string): boolean {
	return /^\d+\.json$/.test(n);
}

/** 持久化一份报告 + 触发留存 GC（保留最近 N=10，删最旧）。单条清理失败不影响主流程。 */
export async function persistReport(dir: string, name: string, report: VerifyReport, now: number = Date.now()): Promise<void> {
	const file: VerifyReportFile = { createdAt: now, name, report };
	await atomicWriteText(`${dir}/${now}.json`, `${JSON.stringify(file)}\n`);
	// GC：按文件名数值序（=createdAt 序）保留最近 N=10，删最旧（第 11 份挤掉第 1 份）
	let names: string[];
	try {
		names = await fsFace().readdir(dir);
	}
	catch {
		return; // 目录尚不存在/不可读：本次写入已落盘，GC 下次收敛
	}
	const sorted = names.filter(isReportName).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
	const stale = sorted.slice(0, Math.max(0, sorted.length - VERIFY_REPORTS_KEEP));
	for (const n of stale) {
		try {
			await fsFace().remove(`${dir}/${n}`);
		}
		catch {
			// 单条清理失败不影响主流程
		}
	}
}

/**
 * 取某方案最新报告（按 createdAt 最大）；无/目录缺失/全部损坏 → null（不炸，端点据 404 降级）。
 * 损坏文件跳过（可观测性优先，不为坏文件阻塞读取）。
 */
export async function getLastReport(dir: string, name: string): Promise<VerifyReport | null> {
	let names: string[];
	try {
		names = await fsFace().readdir(dir);
	}
	catch {
		return null;
	}
	let best: VerifyReportFile | null = null;
	for (const n of names.filter(isReportName)) {
		try {
			const f = JSON.parse(new TextDecoder().decode(await fsFace().readFile(`${dir}/${n}`))) as VerifyReportFile;
			if (f.name !== name)
				continue;
			if (best === null || f.createdAt > best.createdAt)
				best = f;
		}
		catch {
			// 损坏跳过
		}
	}
	return best?.report ?? null;
}
