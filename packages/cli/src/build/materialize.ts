// overlay 物化纯函数（实施计划 Phase 1 / docs/plans/20261121-2040，行动项 A1）：
// 把「构建条目（基线）+ 已装方案 face 条目（叠加层）→ 最终清单」的合并语义
// 从 installed-merge.ts 抽为显式输入、无副作用的纯计算——读盘（state/face 旁车）
// 与写盘（归一化回写）全部留在调用方。Phase 2 起叠加层来源可换成 DB 行
// （packages/runtime/src/module-loader/semver.ts 仲裁），本函数不需要任何改动。
//
// 铁律（主文档 §4.7）：face 的 entry/css/chunks/integrity 逐字节搬运，
// 本函数只叠 enabled 与条目顺序，不碰任何构建信息。
import type { BuiltModule } from "./module-build";

/** 已装方案 face 旁车的调用方组装形态（读盘归调用方，纯计算只消费它） */
export interface InstalledFaceEntry {
	name: string
	version: string
	/** face 旁车内容（entry/css/chunks/integrity 等 extras，已做路径归一） */
	manifest: Record<string, unknown>
	/** 启停以叠加层真源（sidecar state / Phase 2 起 DB 行）为准，不取旁车 enabled */
	enabled: boolean
}

/**
 * 合并基线与已装方案条目。纯函数：同输入必得同输出，无 IO、无日志副作用。
 *
 * 规则（逐字沿用 installed-merge 既有语义，行为不变）：
 * - 已装方案与源码树模块同名 → 抛错 fail-fast（双轨同名红线，不静默覆盖）；
 * - face 条目原样并入，enabled 以叠加层真源覆盖；
 * - 无已装方案 → 原样返回（纯源码工程零动作）。
 */
export function materialize(built: BuiltModule[], installed: InstalledFaceEntry[]): BuiltModule[] {
	const merged: BuiltModule[] = [...built];
	for (const face of installed) {
		if (merged.some(m => m.name === face.name)) {
			throw new Error(
				`[ojm] 已装方案「${face.name}」与源码树模块同名（双轨同名红线）：请卸载该方案（ojm uninstall ${face.name}）或改源码模块名后重建。`,
			);
		}
		merged.push({ ...face.manifest, name: face.name, version: face.version, enabled: face.enabled } as BuiltModule);
	}
	return merged;
}
