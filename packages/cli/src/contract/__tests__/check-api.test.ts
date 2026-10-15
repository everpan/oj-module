import type { OpenApiDoc } from "../openapi-ir";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkApi } from "../check";
import { runApi } from "../run";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ojm-check-"));
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
	},
};

describe("checkApi 消费 openapi.json（新口径 Task #5）", () => {
	it("__client 缺失 → artifact-stale 报错", async () => {
		writeFileSync(join(dir, "openapi.json"), JSON.stringify(DOC));
		const { violations } = await checkApi({ cwd: dir });
		expect(violations.some(v => v.kind === "artifact-stale")).toBe(true);
	});

	it("ojm api 生成后重跑 --check → 无 artifact-stale", async () => {
		writeFileSync(join(dir, "openapi.json"), JSON.stringify(DOC));
		mkdirSync(join(dir, "web/src/wiki/__client"), { recursive: true });
		await runApi({ cwd: dir, openapi: "openapi.json" });
		const { violations } = await checkApi({ cwd: dir });
		expect(violations.filter(v => v.kind === "artifact-stale").length).toBe(0);
	});
});

describe("checkApi 豁免清单（D12/F19）覆盖契约→handler 侧", () => {
	it("豁免模块的根级路由（route=\"/\" 但 handler .route 为模块名）不误报 route-params-mismatch", async () => {
		// 模拟 api/.ojm-api-exempt.json 豁免 notifications 模块：oj 为根级兜底端点
		// 生成 /api/notifications（route 推导为 "/"），而 handler 落在 api/src/notifications
		// 模块根（实际 .route 即模块名 notifications）——两侧表示不同但线径一致，历史上误报
		// route-params-mismatch；修复后「契约→handler」侧同样按豁免跳过。
		writeFileSync(join(dir, "openapi.json"), JSON.stringify({
			openapi: "3.1.0",
			paths: {
				"/v1/api/notifications": {
					get: { operationId: "notifications_get", tags: ["notifications"], responses: { 200: { description: "OK" } } },
				},
			},
		} satisfies OpenApiDoc));
		mkdirSync(join(dir, "api/src/notifications"), { recursive: true });
		writeFileSync(join(dir, "api/src/notifications/api.ts"), "export default { async get() { json.ok([]); } };\n");
		mkdirSync(join(dir, "api"), { recursive: true });
		writeFileSync(join(dir, "api/.ojm-api-exempt.json"), JSON.stringify({ modules: ["notifications"], paths: [] }));
		const { violations } = await checkApi({ cwd: dir });
		expect(violations.some(v => v.kind === "route-params-mismatch")).toBe(false);
	});
});
