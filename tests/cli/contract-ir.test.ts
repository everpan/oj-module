import { describe, expect, it } from "vitest";
import { buildIr, splitRoute } from "../../packages/cli/src/contract/ir";
import { defineApi, z } from "../../packages/runtime/contract";

/**
 * AC-D12：IR 构建 + schema 白名单。
 * 白名单：object/array/enum/literal/union/optional/nullable/default +
 * string/number/boolean/date 基础约束；pipe/transform（pipe）/refine（custom
 * check）/coerce/lazy 拒绝，人话报错含端点名与被拒类型。
 */
describe("buildIr（AC-D12）", () => {
	it("收集 defineApi 端点并归一：method 缺省 GET、fullPath 拼接、paramNames 提取", () => {
		const ir = buildIr({
			getOrderList: defineApi({ apiPrefix: "/order", route: "/list", query: z.object({ page: z.number() }) }),
			getOrderDetail: defineApi({ apiPrefix: "/order", route: "/item/{id}", method: "GET", params: z.object({ id: z.number() }) }),
			download: defineApi({ apiPrefix: "/order", route: "/file/{*path}", response: "raw" }),
			notAnEndpoint: { hello: 1 },
			schemaOnly: z.string(),
		});
		expect(ir).toHaveLength(3);
		expect(ir[0]).toMatchObject({ name: "getOrderList", method: "GET", fullPath: "/order/list", paramNames: [], raw: false });
		expect(ir[1]).toMatchObject({ name: "getOrderDetail", fullPath: "/order/item/{id}", paramNames: ["id"] });
		expect(ir[2]).toMatchObject({ raw: true, paramNames: ["path"] });
	});

	it.each([
		["pipe/transform", z.string().transform((s: string) => s.length)],
		["refine", z.string().refine((s: string) => s.length > 0)],
		["coerce", z.coerce.number()],
		["lazy", z.lazy((): any => z.string())],
	])("拒绝非白名单 schema：%s", (_label, bad) => {
		expect(() => buildIr({ ep: defineApi({ apiPrefix: "/o", route: "/x", data: bad as never }) }))
			.toThrowError(/白名单/);
	});

	it("嵌套对象里的违禁 schema 报错含字段路径", () => {
		const bad = z.object({ ok: z.string(), nested: z.object({ evil: z.string().transform(s => s) }) });
		expect(() => buildIr({ ep: defineApi({ apiPrefix: "/o", route: "/x", data: bad }) }))
			.toThrowError(/nested\.evil/);
	});

	it("评审 F8：params schema 键必须覆盖 route 参数段，缺键人话报错", () => {
		expect(() => buildIr({
			ep: defineApi({ apiPrefix: "/o", route: "/item/{id}", params: z.object({ name: z.string() }) }),
		})).toThrowError(/\{id\}/);
		// params 非 object → 同样定义期拒绝
		expect(() => buildIr({
			ep: defineApi({ apiPrefix: "/o", route: "/item/{id}", params: z.string() }),
		})).toThrowError(/params 必须是 z\.object/);
		// 不声明 params → 参数段全按 string（合法）
		expect(buildIr({ ep: defineApi({ apiPrefix: "/o", route: "/item/{id}" }) })[0].paramNames).toEqual(["id"]);
	});

	it("同（目录, method）冲突报错", () => {
		expect(() => buildIr({
			a: defineApi({ apiPrefix: "/o", route: "/item/{id}", method: "GET" }),
			b: defineApi({ apiPrefix: "/o", route: "/item/{name}", method: "GET" }),
		})).toThrowError(/冲突/);
	});

	it("同目录不同 method 不冲突", () => {
		const ir = buildIr({
			a: defineApi({ apiPrefix: "/o", route: "/item", method: "POST" }),
			b: defineApi({ apiPrefix: "/o", route: "/item/{id}", method: "GET" }),
		});
		expect(ir).toHaveLength(2);
	});
});

describe("splitRoute（route → 目录镜像 + .route 尾巴）", () => {
	it.each([
		["/list", { dir: "list", tail: undefined }],
		["/item/{id}", { dir: "item", tail: "{id}" }],
		["/{id}", { dir: "", tail: "{id}" }],
		["/user/{id}/orders", { dir: "user", tail: "{id}/orders" }],
		["/file/{*path}", { dir: "file", tail: "{*path}" }],
		["/a/b/c", { dir: "a/b/c", tail: undefined }],
	])("%s → %j", (route, expected) => {
		expect(splitRoute(route)).toEqual(expected);
	});
});
