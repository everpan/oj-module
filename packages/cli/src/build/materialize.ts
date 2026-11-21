// overlay 物化纯函数（实施计划 Phase 1/2，行动项 A1）：把「构建条目（基线）+
// 叠加层状态 → 最终清单」的合并语义从 installed-merge.ts 抽为显式输入、无副作用的
// 纯计算——读盘（state/face 旁车）与写盘（归一化回写）全部留在调用方。
//
// 叠加层行两种形态（P3 修复的关键）：
// - 有 face 旁车（已装方案）：整条目并入，enabled 以叠加层真源覆盖；
//   与源码树模块同名 → 抛错 fail-fast（双轨同名红线，不静默覆盖）。
// - 无 face 旁车且基线含同名（builtin 停用等）：**按名叠 enabled 掩码**——
//   停用状态由此跨构建存活（@fixme overlay-phase1 的 RED 用例钉死这条）。
// - 无 face 且基线无此名：孤儿，由调用方告警留审计，不进清单。
//
// 铁律（主文档 §4.7）：entry/css/chunks/integrity 逐字节搬运，本函数只叠
// enabled 与条目顺序，不碰任何构建信息。
import type { BuiltModule } from "./module-build";

/** 叠加层行（调用方读盘组装；manifest 缺省 = 无 face 旁车） */
export interface OverlayEntry {
	name: string
	version: string
	/** face 旁车内容（entry/css/chunks/integrity 等 extras，已做路径归一）；undefined = 无 face */
	manifest?: Record<string, unknown>
	/** 启停以叠加层真源（sidecar state / DB 行）为准，不取任何派生物里的 enabled */
	enabled: boolean
}

/**
 * 合并基线与叠加层。纯函数：同输入必得同输出，无 IO、无日志副作用、不改输入。
 * 无叠加层 → 原样返回（纯源码工程零动作）。
 */
export function materialize(built: BuiltModule[], overlay: OverlayEntry[]): BuiltModule[] {
	const merged: BuiltModule[] = [...built];
	for (const o of overlay) {
		if (o.manifest !== undefined) {
			// 有 face：整条目并入（双轨同名红线 fail-fast，文案逐字沿用）
			if (merged.some(m => m.name === o.name)) {
				throw new Error(
					`[ojm] 已装方案「${o.name}」与源码树模块同名（双轨同名红线）：请卸载该方案（ojm uninstall ${o.name}）或改源码模块名后重建。`,
				);
			}
			merged.push({ ...o.manifest, name: o.name, version: o.version, enabled: o.enabled } as BuiltModule);
			continue;
		}
		// 无 face：基线含同名 → 叠停用/启用掩码（不克隆共享引用，返回新对象）
		const idx = merged.findIndex(m => m.name === o.name);
		if (idx >= 0) {
			merged[idx] = { ...merged[idx], enabled: o.enabled };
			continue;
		}
		// 孤儿（基线无此名且无 face）：跳过——调用方负责告警与审计
	}
	return merged;
}
