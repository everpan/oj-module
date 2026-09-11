import { describe, expect, it } from "vitest";
import { emitSchemaSource } from "../../packages/cli/src/contract/emit-schema";
import { z } from "../../packages/runtime/contract";

/** 把发射文本还原为 zod schema（测试内 eval，z 注入） */
function rebuild<T = z.ZodType>(src: string): T {
	// eslint-disable-next-line no-new-func -- 测试专用：还原 codegen 产物做往返保真断言，非生产路径
	return new Function("z", `return ${src}`)(z) as T;
}

/**
 * 白名单 schema → TS 源码发射（AC-D12/D6）：生成物里的 schema 是重新发射的
 * 源码而非跨树 import。核心性质是**往返保真**：发射文本重建后与原始 schema
 * 对同一数据的 safeParse 结果一致。
 */
describe("emitSchemaSource（白名单内往返保真）", () => {
	it("object + 约束 + enum + optional/default 复合 schema", () => {
		const original = z.object({
			id: z.number().int(),
			order_no: z.string().min(1).max(32),
			email: z.string().email().optional(),
			price: z.number().min(0).max(9999),
			tags: z.array(z.string()).optional(),
			status: z.enum(["open", "closed"]).default("open"),
			note: z.string().nullable(),
		});
		const src = emitSchemaSource(original);
		expect(src).toMatchSnapshot();
		const rebuilt = rebuild(src);
		const good = { id: 1, order_no: "A1", price: 9.9, status: "open", note: null };
		expect(rebuilt.safeParse(good).success).toBe(true);
		expect(original.safeParse(good).success).toBe(true);
		const bad = { id: 1.5, order_no: "", price: -1, status: "nope", note: 3 };
		expect(rebuilt.safeParse(bad).success).toBe(false);
		expect(original.safeParse(bad).success).toBe(false);
	});

	it("union / literal / boolean / date / 嵌套数组", () => {
		const original = z.object({
			id: z.union([z.string(), z.number()]),
			flag: z.boolean(),
			at: z.date().optional(),
			matrix: z.array(z.array(z.number())),
			kind: z.literal("order"),
		});
		const rebuilt = rebuild(emitSchemaSource(original));
		expect(rebuilt.safeParse({ id: "x", flag: true, matrix: [[1]], kind: "order" }).success).toBe(true);
		expect(rebuilt.safeParse({ id: "x", flag: 1, matrix: [[1]], kind: "no" }).success).toBe(false);
	});

	it("评审 F1：z.date() 发为 z.iso.datetime()——线上 ISO 串过 safeParse，Date 实例反而不收", () => {
		const src = emitSchemaSource(z.date());
		expect(src).toBe("z.iso.datetime()");
		const rebuilt = rebuild(src);
		expect(rebuilt.safeParse("2026-01-01T00:00:00.000Z").success).toBe(true);
		expect(rebuilt.safeParse(new Date()).success).toBe(false);
	});

	it("评审 F10：不可保真即拒绝——带 flags 的 regex / 未映射 string format 报错而非静默降级", () => {
		expect(() => emitSchemaSource(z.string().regex(/^ORD-\d+$/i))).toThrowError(/flags/);
		expect(() => emitSchemaSource(z.string().ulid())).toThrowError(/format/);
	});

	it("评审 F10：array 的 min/max 约束保真发射", () => {
		const src = emitSchemaSource(z.array(z.string()).min(1).max(5));
		expect(src).toContain(".min(1)");
		expect(src).toContain(".max(5)");
		const rebuilt = rebuild(src);
		expect(rebuilt.safeParse([]).success).toBe(false);
		expect(rebuilt.safeParse(["a"]).success).toBe(true);
	});

	it("非法标识符键名被引号包裹", () => {
		const src = emitSchemaSource(z.object({ "order-no": z.string() }));
		expect(src).toContain("\"order-no\"");
		expect(rebuild(src).safeParse({ "order-no": "a" }).success).toBe(true);
	});

	it("default 惰性函数在 v4 下被求值后发射；求值为 undefined → 人话报错", () => {
		expect(emitSchemaSource(z.string().default(() => "lazy-x"))).toContain(".default(\"lazy-x\")");
		expect(() => emitSchemaSource(z.string().default(() => undefined as never)))
			.toThrowError(/default/);
	});

	it("regex 约束还原 pattern.source", () => {
		const src = emitSchemaSource(z.string().regex(/^ORD-\d+$/));
		expect(src).toContain("/^ORD-\\d+$/");
		expect(rebuild(src).safeParse("ORD-1").success).toBe(true);
	});
});
