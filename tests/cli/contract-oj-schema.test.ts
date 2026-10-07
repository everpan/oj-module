import { defineApi, z } from "@oj-module/runtime/contract";
import { describe, expect, it } from "vitest";
import { emitOjSchemaLine, ojSchemaOfEndpoint } from "../../packages/cli/src/contract/emit-oj-schema";
import { buildIr } from "../../packages/cli/src/contract/ir";

/**
 * 契约 → oj `.schema`（v0.1.44，手册 §4）：把前端契约的入参声明落到后端
 * handler 上，由 oj 在 JS 之前校验。
 *
 * 核心约束：oj 的关键字是**白名单**（type/required/properties/items/
 * additionalProperties/minimum/maximum/minLength/maxLength/pattern/enum/
 * nullable/minItems/maxItems），白名单外一律装配期 fail-fast——所以发射侧
 * 必须主动裁剪，不能把 format / oneOf 原样写出去。
 */

function irOf(defs: unknown[], name = "ep") {
	const exports: Record<string, unknown> = {};
	defs.forEach((d, i) => {
		exports[`${name}${i}`] = d;
	});
	return buildIr(exports);
}

describe("ojSchemaOfEndpoint —— 白名单裁剪", () => {
	it("三通道齐全：params/query/body 各自成块，无声明的通道不出现", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/order",
			route: "/item/{id}",
			params: z.object({ id: z.number() }),
			query: z.object({ page: z.number().min(1), keyword: z.string().max(20).optional() }),
			body: z.object({ name: z.string().min(2), tags: z.array(z.string()).max(3) }),
			method: "POST",
			data: z.object({ ok: z.boolean() }),
		})]);

		const schema = ojSchemaOfEndpoint(ep)!;
		expect(Object.keys(schema)).toEqual(["params", "query", "body"]);
		expect(schema.params).toMatchObject({ type: "object", properties: { id: { type: "number" } }, required: ["id"] });
		expect(schema.query).toMatchObject({ properties: { page: { type: "number", minimum: 1 } }, required: ["page"] });
		expect(schema.body).toMatchObject({
			properties: {
				name: { type: "string", minLength: 2 },
				tags: { type: "array", items: { type: "string" }, maxItems: 3 },
			},
			required: ["name", "tags"],
		});
	});

	it("array 的长度约束映射成 minItems/maxItems（不是 minLength）", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/list",
			body: z.object({ ids: z.array(z.number()).min(1).max(9) }),
			method: "POST",
		})]);
		expect((ojSchemaOfEndpoint(ep)!.body as any).properties.ids).toMatchObject({ type: "array", minItems: 1, maxItems: 9 });
	});

	it("optional/default 不算 required；nullable 走 nullable 键", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			body: z.object({ a: z.string(), b: z.string().optional(), c: z.string().nullable() }),
			method: "POST",
		})]);
		const body = ojSchemaOfEndpoint(ep)!.body as any;
		expect(body.required).toEqual(["a", "c"]);
		expect(body.properties.c).toMatchObject({ type: "string", nullable: true });
	});

	it("全字面量 union → enum（白名单无 oneOf，必须等价降级）", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			body: z.object({ status: z.union([z.literal(1), z.literal(0)]) }),
			method: "POST",
		})]);
		const diag = { warnings: [] };
		const body = ojSchemaOfEndpoint(ep, diag)!.body as any;
		expect(body.properties.status).toMatchObject({ type: "number", enum: [1, 0] });
		expect(diag.warnings).toHaveLength(0);
	});

	it("非字面量 union → 该字段不做后端校验，但必须说出来（不静默丢）", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			body: z.object({ by: z.union([z.string(), z.number()]) }),
			method: "POST",
		})]);
		const diag = { warnings: [] };
		const body = ojSchemaOfEndpoint(ep, diag)!.body as any;
		expect(body.properties.by).toEqual({});
		expect(diag.warnings.join()).toMatch(/oneOf|union/);
	});

	it("format 不在白名单：降级跳过并告警（写出去服务起不来）", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			body: z.object({ email: z.string().email() }),
			method: "POST",
		})]);
		const diag = { warnings: [] };
		const body = ojSchemaOfEndpoint(ep, diag)!.body as any;
		expect(body.properties.email).toEqual({ type: "string" });
		expect(diag.warnings.join()).toMatch(/format/);
	});

	it("z.date() → string（JSON 无日期类型，线上是 ISO 串）", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			body: z.object({ at: z.date() }),
			method: "POST",
		})]);
		expect((ojSchemaOfEndpoint(ep)!.body as any).properties.at).toEqual({ type: "string" });
	});
});

describe("ojSchemaOfEndpoint —— 死契约与非法 pattern 在生成期拦下", () => {
	it("params/query 声明 array → 报错（HTTP 里只有字符串，oj 装配期也会拒）", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			query: z.object({ ids: z.array(z.string()) }),
		})]);
		expect(() => ojSchemaOfEndpoint(ep)).toThrowError(/扁平标量/);
	});

	it("pattern 用零宽断言 → 报错（oj 是 Rust regex，不支持 lookahead）", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			body: z.object({ code: z.string().regex(/^(?=.*[A-Z])/) }),
			method: "POST",
		})]);
		expect(() => ojSchemaOfEndpoint(ep)).toThrowError(/Rust regex|零宽断言/);
	});

	it("普通 pattern 保留（Rust 与 ECMA 都支持的写法）", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			body: z.object({ code: z.string().regex(/^[A-Z]{3}$/) }),
			method: "POST",
		})]);
		expect((ojSchemaOfEndpoint(ep)!.body as any).properties.code).toMatchObject({ type: "string", pattern: "^[A-Z]{3}$" });
	});
});

describe("emitOjSchemaLine", () => {
	it("无入参声明 → 不发射（空串，stub 保持原样）", () => {
		const [ep] = irOf([defineApi({ apiPrefix: "/x", route: "/u", data: z.object({ a: z.string() }) })]);
		expect(emitOjSchemaLine(ep, "get")).toBe("");
	});

	it("有声明 → `get.schema = {...};` 且是合法可解析的对象字面量", () => {
		const [ep] = irOf([defineApi({
			apiPrefix: "/x",
			route: "/u",
			query: z.object({ page: z.number().min(1) }),
		})]);
		const line = emitOjSchemaLine(ep, "get");
		expect(line.startsWith("get.schema = ")).toBe(true);
		expect(line.trimEnd().endsWith(";")).toBe(true);
		const json = line.slice("get.schema = ".length).replace(/;\s*$/, "");
		expect(JSON.parse(json)).toMatchObject({ query: { properties: { page: { minimum: 1 } } } });
	});
});
