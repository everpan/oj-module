import type { OpenApiDoc } from "../openapi-ir";
import { describe, expect, it } from "vitest";
import { emitClient } from "../emit-client";
import { irFromOpenapi } from "../openapi-ir";

const DOC: OpenApiDoc = {
	openapi: "3.1.0",
	paths: {
		"/v1/api/wiki/collections/{id}": {
			get: {
				"operationId": "wiki_collections__id__get",
				"tags": ["wiki"],
				"x-oj-file": "wiki/collections/_id_/api.ts",
				"parameters": [
					{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
					{ name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
				],
				"responses": {
					200: {
						"description": "OK",
						"x-oj-response-enforced": false,
						"content": {
							"application/json": {
								schema: {
									type: "object",
									required: ["code", "msg", "data"],
									properties: {
										code: { type: "integer" },
										msg: { type: "string" },
										data: {
											type: "object",
											required: ["list", "total"],
											properties: {
												list: { type: "array", items: { type: "object", properties: { id: { type: "integer" } } } },
												total: { type: "integer", minimum: 0 },
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/api/wiki/collections": {
			post: {
				operationId: "wiki_collections_post",
				tags: ["wiki"],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["title"],
								additionalProperties: false,
								properties: { title: { type: "string", maxLength: 80 }, tag: { type: ["string", "null"] } },
							},
						},
					},
				},
				responses: { 200: { description: "OK" } },
			},
		},
	},
};

function emit() {
	const ir = irFromOpenapi(DOC, { base: "/v1/api" });
	return emitClient(ir, { target: "module", module: "wiki" });
}

describe("emitClient (module target)", () => {
	const { "api.ts": apiTs, "api.schemas.ts": schemasTs } = emit();

	it("aPI_PREFIX / MODULE_PREFIX 用 JSON 字符串字面量（注入安全）", () => {
		expect(apiTs).toContain("export const API_PREFIX = \"/wiki\";");
		expect(apiTs).toContain("export const MODULE_PREFIX = \"/wiki\";");
	});

	it("端点函数名 camelCase", () => {
		expect(apiTs).toContain("export async function wikiCollectionsIdGet(");
	});

	it("信封解包到强类型 data（PascalCase 返回类型名）", () => {
		expect(apiTs).toContain("env.data as WikiCollectionsIdGetData");
		expect(apiTs).toContain("Promise<WikiCollectionsIdGetData>");
	});

	it("dEV 下对 data 做 safeParse 校验（契约违例兜底）", () => {
		expect(apiTs).toContain("schemas[\"wikiCollectionsIdGet\"].data.safeParse(data)");
	});

	it("客户端不含 z.regex（pattern 不进运行时）", () => {
		expect(apiTs).not.toContain("z.regex");
	});

	it("api.schemas.ts 用 JSON 字符串字面量作端点键", () => {
		expect(schemasTs).toContain("\"wikiCollectionsIdGet\":");
		expect(schemasTs).toContain("\"wikiCollectionsPost\":");
	});

	it("params id → z.number().int().min(1)；body tag 类型数组 → .nullable()", () => {
		expect(schemasTs).toContain("\"id\": z.number().int().min(1)");
		expect(schemasTs).toContain("\"tag\": z.string().nullable().optional()");
	});

	it("body additionalProperties:false → .strict()", () => {
		expect(schemasTs).toContain("}).strict()");
	});
});

describe("emitClient 注入安全：模块名含特殊字符不破坏源码", () => {
	it("module 名含 -/$ 时 MODULE_PREFIX/工厂名仍走字符串字面量（API_PREFIX 取 IR wirePrefix）", () => {
		const ir = irFromOpenapi(DOC, { base: "/v1/api" });
		const { "api.ts": apiTs } = emitClient(ir, { target: "module", module: "weird-name" });
		// module 选项只影响 MODULE_PREFIX 与 create<Module>Client 名
		expect(apiTs).toContain("export const MODULE_PREFIX = \"/weird-name\";");
		expect(apiTs).toContain("export function createWeirdNameClient(");
		// 前缀均为字符串字面量，无裸插值
		expect(apiTs).not.toContain("MODULE_PREFIX = /weird-name;");
		// API_PREFIX 取自 IR 的 wirePrefix（/wiki），与 module 选项无关
		expect(apiTs).toContain("export const API_PREFIX = \"/wiki\";");
	});
});

describe("emitClient 空 IR 报错", () => {
	it("iR 为空抛错（无端点无需生成）", () => {
		expect(() => emitClient([], { target: "module", module: "x" })).toThrow();
	});
});
