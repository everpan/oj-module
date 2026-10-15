import type { OpenApiDoc } from "../openapi-ir";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadContractMocks, resolveMock } from "../mock";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ojm-mock-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const DOC: OpenApiDoc = {
	openapi: "3.1.0",
	paths: {
		"/v1/api/wiki/collections/{id}": {
			get: {
				operationId: "wiki_collections__id__get",
				tags: ["wiki"],
				parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
				responses: {
					200: {
						"description": "OK",
						"x-oj-response-enforced": false,
						"content": { "application/json": { schema: { type: "object", required: ["code", "msg", "data"], properties: { code: { type: "integer" }, msg: { type: "string" }, data: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 10 }, count: { type: "integer", minimum: 1 } } } } } } },
					},
				},
			},
		},
	},
};

describe("dev mock 消费 openapi.json（新口径 Task #6）", () => {
	it("loadContractMocks 由 openapi.json 装载路由，data 为 JSON Schema", async () => {
		writeFileSync(join(dir, "openapi.json"), JSON.stringify(DOC));
		const routes = await loadContractMocks(dir);
		expect(routes.length).toBe(1);
		expect(routes[0].method).toBe("GET");
		expect(routes[0].pattern).toBe("/wiki/collections/{id}");
		expect((routes[0].data as Record<string, unknown>).type).toBe("object");
	});

	it("resolveMock 用 JSON Schema 生成示例 data（满足 maxLength/minimum 约束）", async () => {
		writeFileSync(join(dir, "openapi.json"), JSON.stringify(DOC));
		const routes = await loadContractMocks(dir);
		const fn = resolveMock([], routes, "GET", "/wiki/collections/5");
		expect(fn).toBeTypeOf("function");
		const res = fn!() as { code: number, msg: string, data: { title: string, count: number } };
		expect(res.code).toBe(0);
		expect(res.data.title.length).toBeLessThanOrEqual(10);
		expect(res.data.count).toBeGreaterThanOrEqual(1);
	});
});
