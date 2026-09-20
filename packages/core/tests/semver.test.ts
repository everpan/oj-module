import { describe, expect, it } from "vitest";

import { satisfiesSemver } from "../src/module-loader/semver";

describe("satisfiesSemver（v1 直蒸回归）", () => {
	it("精确版本", () => {
		expect(satisfiesSemver("0.1.10", "0.1.10")).toBe(true);
		expect(satisfiesSemver("0.1.11", "0.1.10")).toBe(false);
	});

	it("^ / ~ 范围（v1 语义：^ 只钉 major，0.x 不收窄 minor——最小实现已知边界）", () => {
		expect(satisfiesSemver("0.1.10", "^0.1.0")).toBe(true);
		expect(satisfiesSemver("0.2.0", "^0.1.0")).toBe(true); // v1 按 major 判定，非 npm 0.x 收窄
		expect(satisfiesSemver("1.2.0", "^0.1.0")).toBe(false);
		expect(satisfiesSemver("0.1.10", "~0.1.0")).toBe(true);
		expect(satisfiesSemver("0.1.0", "~0.1.10")).toBe(false);
	});

	it(">= 合取与 * / 空串", () => {
		expect(satisfiesSemver("1.2.3", ">=1.0.0 <2.0.0")).toBe(true);
		expect(satisfiesSemver("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
		expect(satisfiesSemver("9.9.9", "*")).toBe(true);
		expect(satisfiesSemver("9.9.9", "")).toBe(true);
	});

	it("超纲形态与非法版本拒绝", () => {
		expect(satisfiesSemver("1.0", "^1.0.0")).toBe(false);
		expect(satisfiesSemver("1.0.0", "latest")).toBe(false);
		expect(satisfiesSemver("1.0.0", "1.x")).toBe(false);
	});
});
