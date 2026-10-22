import { describe, expect, it } from "vitest";
import { compareVersions } from "../utils/semver";

describe("compareVersions 版本比较（BDD）", () => {
	it("given 同版本 When 比较 Then 返回 0", () => {
		expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
		expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
	});

	it("given 主/次/修订不同 When 比较 Then 逐段定序", () => {
		expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
		expect(compareVersions("1.1.9", "1.2.0")).toBeLessThan(0);
		expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
		expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
	});

	it("given 段数不同 When 比较 Then 缺段按 0 补齐", () => {
		expect(compareVersions("1.2", "1.2.0")).toBe(0);
		expect(compareVersions("1.2.1", "1.2")).toBeGreaterThan(0);
	});

	it("given 预发布连字符 When 比较 Then 数值段口径不崩", () => {
		// 前端口径：连字符按分隔处理，非数值记 0（服务端 semver 为权威，此处仅 UI 排序）
		expect(typeof compareVersions("1.0.0-beta", "1.0.0")).toBe("number");
	});
});
