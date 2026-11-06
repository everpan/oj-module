// 随站 bundle 启动收敛（Phase B T3b，方案 §5「上拉不下拉」）：
//   未装 → install；bundle > 已装 → upgrade；bundle ≤ 已装 → skip。
// bundle < 已装 是市场轨（用户经方案市场升过更高版本）的正常漂移态——不降级，
// 对齐 rollbackGuard 禁降版红线 OJ-9（降级唯一入口 = 站点回滚）。
//
// 挂点裁决（T3b）：oj 启动段 ext_boot 有 2s 看门狗（oj-bin runtime.rs BOOT_TIMEOUT，
// terminate 的是正被借出跑请求的 isolate），安装全程（解压/迁移/重装配）不可在 boot
// 内跑——收敛编排由首个编排 API 请求触发（index 端点「对账即服务」先例），每次调用
// 幂等：已对齐即全 skip（只剩 marker/状态两次读）。单条目失败记 failed 续跑，不抛。

import { atomicWriteText, fsFace } from "./atomic";
import { compareVersions } from "./semver";
import { createStateStore } from "./state";

export type BundleConvergePlan = "install" | "upgrade" | "skip";

export function bundleConvergePlan(installed: string | null, bundle: string): BundleConvergePlan {
	if (installed === null)
		return "install";
	return compareVersions(bundle, installed) > 0 ? "upgrade" : "skip";
}

/** 意图标记条目（init --yes 写 cdn/bundles.json；file = cdn/ 内 tgz 文件名） */
export interface BundledEntry {
	name: string
	version: string
	file: string
}

/** 安装闭包注入面：字节 + 旁车签名的本地归档安装（manifest 组装 + runInstall 在调用方） */
export interface BundleConvergeEnv {
	/** 意图标记路径（缺省 <cdnDir>/bundles.json，调用方可显式传） */
	markerPath: string
	/** 本地字节仓库目录 */
	cdnDir: string
	/** sidecar 状态文件（读已装版本） */
	statePath: string
	installLocal: (entry: BundledEntry, archive: { bytes: Uint8Array, sig: unknown | null }) => Promise<void>
	/** 失败冷却文件（可选；调用方启用才有冷却，缺省每次请求重试——测试与轻量场景） */
	cooldownPath?: string
	/** 当前时刻 epoch ms（测试注入；缺省 Date.now） */
	now?: () => number
}

export interface BundleConvergeResult {
	installed: string[]
	upgraded: string[]
	skipped: string[]
	failed: string[]
	/** 冷却窗内跳过（上次失败未满 10 分钟；调用方据此可观测连续失败） */
	cooling: string[]
}

/** 失败冷却窗：持久失败条目每次 index 请求全量重装是重试风暴——窗内不再重试（终审 Important-2） */
const COOLDOWN_MS = 10 * 60 * 1000;

/** 读冷却表（缺省 {}）；文件损坏按空表对待（冷却失效 = 保守重试，不阻断收敛） */
async function readCooldown(cooldownPath: string): Promise<Record<string, number>> {
	try {
		const parsed: unknown = JSON.parse(new TextDecoder().decode(await fsFace().readFile(cooldownPath)));
		if (parsed !== null && typeof parsed === "object")
			return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "number")) as Record<string, number>;
	}
	catch {}
	return {};
}

/**
 * 卸载墓碑（终审 Important-1）：方案被 superadmin 卸载时，调用方摘除其在意图标记里
 * 的条目——否则「未装→装」收敛会把故意卸载当漂移纠正，下次 index 请求全自动重装，
 * 计划特性 2「卸载后仅可经 system 域入口重装」落空。marker 缺失/损坏安静 no-op。
 */
export async function pruneBundledMarker(markerPath: string, name: string): Promise<void> {
	const entries = await readMarker(markerPath);
	if (entries === null)
		return;
	const rest = entries.filter(e => e.name !== name);
	if (rest.length === entries.length)
		return;
	await atomicWriteText(markerPath, `${JSON.stringify({ solutions: rest }, null, "\t")}\n`);
}

/** 读 marker：缺失/损坏/空清单 → null（零动作，旧工程与无 bundle 站点的安静态） */
async function readMarker(markerPath: string): Promise<BundledEntry[] | null> {
	let text: string;
	try {
		text = new TextDecoder().decode(await fsFace().readFile(markerPath));
	}
	catch {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		const list = (parsed as { solutions?: unknown }).solutions;
		if (!Array.isArray(list) || list.length === 0)
			return null;
		const out: BundledEntry[] = [];
		for (const raw of list) {
			const e = raw as Partial<BundledEntry>;
			if (typeof e?.name === "string" && typeof e.version === "string" && typeof e.file === "string")
				out.push({ name: e.name, version: e.version, file: e.file });
		}
		return out.length === 0 ? null : out;
	}
	catch {
		return null; // 损坏 marker 不当场修（下次 init --yes 重写），收敛静默跳过
	}
}

/** 跑一遍对账（幂等；由编排 API 请求面调用，如 oj-market index 端点） */
export async function convergeBundledSolutions(env: BundleConvergeEnv): Promise<BundleConvergeResult> {
	const result: BundleConvergeResult = { installed: [], upgraded: [], skipped: [], failed: [], cooling: [] };
	const entries = await readMarker(env.markerPath);
	if (entries === null)
		return result;
	const state = (await createStateStore(env.statePath)).read();
	const now = env.now ?? (() => Date.now());
	let cooldown: Record<string, number> | null = null;
	if (env.cooldownPath !== undefined)
		cooldown = await readCooldown(env.cooldownPath);
	for (const entry of entries) {
		const label = `${entry.name}@${entry.version}`;
		const plan = bundleConvergePlan(state.solutions[entry.name]?.version ?? null, entry.version);
		if (plan === "skip") {
			result.skipped.push(label);
			continue;
		}
		if (cooldown !== null && now() - (cooldown[entry.name] ?? 0) < COOLDOWN_MS) {
			result.cooling.push(label);
			continue;
		}
		try {
			const bytes = new Uint8Array(await fsFace().readFile(`${env.cdnDir}/${entry.file}`));
			let sig: unknown | null = null;
			try {
				sig = JSON.parse(new TextDecoder().decode(await fsFace().readFile(`${env.cdnDir}/${entry.file}.sig`)));
			}
			catch {
				sig = null; // 无旁车 → null，验签 fail-closed 由安装器 verify 段裁决（六码分流）
			}
			await env.installLocal(entry, { bytes, sig });
			result[plan === "install" ? "installed" : "upgraded"].push(label);
			if (cooldown !== null && cooldown[entry.name] !== undefined) {
				delete cooldown[entry.name];
				await atomicWriteText(env.cooldownPath!, JSON.stringify(cooldown));
			}
		}
		catch (e) {
			// 降级不阻断：记 failed 续跑；冷却窗内（若启用）不再重试
			result.failed.push(`${label}（${e instanceof Error ? e.message : String(e)}）`);
			if (cooldown !== null) {
				cooldown[entry.name] = now();
				await atomicWriteText(env.cooldownPath!, JSON.stringify(cooldown));
			}
		}
	}
	return result;
}
