import type { OpenApiDoc } from "../openapi-ir";
import { describe, expect, it } from "vitest";
import { camelCaseOperationId, irFromOpenapi } from "../openapi-ir";

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
								properties: { title: { type: "string", maxLength: 80 } },
							},
						},
					},
				},
				responses: { 200: { description: "OK" } },
			},
		},
		"/v1/api/wiki/plain": {
			get: {
				operationId: "wiki_plain_get",
				tags: ["wiki"],
				responses: { 200: { description: "OK" } },
			},
		},
	},
};

describe("camelCaseOperationId", () => {
	it("折叠 __ 路径参数边界为单一 camelCase", () => {
		expect(camelCaseOperationId("wiki_collections__id__get")).toBe("wikiCollectionsIdGet");
		expect(camelCaseOperationId("notification_notifications_get")).toBe("notificationNotificationsGet");
	});
});

describe("irFromOpenapi", () => {
	const ir = irFromOpenapi(DOC, { base: "/v1/api" });

	it("剥 base 前缀、取模块、camelCase 命名", () => {
		const ep = ir.find(e => e.name === "wikiCollectionsIdGet")!;
		expect(ep.route).toBe("/collections/{id}");
		expect(ep.apiPrefix).toBe("/wiki");
		expect(ir.find(e => e.name === "wikiCollectionsPost")).toBeDefined();
	});

	it("params/query 按 in 通道合并，required 收集到数组", () => {
		const ep = ir.find(e => e.name === "wikiCollectionsIdGet")!;
		expect(ep.paramsSchema).toEqual({
			type: "object",
			required: ["id"],
			properties: { id: { type: "integer", minimum: 1 } },
		});
		expect(ep.querySchema).toEqual({
			type: "object",
			required: [],
			properties: { page: { type: "integer", minimum: 1 } },
		});
		expect(ep.paramNames).toEqual(["id"]);
	});

	it("requestBody → bodySchema", () => {
		const ep = ir.find(e => e.name === "wikiCollectionsPost")!;
		expect(ep.bodySchema).toEqual({
			type: "object",
			required: ["title"],
			additionalProperties: false,
			properties: { title: { type: "string", maxLength: 80 } },
		});
	});

	it("带 x-oj-response-enforced 的端点解包 data，无 response 的端点 dataSchema=undefined", () => {
		const withResp = ir.find(e => e.name === "wikiCollectionsIdGet")!;
		expect(withResp.dataSchema).toEqual({
			type: "object",
			required: ["list", "total"],
			properties: {
				list: { type: "array", items: { type: "object", properties: { id: { type: "integer" } } } },
				total: { type: "integer", minimum: 0 },
			},
		});
		const plain = ir.find(e => e.name === "wikiPlainGet")!;
		expect(plain.dataSchema).toBeUndefined();
		expect(plain.raw).toBe(false);
	});

	it("base 缺省时从 path + module 反推，route 仍为模块相对", () => {
		const ir2 = irFromOpenapi(DOC);
		const ep = ir2.find(e => e.name === "wikiCollectionsIdGet")!;
		expect(ep.route).toBe("/collections/{id}");
	});
});

/**
 * 顺序归一回归（2026-11-12 演练实测）：__client 的字节序由 IR 数组序决定，而 IR 序原先继承
 * openapi.json 的 paths 键序——oj openapi 改版后键序从「声明序」变「字典序」，导致同一份源码
 * 在工程里重跑 ojm api 会改写内置模块生成物：ojm build 判「内容被修改」、ojm init --yes 后又
 * 被 ojm api --check 判「生成物过期」，用户无解。IR 必须与输入键序无关。
 */
describe("irFromOpenapi 输出顺序与输入键序无关", () => {
	const op = (tags: string[]): Record<string, unknown> => ({ tags, responses: { 200: { description: "OK" } } });
	const doc = (reversed: boolean): OpenApiDoc => {
		const entries: Array<[string, Record<string, unknown>]> = [
			["/v1/api/sys/bot-binding", { get: op(["sys"]), post: op(["sys"]) }],
			["/v1/api/sys/departments", { delete: op(["sys"]), get: op(["sys"]) }],
		];
		if (reversed)
			entries.reverse();
		return { openapi: "3.1.0", paths: Object.fromEntries(entries) } as OpenApiDoc;
	};

	it("字典序与声明序产出相同的端点序列", () => {
		const key = (e: { method: string, fullPath: string }) => `${e.method} ${e.fullPath}`;
		const forward = irFromOpenapi(doc(false)).map(key);
		const reversed = irFromOpenapi(doc(true)).map(key);
		expect(reversed).toEqual(forward);
		expect(forward).toEqual([
			"GET /sys/bot-binding",
			"POST /sys/bot-binding",
			"DELETE /sys/departments",
			"GET /sys/departments",
		]);
	});
});
