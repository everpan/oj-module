import { describe, expect, it } from "vitest";
import { emitZodFromJsonSchema } from "../emit-jsonschema-zod";

describe("emitZodFromJsonSchema", () => {
	it("object：required 无 .optional()，其余 .optional()，additionalProperties:false→.strict()", () => {
		expect(emitZodFromJsonSchema({
			type: "object",
			required: ["title"],
			additionalProperties: false,
			properties: { title: { type: "string", maxLength: 80 }, remark: { type: "string", nullable: true } },
		}, "x")).toBe(
			"z.object({\n\t\"title\": z.string().max(80),\n\t\"remark\": z.string().nullable().optional()\n}).strict()",
		);
	});

	it("类型数组 [\"string\",\"null\"] → .nullable()", () => {
		expect(emitZodFromJsonSchema({ type: ["string", "null"] }, "x")).toBe("z.string().nullable()");
	});

	it("类型数组 [\"string\",\"number\"]（oj 翻 z.union）→ z.union([z.string(), z.number()])", () => {
		// oj 把 z.union([z.string(), z.number()]) 翻成类型数组，codegen 必须兜住（映射表补充）
		expect(emitZodFromJsonSchema({ type: ["string", "number"] }, "x")).toBe("z.union([z.string(), z.number()])");
	});

	it("类型数组多实类型 + null → z.union(...).nullable()", () => {
		expect(emitZodFromJsonSchema({ type: ["string", "number", "null"] }, "x"))
			.toBe("z.union([z.string(), z.number()]).nullable()");
	});

	it("pattern 不进 z.regex，仅发 // @oj-warn 注释（ReDoS + 跨语言漂移防护）", () => {
		const out = emitZodFromJsonSchema({ type: "string", pattern: "^[a-z]+$" }, "x");
		expect(out).toContain("// @oj-warn: pattern=");
		expect(out).not.toContain("z.regex");
	});

	it("default 不射 .default()，仅发 // @oj-note 注释", () => {
		const out = emitZodFromJsonSchema({ type: "integer", default: 0 }, "x");
		expect(out).toContain("@oj-note: default=0");
		expect(out).not.toContain(".default(");
	});

	it("数值 enum → z.union([z.literal...])；字符串 enum → z.enum", () => {
		// enum 是独立基础类型（zod v4 无 z.number().enum()/z.string().enum()，
		// 挂在 typed base 后是运行期 TypeError 根因）——故作为 base 整体返回
		expect(emitZodFromJsonSchema({ type: "integer", enum: [0, 1, 2] }, "x"))
			.toBe("z.union([z.literal(0), z.literal(1), z.literal(2)])");
		expect(emitZodFromJsonSchema({ type: "string", enum: ["a", "b"] }, "x"))
			.toBe("z.enum([\"a\", \"b\"])");
	});

	it("required 项不在 properties 中 → 不抛错、跳过缺失键", () => {
		expect(emitZodFromJsonSchema({ type: "object", required: ["ghost"], properties: { a: { type: "string" } } }, "x"))
			.toBe("z.object({\n\t\"a\": z.string().optional()\n})");
	});

	it("注入安全：属性名经 JSON.stringify 成字符串字面量键，无裸模板插值", () => {
		// 拼接构造含 ${
		// 的键名：字面量里写 ${ 会触发 no-template-curly-in-string
		const nastyKey = ["a", "$", "{b}"].join("");
		const out = emitZodFromJsonSchema({ type: "object", properties: { "`": { type: "string" }, [nastyKey]: { type: "string" }, "*/": { type: "string" } } }, "x");
		expect(out).toMatch(/"a\$\{b\}":/);
		expect(out).toMatch(/"`":/);
	});

	it("白名单外关键字 fail-fast", () => {
		expect(() => emitZodFromJsonSchema({ type: "string", format: "email" } as never, "x")).toThrow();
	});

	it("array：items + minItems/maxItems", () => {
		expect(emitZodFromJsonSchema({ type: "array", minItems: 1, maxItems: 20, items: { type: "string", pattern: "^[a-z]+$" } }, "x"))
			.toBe("z.array(// @oj-warn: pattern=\"^[a-z]+$\" 为 Rust regex，未在前端执行（跨语言语义漂移/ReDoS 风险）\n\tz.string()).min(1).max(20)");
	});

	it("object nullable → .strict().nullable()（补齐标量外的 nullable 缺口）", () => {
		expect(emitZodFromJsonSchema({ type: "object", nullable: true, additionalProperties: false, properties: { a: { type: "string" } } }, "x"))
			.toBe("z.object({\n\t\"a\": z.string().optional()\n}).strict().nullable()");
	});

	it("array nullable → z.array(...).nullable()", () => {
		expect(emitZodFromJsonSchema({ type: "array", nullable: true, items: { type: "integer" } }, "x"))
			.toBe("z.array(z.number().int()).nullable()");
	});

	it("additionalProperties:true → .catchall(z.unknown())（任意额外键放行）", () => {
		expect(emitZodFromJsonSchema({ type: "object", additionalProperties: true, properties: { a: { type: "string" } } }, "x"))
			.toBe("z.object({\n\t\"a\": z.string().optional()\n}).catchall(z.unknown())");
	});

	it("additionalProperties:schema → .catchall(emitZod(schema))（额外键须符合子 schema）", () => {
		expect(emitZodFromJsonSchema({ type: "object", additionalProperties: { type: "string", maxLength: 8 }, properties: { a: { type: "string" } } }, "x"))
			.toBe("z.object({\n\t\"a\": z.string().optional()\n}).catchall(z.string().max(8))");
	});
});
