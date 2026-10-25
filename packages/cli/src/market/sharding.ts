/**
 * REG-CS5 装箱（D3）：把「一批方案」装进分片，每片 ≤ `SHARD_MAX_VERSIONS` 个版本。
 *
 * 纯数据变换，不落 IO、不签名——编号与落盘归 `build-index.ts`。
 *
 * 三条策略（计划 §S2-1 子任务 2，D3 已定）：
 * 1. **整包装箱**：一个方案不跨片，除非它自己的版本数就超限——那种极端包才按连续上限切片，
 *    且仍占连续片号（读方按片号倒序试取，最高片装最新版，`latest` 安装只拉 1 片）。
 * 2. **确定性**：输入方案顺序即输出顺序（调用方已按名称字典序排好），同样目录内容永远装出
 *    同样结果——「索引只取决于目录内容」这条性质靠它成立。
 * 3. **累加到上限开新片**：按版本数往当前片累加，放不下就开新片（计划原文「按版本数累加到
 *    上限开新片」，上限值经执行期实测校准，见下）。已有包因此天然不换片：只在它前面的内容变了才被挤动。
 *
 * 体积口径（需求 §7，2026-10-25 执行期实测校准）：需求原文按「单条 Form B ≈535–684B」
 * 估 2000 版本/片 ≈1.2MB；但本仓参考 manifest 形态（fixture.ts solutionManifest，945B YAML）
 * 实测单条 Form B 条目 ≈1.2KB——2000/片 = 2.4MB，超计划 §S2-1「单片 ≤1.5MB」验收闸。
 * 校准为 1000 版本/片：参考形态下 ≈1.2MB，正中需求目标；fat manifest 的最坏面也随砍半。
 */

import type { BuiltSolution } from "./index-builder";

/** 单片最大版本数（REG-CS5：1000 版本 ≈1.2MB，计划验收 ≤1.5MB；实测依据见文件头） */
export const SHARD_MAX_VERSIONS = 1000;

/** 一个分片槽位（编号由 build-index 按内容匹配分配，这里只带内容） */
export interface ShardSlot {
	/** 片内方案（顺序 = 装配顺序；版本在各方案内升序） */
	solutions: BuiltSolution[]
	/** 片内版本总数（≤SHARD_MAX_VERSIONS；超限包独占多片时每片恰为上限） */
	versions: number
}

/** 包名 → 所占片号（升序；读方倒序试取） */
export type ShardAssignment = Map<string, number[]>;

export interface PackedShards {
	/** 槽位序列（顺序即装配顺序；编号未分配，见 ShardSlot） */
	slots: ShardSlot[]
	/** 包名 → 片号（升序） */
	assignment: ShardAssignment
}

/**
 * 装箱。调用方保证 `solutions` 已按名称字典序（buildIndexData 的产出即如此）。
 *
 * 超限包（版本数 > `SHARD_MAX_VERSIONS`）切片时每片都是完整方案条目（带 name/latest），`latest` 恒取
 * 包级真值——读方片号倒序，最高片必含最新版本，`latest` 只在最高片被消费；低片里的
 * `latest` 是自洽兜底（指向本片最高版），不会被安装路径读到。
 */
export function packShards(solutions: BuiltSolution[]): PackedShards {
	const slots: ShardSlot[] = [];
	const assignment: ShardAssignment = new Map();
	let current: ShardSlot = { solutions: [], versions: 0 };

	for (const solution of solutions) {
		if (solution.versions.length > SHARD_MAX_VERSIONS) {
			// 超限包：先把当前片收尾，再按连续上限独占多片
			if (current.solutions.length > 0) {
				slots.push(current);
				current = { solutions: [], versions: 0 };
			}
			const nos: number[] = [];
			for (let at = 0; at < solution.versions.length; at += SHARD_MAX_VERSIONS) {
				const chunk: BuiltSolution = {
					name: solution.name,
					latest: solution.latest,
					versions: solution.versions.slice(at, at + SHARD_MAX_VERSIONS),
				};
				slots.push({ solutions: [chunk], versions: chunk.versions.length });
				nos.push(slots.length); // 片号 = 槽位序号（1 起）
			}
			assignment.set(solution.name, nos);
			continue;
		}
		if (current.versions + solution.versions.length > SHARD_MAX_VERSIONS) {
			slots.push(current);
			current = { solutions: [], versions: 0 };
		}
		current.solutions.push(solution);
		current.versions += solution.versions.length;
		const nos = assignment.get(solution.name) ?? [];
		nos.push(slots.length + 1); // 当前片编号 = 已收尾片数 + 1
		assignment.set(solution.name, nos);
	}
	if (current.solutions.length > 0)
		slots.push(current);

	// 空索引也要有一个空片——catalog 的 shards 映射不为空，读方「拉 catalog 即知天下」
	// （无片可拉时装任何包都走 404 分支，与空索引时代同语义）
	if (slots.length === 0)
		slots.push({ solutions: [], versions: 0 });

	return { slots, assignment };
}
