import { describe, expect, it } from "vitest";
import { ContractApiError, defineApi, z } from "../../packages/runtime/contract";

/**
 * AC-D11/AC-D4/AC-D12：契约 DSL 定义期校验。
 * route 一律相对 apiPrefix（无根绝对写法）、禁 .. 穿越、参数段不得混字面
 * （oj matchit 同款约束）、data 与 response:"raw" 互斥。
 */
describe("defineApi（契约 DSL，AC-D11）", () => {
	it("合法定义原样返回且 .route 可枚举", () => {
		const d = defineApi({ apiPrefix: "/order", route: "/item/{id}", params: z.object({ id: z.number() }) });
		expect(d.route).toBe("/item/{id}");
		expect(Object.keys(d)).toContain("route");
	});

	it("catch-all 参数段 {*path} 合法", () => {
		const d = defineApi({ apiPrefix: "/order", route: "/file/{*path}", response: "raw" });
		expect(d.route).toBe("/file/{*path}");
	});

	it.each([
		["route 无首斜杠", { apiPrefix: "/order", route: "list" }],
		["route 含 .. 穿越", { apiPrefix: "/order", route: "/../admin" }],
		["参数段混字面（{id}.json）", { apiPrefix: "/order", route: "/item/{id}.json" }],
		["参数段混字面（v{major}）", { apiPrefix: "/order", route: "/item/v{major}" }],
		["data 与 response:raw 并存", { apiPrefix: "/order", route: "/f", data: z.string(), response: "raw" as const }],
		["response:raw 以外的非法值", { apiPrefix: "/order", route: "/f", response: "blob" as never }],
	])("%s → 人话报错", (_label, def) => {
		expect(() => defineApi(def as never)).toThrowError(/契约/);
	});

	it("apiPrefix 无首斜杠 → 报错", () => {
		expect(() => defineApi({ apiPrefix: "order", route: "/list" })).toThrowError(/apiPrefix/);
	});

	it("评审 F9：OPTIONS 与 HEAD+data 定义期即拒（不延迟到 codegen）", () => {
		expect(() => defineApi({ apiPrefix: "/o", route: "/x", method: "OPTIONS" })).toThrowError(/OPTIONS/);
		expect(() => defineApi({ apiPrefix: "/o", route: "/x", method: "HEAD", data: z.string() })).toThrowError(/HEAD/);
		// HEAD 无 data 合法
		expect(defineApi({ apiPrefix: "/o", route: "/x", method: "HEAD" }).method).toBe("HEAD");
	});
});

describe("contractApiError", () => {
	it("携带 code 与 msg，instanceof 可用", () => {
		const err = new ContractApiError(400, "name required");
		expect(err).toBeInstanceOf(ContractApiError);
		expect(err.code).toBe(400);
		expect(err.msg).toBe("name required");
		expect(err.message).toBe("name required");
	});
});
