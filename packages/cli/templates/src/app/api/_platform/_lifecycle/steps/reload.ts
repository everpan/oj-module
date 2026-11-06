// 热更步骤（P1-9，十阶段 stage reloading）：经注入 reload 面调 oj server.reloadConfig()
// （platform 特权 API，oj 0.1.75 起落地；v0.1.122 起 manifests 锁纳入变化检测——装/卸只动锁即
// 触发装配，卸载空转由此解决）。返回形状恒定（api-manual §10）：
//   { generation, unchanged, applied[], restart_pending[], kept_listener[] }
// - applied 双符号契约（v0.1.122）：模块条目 `+<name>@<ver>`（装/升级）/ `-<name>@<ver>`（卸），
//   段 diff 条目（mounts/tenant/tasks）同列一数组；升级 = `-旧@v` + `+新@v` 成对。
// - unchanged=true 时三清单为空（config 与 manifests 锁双双未变）；v0.1.122 起 vars/auth 等
//   冻结/特权段**如实归入 restart_pending**——旧版把 vars 静默误标进 applied 已修正。
// 并发撞锁 → 抛 `reload in progress (busy)`（409）；归一/装配失败 → 抛 HTTP 400；交接中断 / cron
// 拉起失败 → 抛 500（old task pool did not stop within 10s 等，新代任务就地收场）。
// 终态断言（R18 修订 / §2.7）：安装路径 unchanged=true = 已是最新装配 = 幂等成功（不再判失败）；
// 卸载 unchanged=true = 空转回归仍判失败。applied 符号：卸载强制 -name@ver；安装默认不强制
// +name@ver（smoke 段行为化校验挂载是否真通——探活拿到 200 即证模块已装配）。force 透传
// （v0.1.123）要求 reload 实际重跑（unchanged=false），否则判失败。reload 面经 ctx 注入（DIP）。

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
	/** oj 0.1.123+ 支持 reloadConfig(force)：force=true 强制重装配，绕过 unchanged 幂等短路 */
	reloadConfig: (force?: boolean) => Promise<ReloadResult>
}

export interface ReloadContext extends InstallContext {
	/** 注入式 reload 面（生产 = platform 特权 server.reloadConfig 包装；测试 stub） */
	reload: ReloadFace
	/**
	 * 除模块符号外须逐一 ∈ applied 的附加段键（缺省空；v0.1.122 起 vars/auth 等冻结/特权段已归入
	 *  restart_pending，不再入 applied——故不再默认期望 vars）
	 */
	expected?: string[]
}

export interface StageResult {
	stage: "reloading"
	ok: boolean
	message: string
	retryable?: boolean
	/**
	 * 热更返回的待重启段（v0.1.122 restart_pending）；非空 = 部分生效、需宿主重启后才完全生效。
	 *  install/卸载形态均据其标 partial + restartRequired（无守护形态，P0 §3.6 / 验收 15）
	 */
	restartPending?: string[]
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 是否有 api 模块（决定 oj 是否产出装配条目）：web-only（无 api 段）不强制模块符号，仅校验 reload 已探测变更 */
export function hasApiModule(manifest: unknown): boolean {
	return isObj(manifest) && isObj(manifest.api);
}

/** 模块符号（v0.1.122 applied 双符号契约）：装 = +<name>@<ver>；卸 = -<name>@<ver> */
export function moduleSymbolOf(name: string, version: string, kind: "install" | "uninstall"): string {
	return `${kind === "install" ? "+" : "-"}${name}@${version}`;
}

/**
 * reload 终态断言（R18 修订 / §2.7）：
 * - 形状违约（非对象 / applied 非数组 / unchanged 非布尔）→ 失败。
 * - unchanged=true（config 与 manifests 锁双双未变）：
 *     · 卸载（kind=uninstall）→ 失败：锁未摘除 = 卸载空转回归（重试不自愈）。
 *     · 安装 + force=true → 失败：--force 要求强制重装配，宿主却报告无变更可重做（装配径失效）。
 *     · 安装 + 非强制 → **成功**：unchanged = 已是最新装配 = 幂等成功（R18 修订：不再视为失败；
 *       升级/重装本就由 manifests 锁 diff 自然触发 unchanged=false，盘上本就一致时 idempotent ok）。
 * - 模块符号（卸 -name@ver）：仅卸载且 hasApi 为真时强制——卸载必须显式拆装；安装**默认不强制**
 *   +name@ver（R18 修订：smoke 段行为化校验挂载是否真通——探活端点 200 即证模块已装配，不必在
 *   reload 层重复断言；锁 diff 自会驱动装配，applied 空属正常幂等态）。
 * - 附加段键（ctx.expected，如 mounts/tenant/tasks）逐一 ∈ applied（覆盖项保留）。
 * 返回 {ok, message?} 供调用方生成人话。
 */
export function assertReloadApplied(r: ReloadResult, opts: { hasApi: boolean, kind: "install" | "uninstall", name: string, version: string, additional?: string[], /** 强制热更（oj 0.1.123+ reloadConfig(force)）：unchanged 时须失败（强制装配未生效） */ force?: boolean }): { ok: boolean, message?: string } {
	if (typeof r !== "object" || r === null || !Array.isArray(r.applied) || typeof r.unchanged !== "boolean") {
		return {
			ok: false,
			message: `reloadConfig 返回形状违约（v0.1.122 五键 {generation, unchanged, applied[], restart_pending[], kept_listener[]}）：${JSON.stringify(r)?.slice(0, 200)}`,
		};
	}
	// 无代际信号（dev/embedded 的 reload 回落 no-op：不提供 generation）= 无法验证，放行（不阻挡
	// 卸载/安装主流程；真实 reload 恒返回 generation，故此信号等价于「reload 未实际执行」）。
	if (r.generation === undefined) {
		return { ok: true };
	}
	if (r.unchanged) {
		if (opts.kind === "uninstall") {
			return {
				ok: false,
				message: "reloadConfig 返回 unchanged——卸载后锁未变化，疑似卸载空转（锁未摘除）；请确认宿主已开启 reload_api 且 oj ≥ v0.1.122",
			};
		}
		if (opts.force === true) {
			return {
				ok: false,
				message: "reloadConfig 返回 unchanged——--force 要求强制重装配，但宿主报告无变更可重做（锁 diff / 文档 sha 变化后仍 unchanged 说明强制装配未生效）；请确认宿主 oj ≥ v0.1.123 且 reload_api 已开启",
			};
		}
		// 非强制安装：unchanged = 已是最新装配 = 幂等成功（R18 修订）
		return {
			ok: true,
			message: "reloadConfig 返回 unchanged——当前已是最新装配（幂等成功，R18 修订：锁 / 文档未变化即无需重装配）",
		};
	}
	// 模块符号：仅卸载且 hasApi 为真时强制 -name@ver（R18 修订：安装默认不强制 +name@ver，
	// 由 smoke 段行为化校验挂载；本层只拦卸载空转——锁未摘除 = 未实际拆除）。
	const requireSymbol = opts.kind === "uninstall" && opts.hasApi;
	const symbol = requireSymbol ? moduleSymbolOf(opts.name, opts.version, "uninstall") : undefined;
	const missing = [...(symbol ? [symbol] : []), ...(opts.additional ?? [])].filter(k => !r.applied.includes(k));
	if (missing.length > 0) {
		return {
			ok: false,
			message: `reloadConfig applied [${r.applied.join("、")}] 未含预期生效项 ${missing.join("、")}（R18 / §2.7：以 reload 实际 applied 做终态断言，卸载空转回归的唯一拦截点）`,
		};
	}
	return { ok: true };
}

export async function reloadAndAssert(ctx: ReloadContext): Promise<StageResult> {
	let r: ReloadResult;
	try {
		r = await ctx.reload.reloadConfig(ctx.force === true ? ctx.force : undefined);
	}
	catch (e) {
		return { stage: "reloading", ok: false, retryable: true, message: `热更失败：reloadConfig 抛错（${String(e)}）——并发 busy / 归一装配失败 / 交接中断 / cron 拉起失败均可重试（R18）` };
	}
	// 安装路径（R18 修订）：默认不强制 +name@ver——模块装配由锁 diff 驱动，smoke 段行为化校验挂载；
	// 仅 force 未生效 / ctx.expected 覆盖项缺失 / 形状违约会判失败。
	const a = assertReloadApplied(r, { hasApi: hasApiModule(ctx.manifest), kind: "install", name: ctx.name, version: ctx.version, additional: ctx.expected, force: ctx.force === true });
	if (!a.ok) {
		return { stage: "reloading", ok: false, retryable: false, message: `热更失败：${a.message}` };
	}
	const pending = Array.isArray(r.restart_pending) && r.restart_pending.length > 0
		? `；待重启段 [${r.restart_pending.join("、")}]（anonymous_paths / vars 等冻结·特权段热改属 restart_pending，v0.1.122）`
		: "";
	return { stage: "reloading", ok: true, message: `热更完成：generation ${r.generation ?? "?"}，已生效段 [${r.applied.join("、")}]${pending}`, restartPending: Array.isArray(r.restart_pending) ? r.restart_pending : [] };
}
