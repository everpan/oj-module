// 热更步骤（P1-9，十阶段 stage reloading；R18）：经注入 reload 面调 oj server.reloadConfig()
// （platform 特权 API，oj 0.1.75 起落地；S1-5.2 实测五键形状 {generation, unchanged, applied[],
// restart_pending[], kept_listener[]}，与 POST /_system/config 同一 executor 同一把串行锁——
// 并发第二次触发抛 busy 409）。终态断言（R18）：unchanged = config 改写未实际生效判失败
// （幂等回显 = 热更目标未达成，重试不自愈）；expected 段键须逐一 ∈ applied——缺省 ["vars"]
// （B-11 安装触发面 = vars.ojm_install_seq 自增，PRD E5 实测 vars 可热生效；S1-5 实测
// anonymous_paths 热改属 restart_pending 不可热生效，mounts 断言可经 ctx.expected 覆盖）。
// reload 面经 ctx 注入（DIP）：生产 = (globalThis as any).server.reloadConfig 包装（P1-10 接线），
// 测试 stub 注入成功/unchanged/抛错三态。

import type { InstallContext } from "./preflight";

/** reloadConfig 返回形状（S1-5.2 实测五键；generation 可缺省容忍） */
export interface ReloadResult {
	generation?: number
	unchanged: boolean
	applied: string[]
	restart_pending?: string[]
	kept_listener?: string[]
}

export interface ReloadFace {
	reloadConfig: () => Promise<ReloadResult>
}

export interface ReloadContext extends InstallContext {
	/** 注入式 reload 面（生产 = platform 特权 server.reloadConfig 包装；测试 stub） */
	reload: ReloadFace
	/** 须实际生效的段键（R18 终态断言）；缺省 ["vars"]（B-11 安装触发面） */
	expected?: string[]
}

export interface StageResult {
	stage: "reloading"
	ok: boolean
	message: string
	retryable?: boolean
}

export async function reloadAndAssert(ctx: ReloadContext): Promise<StageResult> {
	let r: ReloadResult;
	try {
		r = await ctx.reload.reloadConfig();
	}
	catch (e) {
		return { stage: "reloading", ok: false, retryable: true, message: `热更失败：reloadConfig 抛错（${String(e)}）——并发 busy 可重试（附录 A reloading；R18）` };
	}
	if (typeof r !== "object" || r === null || !Array.isArray(r.applied) || typeof r.unchanged !== "boolean") {
		return {
			stage: "reloading",
			ok: false,
			retryable: false,
			message: `热更失败：reloadConfig 返回形状违约（S1-5.2 五键形状 {generation, unchanged, applied, restart_pending, kept_listener}）：${JSON.stringify(r)?.slice(0, 200)}`,
		};
	}
	if (r.unchanged) {
		return {
			stage: "reloading",
			ok: false,
			retryable: false,
			message: "热更失败：reloadConfig 返回 unchanged——config 改写未实际生效（R18 终态断言：幂等回显 = 热更目标未达成，重试不自愈），请检查 config 写入段后重试安装",
		};
	}
	// 安装路径缺省期望 vars（B-11：reload 触发变更 = vars.ojm_install_seq 自增，PRD E5 实测
	// vars 可热生效；unchanged 判定基于 config 文档 sha，安装器 reloading 段前置落盘自增）。
	// anonymous 并入即 mounts 段生效的语义保留——调用方经 ctx.expected 显式覆盖。
	const expected = ctx.expected ?? ["vars"];
	const missing = expected.filter(k => !r.applied.includes(k));
	if (missing.length > 0) {
		return {
			stage: "reloading",
			ok: false,
			retryable: false,
			message: `热更失败：applied [${r.applied.join("、")}] 未含预期生效段 ${missing.join("、")}（R18：以 reload 返回的 mounts/vars 实际生效值做终态断言）`,
		};
	}
	const pending = Array.isArray(r.restart_pending) && r.restart_pending.length > 0
		? `；待重启段 [${r.restart_pending.join("、")}]（anonymous_paths 热改属 restart_pending，S1-5）`
		: "";
	return { stage: "reloading", ok: true, message: `热更完成：generation ${r.generation ?? "?"}，已生效段 [${r.applied.join("、")}]${pending}` };
}
