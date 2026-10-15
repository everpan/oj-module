import type { OpenApiDoc } from "../openapi-ir";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runApi } from "../run";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ojm-run-"));
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
						"content": { "application/json": { schema: { type: "object", required: ["code", "msg", "data"], properties: { code: { type: "integer" }, msg: { type: "string" }, data: { type: "string" } } } } },
					},
				},
			},
		},
		"/v1/api/user/profile": {
			get: {
				operationId: "user_profile_get",
				tags: ["user"],
				responses: { 200: { description: "OK" } },
			},
		},
	},
};

describe("runApi 消费 openapi.json（新口径 Task #4）", () => {
	it("按模块分组生成 web/src/<模块>/__client/{api.ts,api.schemas.ts}", async () => {
		writeFileSync(join(dir, "openapi.json"), JSON.stringify(DOC));
		const result = await runApi({ cwd: dir, openapi: "openapi.json" });
		expect(result.contracts).toBe(2);

		const wikiApi = join(dir, "web/src/wiki/__client/api.ts");
		const wikiSchemas = join(dir, "web/src/wiki/__client/api.schemas.ts");
		const userApi = join(dir, "web/src/user/__client/api.ts");
		expect(existsSync(wikiApi)).toBe(true);
		expect(existsSync(wikiSchemas)).toBe(true);
		expect(existsSync(userApi)).toBe(true);

		expect(readFileSync(wikiApi, "utf8")).toContain("export async function wikiCollectionsIdGet(");
		expect(readFileSync(wikiSchemas, "utf8")).toContain("\"wikiCollectionsIdGet\":");
		// 幂等：第二次无变化应跳过
		const result2 = await runApi({ cwd: dir, openapi: "openapi.json" });
		expect(result2.written.length).toBe(0);
		expect(result2.skipped.length).toBeGreaterThan(0);
	});

	it("无 openapi.json 且无 contract.ts → 报错指引", async () => {
		await expect(runApi({ cwd: dir })).rejects.toThrow(/openapi\.json/);
	});
});
