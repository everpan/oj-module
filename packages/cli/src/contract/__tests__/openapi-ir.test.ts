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
