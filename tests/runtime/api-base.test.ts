import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeApiBase, resolveApiBase } from "#src/utils/api-base";

/**
 * API 端点 base 部署期可配（2026-10）：oj mounts 的 api 挂载前缀是部署期事实，
 * runtime 是预构建产物、构建期内联的 VITE_API_BASE_URL 改不了。与 siteBase 同款
 * 「注入全局 > 构建期默认」两级取值；端点恒相对，由 ky 拼接。
 */
describe("normalizeApiBase：归一为不以 / 结尾", () => {
	it.each([
		[undefined, "/api"],
		[null, "/api"],
		["", "/api"],
		["   ", "/api"],
		["/api", "/api"],
		["/api/", "/api"],
		["/gw//", "/gw"],
		["https://api.example.com/", "https://api.example.com"],
	])("%s → %s", (raw, expected) => {
		expect(normalizeApiBase(raw)).toBe(expected);
	});
});

describe("resolveApiBase：注入全局 > 构建期默认", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		delete (globalThis as { __OJ_API_BASE__?: string }).__OJ_API_BASE__;
	});

	it("未注入时回落构建期默认（vitest 下 VITE_API_BASE_URL 未定义 → /api）", () => {
		expect(resolveApiBase()).toBe("/api");
	});

	it("注入 /gw 时优先于构建期默认", () => {
		(globalThis as { __OJ_API_BASE__?: string }).__OJ_API_BASE__ = "/gw";
		expect(resolveApiBase()).toBe("/gw");
	});

	it("每次现读（不缓存）：改全局立即生效", () => {
		expect(resolveApiBase()).toBe("/api");
		(globalThis as { __OJ_API_BASE__?: string }).__OJ_API_BASE__ = "https://api.example.com";
		expect(resolveApiBase()).toBe("https://api.example.com");
	});
});
