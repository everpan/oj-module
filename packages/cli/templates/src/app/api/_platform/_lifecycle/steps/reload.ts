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
// 终态断言（R18 / §2.7）：unchanged = 锁变更未实际触发装配 → 判失败（卸载空转/安装未挂载回归，重试
// 不自愈）；applied 须含预期模块符号（装 +name@ver / 卸 -name@ver）。web-only（无 api 段）oj 不产
// 模块条目，符号不强制，仅校验 unchanged=false（锁变更已被探测）。reload 面经 ctx 注入（DIP）。

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
 * reload 终态断言（R18 / §2.7）：
 * - 形状违约（非对象 / applied 非数组 / unchanged 非布尔）→ 失败。
 * - unchanged=true（config 与 manifests 锁双双未变）→ 失败：锁变更未实际触发装配，正是「卸载空转 /
 *   安装未挂载」回归的签名，重试不自愈；提示宿主须开启 reload_api 且 oj ≥ v0.1.122。
 * - 模块符号（装 +name@ver / 卸 -name@ver）：仅当 hasApi 为真时强制——web-only 方案 oj 不产模块
 *   条目，符号空缺属正常，此时只依赖 unchanged=false 守卫。
 * - 附加段键（ctx.expected，如 mounts/tenant/tasks）逐一 ∈ applied。
 * 返回 {ok, message?} 供调用方生成人话。
 */
export function assertReloadApplied(r: ReloadResult, opts: { hasApi: boolean, kind: "install" | "uninstall", name: string, version: string, additional?: string[], /** 重装（模块已挂载）：oj 装配不重做，applied 不含 +name@ver（无模块装配变更），仅校验 unchanged=false；全新安装仍强制模块符号 */ reinstall?: boolean }): { ok: boolean, message?: string } {
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
		return {
			ok: false,
			message: "reloadConfig 返回 unchanged——本次锁变更未实际触发装配（卸载空转 / 安装未挂载回归，重试不自愈）；请确认宿主已开启 reload_api 且 oj ≥ v0.1.122",
		};
	}
	// 重装路径（模块已挂载）：oj 装配不变更，applied 为空属正常（无模块装配 diff），此时只依赖
	// unchanged=false 守卫；卸载与全新安装仍强制模块符号（装 +name@ver / 卸 -name@ver）。
	const requireSymbol = opts.hasApi && !(opts.kind === "install" && opts.reinstall === true);
	const symbol = requireSymbol ? moduleSymbolOf(opts.name, opts.version, opts.kind) : undefined;
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
		r = await ctx.reload.reloadConfig();
	}
	catch (e) {
		return { stage: "reloading", ok: false, retryable: true, message: `热更失败：reloadConfig 抛错（${String(e)}）——并发 busy / 归一装配失败 / 交接中断 / cron 拉起失败均可重试（R18）` };
	}
	// 安装路径：manifest 有 api 段 → 强制 applied 含 +name@ver（模块已装配）；web-only 仅校验 unchanged。
	const a = assertReloadApplied(r, { hasApi: hasApiModule(ctx.manifest), kind: "install", name: ctx.name, version: ctx.version, additional: ctx.expected, reinstall: ctx.reinstall === true });
	if (!a.ok) {
		return { stage: "reloading", ok: false, retryable: false, message: `热更失败：${a.message}` };
	}
	const pending = Array.isArray(r.restart_pending) && r.restart_pending.length > 0
		? `；待重启段 [${r.restart_pending.join("、")}]（anonymous_paths / vars 等冻结·特权段热改属 restart_pending，v0.1.122）`
		: "";
	return { stage: "reloading", ok: true, message: `热更完成：generation ${r.generation ?? "?"}，已生效段 [${r.applied.join("、")}]${pending}`, restartPending: Array.isArray(r.restart_pending) ? r.restart_pending : [] };
}
