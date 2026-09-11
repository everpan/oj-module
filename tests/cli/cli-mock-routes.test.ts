import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// ojm dev 工程 mock 约定（docs/prd/202609010056-playground-full-modules-plan.md）：
// mock/*.mock.mjs default 导出路由数组，dev 服务器按 method+path 精确匹配 /api/* 请求
import { loadProjectMocks, matchMockRoute, mockStatusCode } from "../../packages/cli/src/dev-mock";

describe("mockStatusCode（AC-D16：HTTP 状态 = 信封 code）", () => {
	it("code=0 → 200", () => {
		expect(mockStatusCode({ code: 0, msg: "ok", data: null })).toBe(200);
	});
	it("正数业务码 → 置为 HTTP 状态", () => {
		expect(mockStatusCode({ code: 400, msg: "bad", data: null })).toBe(400);
	});
	it("无 code / code<=0 → 维持 200", () => {
		expect(mockStatusCode({ data: 1 })).toBe(200);
		expect(mockStatusCode({ code: -1 })).toBe(200);
		expect(mockStatusCode(null)).toBe(200);
	});
});

describe("loadProjectMocks", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const d of dirs)
			rmSync(d, { recursive: true, force: true });
		dirs.length = 0;
	});

	it("解析 mock/*.mock.mjs 的 default 路由数组", async () => {
		// 仓库内 fixture：vitest 求值器无法 import tmp 目录下的文件
		const routes = await loadProjectMocks(join(__dirname, "../fixtures/ojm-mock"));
		expect(routes).toHaveLength(2);
		expect(routes[0]?.url).toBe("/home/line");
	});

	it("无 mock 目录时返回空数组（零行为变化）", async () => {
		const root = mkdtempSync(join(tmpdir(), "ojm-nomock-"));
		dirs.push(root);
		expect(await loadProjectMocks(root)).toEqual([]);
	});

	it("忽略非 .mock 约定文件", async () => {
		const routes = await loadProjectMocks(join(__dirname, "../fixtures/ojm-mock"));
		expect(routes.some(route => route.url === "/should-not-load")).toBe(false);
	});
});

describe("matchMockRoute", () => {
	const routes = [
		{ url: "/home/line", method: "post", response: () => ({}) },
		{ url: "/notifications", response: () => ({}) },
	];

	it("method+path 精确命中", () => {
		expect(matchMockRoute(routes, "POST", "/home/line")?.url).toBe("/home/line");
		expect(matchMockRoute(routes, "get", "/notifications")?.url).toBe("/notifications");
	});

	it("method 不匹配返回 undefined", () => {
		expect(matchMockRoute(routes, "get", "/home/line")).toBeUndefined();
	});

	it("path 不匹配返回 undefined", () => {
		expect(matchMockRoute(routes, "get", "/home/unknown")).toBeUndefined();
	});
});
