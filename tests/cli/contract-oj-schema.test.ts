import type { OjSchemaDiag } from "../../packages/cli/src/contract/emit-oj-schema";
import { describe, expect, it } from "vitest";
import { emitOjSchemaLine, ojSchemaOfEndpoint } from "../../packages/cli/src/contract/emit-oj-schema";
import { mkEp } from "./_fixtures";

/**
 * 契约 → oj `.schema`（v0.1.44，手册 §4）：把入参声明落到后端 handler 上，
 * 由 oj 在 JS 之前校验。
 *
 * 翻译层退役后，输入是 IR 里的 JSON Schema（来自 openapi.json，oj `.schema` 白名单子集）。
 * 核心约束：oj 的关键字是**白名单**（type/required/properties/items/
 * additionalProperties/minimum/maximum/minLength/maxLength/pattern/enum/
 * nullable/minItems/maxItems），白名单外一律装配期 fail-fast——所以发射侧
 * 必须主动裁剪，不能把 format / oneOf 原样写出去。
 */

describe("ojSchemaOfEndpoint —— 白名单裁剪", () => {
	it("三通道齐全：params/query/body 各自成块，无声明的通道不出现", () => {
		const ep = mkEp({
			apiPrefix: "/order",
			route: "/item/{id}",
			params: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
			query: { type: "object", properties: { page: { type: "number", minimum: 1 }, keyword: { type: "string", maxLength: 20 } }, required: ["page"] },
			body: { type: "object", properties: { name: { type: "string", minLength: 2 }, tags: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["name", "tags"] },
			method: "POST",
			data: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
		});

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
		const ep = mkEp({ apiPrefix: "/x", route: "/list", body: { type: "object", properties: { ids: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 9 } }, required: ["ids"] }, method: "POST" });
		expect((ojSchemaOfEndpoint(ep)!.body as Record<string, unknown>).properties as Record<string, unknown>).toMatchObject({ ids: { type: "array", minItems: 1, maxItems: 9 } });
	});

	it("optional/default 不算 required；nullable 走 nullable 键（type 数组含 null）", () => {
		const ep = mkEp({
			apiPrefix: "/x",
			route: "/u",
			body: { type: "object", properties: { a: { type: "string" }, b: { type: "string" }, c: { type: ["string", "null"] } }, required: ["a", "c"] },
			method: "POST",
		});
		const body = ojSchemaOfEndpoint(ep)!.body as Record<string, unknown>;
		expect(body.required).toEqual(["a", "c"]);
		expect((body.properties as Record<string, unknown>).c).toMatchObject({ type: "string", nullable: true });
	});

	it("全字面量 union → enum（白名单无 oneOf，必须等价降级）", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", body: { type: "object", properties: { status: { type: "number", enum: [1, 0] } }, required: ["status"] }, method: "POST" });
		const diag: OjSchemaDiag = { warnings: [] };
		const body = ojSchemaOfEndpoint(ep, diag)!.body as Record<string, unknown>;
		expect((body.properties as Record<string, unknown>).status).toMatchObject({ type: "number", enum: [1, 0] });
		expect(diag.warnings).toHaveLength(0);
	});

	it("非字面量 union → 该字段不做后端校验（warn 并丢弃，不静默丢）", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", body: { type: "object", properties: { by: { type: ["string", "number"] } }, required: ["by"] }, method: "POST" });
		const diag: OjSchemaDiag = { warnings: [] };
		const body = ojSchemaOfEndpoint(ep, diag)!.body as Record<string, unknown>;
		expect((body.properties as Record<string, unknown> | undefined)?.by).toBeUndefined();
		expect(diag.warnings.join()).toMatch(/oneOf|union/);
	});

	it("format 不在白名单：降级跳过并告警（写出去服务起不来）", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", body: { type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] }, method: "POST" });
		const diag: OjSchemaDiag = { warnings: [] };
		const body = ojSchemaOfEndpoint(ep, diag)!.body as Record<string, unknown>;
		expect((body.properties as Record<string, unknown>).email).toEqual({ type: "string" });
		expect(diag.warnings.join()).toMatch(/format/);
	});

	it("date 在 JSON Schema 无独立类型：用 string 表达（线上 ISO 串）", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", body: { type: "object", properties: { at: { type: "string" } }, required: ["at"] }, method: "POST" });
		expect((ojSchemaOfEndpoint(ep)!.body as Record<string, unknown>).properties as Record<string, unknown>).toEqual({ at: { type: "string" } });
	});
});

describe("ojSchemaOfEndpoint —— 死契约与非法 pattern 在生成期拦下", () => {
	it("params/query 声明 array → 报错（HTTP 里只有字符串，oj 装配期也会拒）", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", query: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] } });
		expect(() => ojSchemaOfEndpoint(ep)).toThrowError(/扁平标量/);
	});

	it("pattern 用零宽断言 → 不报错但告警（oj 是 Rust regex，不支持 lookahead）", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", body: { type: "object", properties: { code: { type: "string", pattern: "^(?=.*[A-Z])" } }, required: ["code"] }, method: "POST" });
		const diag: OjSchemaDiag = { warnings: [] };
		expect(() => ojSchemaOfEndpoint(ep, diag)).not.toThrow();
		expect(diag.warnings.join()).toMatch(/零宽断言|Rust regex/);
	});

	it("普通 pattern 保留（Rust 与 ECMA 都支持的写法）", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", body: { type: "object", properties: { code: { type: "string", pattern: "^[A-Z]{3}$" } }, required: ["code"] }, method: "POST" });
		expect((ojSchemaOfEndpoint(ep)!.body as Record<string, unknown>).properties as Record<string, unknown>).toMatchObject({ code: { type: "string", pattern: "^[A-Z]{3}$" } });
	});
});

describe("emitOjSchemaLine", () => {
	it("无入参声明 → 不发射（空串，stub 保持原样）", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", data: { type: "object", properties: { a: { type: "string" } }, required: ["a"] } });
		expect(emitOjSchemaLine(ep, "get")).toBe("");
	});

	it("有声明 → `get.schema = {...};` 且是合法可解析的对象字面量", () => {
		const ep = mkEp({ apiPrefix: "/x", route: "/u", query: { type: "object", properties: { page: { type: "number", minimum: 1 } }, required: ["page"] } });
		const line = emitOjSchemaLine(ep, "get");
		expect(line.startsWith("get.schema = ")).toBe(true);
		expect(line.trimEnd().endsWith(";")).toBe(true);
		const json = line.slice("get.schema = ".length).replace(/;\s*$/, "");
		expect(JSON.parse(json)).toMatchObject({ query: { properties: { page: { minimum: 1 } } } });
	});
});
