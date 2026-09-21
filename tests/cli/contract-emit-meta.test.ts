import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { emitOpenapiYaml, emitRoutesJson } from "../../packages/cli/src/contract/emit-meta";
import { buildIr } from "../../packages/cli/src/contract/ir";
import { defineApi, z } from "../../packages/runtime/contract";

/**
 * AC-D1/D9：routes.json（ojm dev mock 消费，规范化同 oj routes.js）与
 * openapi.yaml（文档站源）发射器。字节稳定是硬要求（提交产物，diff 即评审）。
 */

const ir = buildIr({
	getOrderList: defineApi({
		apiPrefix: "/order",
		route: "/list",
		query: z.object({ page: z.number().int().min(1), size: z.number().int().optional() }),
		data: z.object({ list: z.array(z.object({ id: z.number(), order_no: z.string() })), total: z.number() }),
		description: "订单列表",
	}),
	getOrderDetail: defineApi({
		apiPrefix: "/order",
		route: "/item/{id}",
		params: z.object({ id: z.number() }),
		data: z.object({ id: z.number(), order_no: z.string() }),
	}),
	createOrder: defineApi({
		apiPrefix: "/order",
		route: "/item",
		method: "POST",
		body: z.object({ order_no: z.string().min(1) }),
		data: z.object({ id: z.number() }),
	}),
	deleteOrder: defineApi({
		apiPrefix: "/order",
		route: "/item/{id}",
		method: "DELETE",
		params: z.object({ id: z.number() }),
	}),
	downloadFile: defineApi({
		apiPrefix: "/order",
		route: "/file/{*path}",
		response: "raw",
		description: "下载附件",
	}),
});

describe("emitRoutesJson（AC-D9）", () => {
	it("规范化 + 排序 + 字节稳定", () => {
		const json = emitRoutesJson(ir);
		expect(json).toMatchSnapshot();
		const rows = JSON.parse(json) as { method: string, pattern: string }[];
		// 去 apiPrefix 首斜杠、不含 base、含模块段
		expect(rows).toContainEqual({ method: "GET", pattern: "order/item/{id}" });
		expect(rows).toContainEqual({ method: "GET", pattern: "order/file/{*path}" });
		// method+pattern 排序
		expect(rows.map(r => `${r.method} ${r.pattern}`)).toEqual([
			"DELETE order/item/{id}",
			"GET order/file/{*path}",
			"GET order/item/{id}",
			"GET order/list",
			"POST order/item",
		]);
		// 同输入两次发射字节一致
		expect(emitRoutesJson(ir)).toBe(json);
	});
});

describe("emitOpenapiYaml（AC-D1）", () => {
	const yaml = emitOpenapiYaml(ir, { title: "订单服务", version: "1.0.0" });
	const doc = parse(yaml) as any;

	it("快照 + 文档骨架", () => {
		expect(yaml).toMatchSnapshot();
		expect(doc.openapi).toBe("3.1.0");
		expect(doc.info).toEqual({ title: "订单服务", version: "1.0.0" });
	});

	it("path 参数段 → parameters（required: true）", () => {
		const params = doc.paths["/order/item/{id}"].get.parameters;
		expect(params).toEqual([expect.objectContaining({ name: "id", in: "path", required: true, schema: expect.objectContaining({ type: "number" }) })]);
	});

	it("query schema → query parameters（optional 不进 required）", () => {
		const params = doc.paths["/order/list"].get.parameters;
		expect(params).toEqual(expect.arrayContaining([
			expect.objectContaining({ name: "page", in: "query", required: true }),
			expect.objectContaining({ name: "size", in: "query", required: false }),
		]));
	});

	it("body schema → requestBody；data schema 裹信封进 200 响应", () => {
		const post = doc.paths["/order/item"].post;
		expect(post.requestBody.content["application/json"].schema.properties.order_no.type).toBe("string");
		const respSchema = doc.paths["/order/list"].get.responses["200"].content["application/json"].schema;
		expect(respSchema.properties.code).toEqual({ type: "integer" });
		expect(respSchema.properties.data.properties.total.type).toBe("number");
	});

	it("raw 端点：octet-stream 响应，不进信封；catch-all 段转 {path}", () => {
		const get = doc.paths["/order/file/{path}"].get;
		expect(get.responses["200"].content["application/octet-stream"]).toBeDefined();
		expect(get.parameters).toEqual([expect.objectContaining({ name: "path", in: "path", required: true })]);
	});

	it("description 进 operation；字节稳定", () => {
		expect(doc.paths["/order/list"].get.description).toBe("订单列表");
		expect(emitOpenapiYaml(ir, { title: "订单服务", version: "1.0.0" })).toBe(yaml);
	});
});

/**
 * multipart/form-data（form 槽）：独立 IR + 独立快照——无 form 的契约产物必须逐字节不变。
 */
const formIr = buildIr({
	uploadAvatar: defineApi({
		apiPrefix: "/personal-center",
		route: "/upload",
		method: "POST",
		form: {
			fields: z.object({ kind: z.string(), note: z.string().optional() }),
			files: [{ name: "avatar", required: true }, { name: "gallery", multiple: true }],
		},
		data: z.object({ url: z.string() }),
		description: "上传头像/附件",
	}),
});

describe("emitOpenapiYaml：multipart/form-data（form 槽）", () => {
	const yaml = emitOpenapiYaml(formIr, { title: "上传服务", version: "1.0.0" });
	const doc = parse(yaml) as any;

	it("快照 + requestBody.content[\"multipart/form-data\"]：文本部件走 JSON Schema、文件部件 binary", () => {
		expect(yaml).toMatchSnapshot();
		const post = doc.paths["/personal-center/upload"].post;
		expect(post.requestBody.required).toBe(true);
		// form 端点不经 application/json 通道
		expect(post.requestBody.content["application/json"]).toBeUndefined();
		const schema = post.requestBody.content["multipart/form-data"].schema;
		expect(schema.type).toBe("object");
		expect(schema.properties.kind).toMatchObject({ type: "string" });
		expect(schema.properties.note).toMatchObject({ type: "string" });
		// 文件部件：binary；multiple → array of binary
		expect(schema.properties.avatar).toEqual({ type: "string", format: "binary" });
		expect(schema.properties.gallery).toEqual({ type: "array", items: { type: "string", format: "binary" } });
		// required = fields 的 required ∪ 必传文件（可选部件不进 required）
		expect(schema.required).toEqual(["kind", "avatar"]);
	});

	it("form 与 data 不互斥：响应信封照旧带 data schema", () => {
		const resp = doc.paths["/personal-center/upload"].post.responses["200"].content["application/json"].schema;
		expect(resp.properties.data.properties.url.type).toBe("string");
	});

	it("字节稳定（同输入两次发射一致）", () => {
		expect(emitOpenapiYaml(formIr, { title: "上传服务", version: "1.0.0" })).toBe(yaml);
	});
});
