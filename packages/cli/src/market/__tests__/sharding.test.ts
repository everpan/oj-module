import type { BuiltSolution } from "../index-builder";
// packShards spec（REG-CS5 / D3）：装箱策略——整包装箱、累加到上限开新片、超限包才跨连续片。
// 钉死「索引只取决于目录内容」：同样输入永远同样输出（编号由 build-index 按内容匹配分配，
// 这里只断言槽位序列与片号映射）。
import { describe, expect, it } from "vitest";
import { packShards, SHARD_MAX_VERSIONS } from "../sharding";

function solution(name: string, count: number): BuiltSolution {
	return {
		name,
		latest: `${name}-${count}`,
		versions: Array.from({ length: count }, (_, i) => ({ name, version: `0.${i}.0`, archive: { file: `${name}-0.${i}.0.tgz` } })),
	};
}

function versionsOf(slots: ReturnType<typeof packShards>["slots"], no: number): number {
	return slots[no - 1]!.versions;
}

describe("given 一批方案 When 装箱", () => {
	it("then 整包入片、版本数累加到上限才开新片（1000 条一片）", () => {
		const packed = packShards([solution("a", 600), solution("b", 400)]);
		expect(packed.slots).toHaveLength(1);
		expect(packed.slots[0]!.solutions.map(s => s.name)).toEqual(["a", "b"]);
		expect(versionsOf(packed.slots, 1)).toBe(SHARD_MAX_VERSIONS);
		expect(packed.assignment.get("a")).toEqual([1]);
		expect(packed.assignment.get("b")).toEqual([1]);
	});

	it("then 放不下就开新片：已有包不换片，只把放不下的挤到新片", () => {
		const packed = packShards([solution("a", 600), solution("b", 500)]);
		expect(packed.slots).toHaveLength(2);
		expect(versionsOf(packed.slots, 1)).toBe(600);
		expect(versionsOf(packed.slots, 2)).toBe(500);
		expect(packed.assignment.get("a")).toEqual([1]);
		expect(packed.assignment.get("b")).toEqual([2]);
	});

	it("then 空索引也产一个空片（catalog 的 shards 映射不为空，读方口径统一）", () => {
		const packed = packShards([]);
		expect(packed.slots).toHaveLength(1);
		expect(packed.slots[0]!.solutions).toEqual([]);
		expect(packed.assignment.size).toBe(0);
	});

	it("then 确定性：同输入两次装箱，槽位逐字节同构", () => {
		const input = [solution("a", 3), solution("b", 2), solution("c", 1)];
		expect(JSON.stringify(packShards(input))).toBe(JSON.stringify(packShards(input)));
	});
});

describe("given 2500 个版本、1 个包 When 装箱（S2-1 BDD）", () => {
	it("then 生成 3 个 shard 且每片 ≤1000 条，catalog 可指向该包所在三片", () => {
		const packed = packShards([solution("mega", 2500)]);
		expect(packed.slots).toHaveLength(3);
		expect(versionsOf(packed.slots, 1)).toBe(1000);
		expect(versionsOf(packed.slots, 2)).toBe(1000);
		expect(versionsOf(packed.slots, 3)).toBe(500);
		expect(packed.assignment.get("mega")).toEqual([1, 2, 3]);
	});

	it("then 最高片装最新版：latest 落在最后一片，安装只请求 1 个 shard", () => {
		const packed = packShards([solution("mega", 2500)]);
		const last = packed.slots[2]!;
		expect(last.solutions[0]!.versions.at(-1)!.version).toBe("0.2499.0");
		expect(last.solutions[0]!.latest).toBe("mega-2500");
	});
});

describe("given 一个包自身超限 When 装箱", () => {
	it("then 按连续上限切片、占连续片号，片内仍是完整方案条目", () => {
		const packed = packShards([solution("mega", SHARD_MAX_VERSIONS * 2 + 7), solution("small", 3)]);
		expect(packed.slots).toHaveLength(4);
		expect(packed.assignment.get("mega")).toEqual([1, 2, 3]);
		expect(packed.assignment.get("small")).toEqual([4]);
		for (const slot of packed.slots.slice(0, 3)) {
			expect(slot.solutions).toHaveLength(1);
			expect(slot.solutions[0]!.name).toBe("mega");
			expect(slot.versions).toBeLessThanOrEqual(SHARD_MAX_VERSIONS);
		}
		expect(versionsOf(packed.slots, 3)).toBe(7);
	});

	it("then 超限包前后的普通包互不挤占", () => {
		const packed = packShards([solution("before", 10), solution("mega", SHARD_MAX_VERSIONS * 2 + 1), solution("after", 10)]);
		expect(packed.assignment.get("before")).toEqual([1]);
		expect(packed.assignment.get("mega")).toEqual([2, 3, 4]);
		expect(packed.assignment.get("after")).toEqual([5]);
	});
});
