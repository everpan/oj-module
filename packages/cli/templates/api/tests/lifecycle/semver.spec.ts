// BDD：semver 比较器（R25，P1-1）。纯字符串解析、无依赖。
// 语义边界：数字段数值比较；prerelease 标识符数字按数值、字母按字典序、数字 < 字母；
// 无 prerelease > 有 prerelease；「1.0」「1.0.0」「1.0.0.0」视为相等（安装器容错口径）。
import { describe, expect, it } from "vitest";

import { compareVersions } from "../../src/_platform/_lifecycle/semver";

const cases: Array<[a: string, b: string, expected: -1 | 0 | 1]> = [
	// 主版本数值比较（非字典序）
	["0.1.10", "0.1.9", 1],
	["0.1.9", "0.1.10", -1],
	["2.0.0", "10.0.0", -1],
	// 相等
	["1.0.0", "1.0.0", 0],
	// 长度容错：缺省段视为 0
	["1.0", "1.0.0", 0],
	["1.0.0", "1.0.0.0", 0],
	["1", "1.0.0", 0],
	// prerelease：有 prerelease < 无 prerelease
	["1.0.0-alpha", "1.0.0", -1],
	["1.0.0", "1.0.0-alpha", 1],
	// prerelease 数字标识符按数值比较
	["1.0.0-alpha.2", "1.0.0-alpha.10", -1],
	// prerelease 字母标识符按字典序
	["1.0.0-alpha", "1.0.0-beta", -1],
	// prerelease 数字 < 字母
	["1.0.0-1", "1.0.0-alpha", -1],
	// prerelease 标识符多的 > 标识符少的（前缀相同）
	["1.0.0-alpha", "1.0.0-alpha.1", -1],
	// 标识符内部数字段仍按数值：alpha.9 < alpha.10
	["1.0.0-alpha.9", "1.0.0-alpha.10", -1],
	// 多连字符 prerelease：首个 - 后整体为标识符串，不得截断静默判等
	["1.0.0-alpha-beta", "1.0.0-alpha", 1],
	["1.0.0-alpha-beta", "1.0.0-alpha.2", 1],
];

describe("compareVersions（R25）", () => {
	for (const [a, b, expected] of cases) {
		it(`${a} vs ${b} → ${expected}`, () => {
			expect(compareVersions(a, b)).toBe(expected);
		});
	}
});
