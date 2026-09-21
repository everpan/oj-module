import type { ApiDefinitionInput } from "../../packages/runtime/contract";
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

/**
 * multipart/form-data（form 槽）：文本部件走 zod，文件部件只声明名字/形态——
 * 二进制刻意不进 schema（JSON Schema 无 binary，FormData 由生成 client 组装）。
 */
describe("defineApi：multipart（form 槽）", () => {
	it("合法形态：fields + files 并存、纯 fields、纯 files", () => {
		const both = defineApi({
			apiPrefix: "/o",
			route: "/up",
			method: "POST",
			form: { fields: z.object({ note: z.string() }), files: [{ name: "avatar", required: true }] },
		});
		expect(both.form?.files).toEqual([{ name: "avatar", required: true }]);
		// 文件部件不需要 zod：纯文件 form 也能定义（zod 表达不了二进制）
		const filesOnly: ApiDefinitionInput = defineApi({ apiPrefix: "/o", route: "/up", method: "POST", form: { files: [{ name: "f", multiple: true }] } });
		expect(filesOnly.form?.fields).toBeUndefined();
		const fieldsOnly: ApiDefinitionInput = defineApi({ apiPrefix: "/o", route: "/up", method: "POST", form: { fields: z.object({ note: z.string() }) } });
		expect(fieldsOnly.form?.files).toBeUndefined();
	});

	it("form 与 data（响应信封）不互斥：上传端点返回资源 URL 是常态", () => {
		const d = defineApi({ apiPrefix: "/o", route: "/up", method: "POST", form: { files: [{ name: "f" }] }, data: z.string() });
		expect(d.data).toBeDefined();
		expect(d.form?.files).toEqual([{ name: "f" }]);
	});

	it.each([
		["form 与 body 并存", { apiPrefix: "/o", route: "/up", method: "POST", body: z.object({ a: z.string() }), form: { files: [{ name: "f" }] } }],
		["空 form（既无 fields 也无 files）", { apiPrefix: "/o", route: "/up", method: "POST", form: {} }],
		["form.files 缺 name", { apiPrefix: "/o", route: "/up", method: "POST", form: { files: [{ name: "" }] } }],
		["form.files 字段名重复", { apiPrefix: "/o", route: "/up", method: "POST", form: { files: [{ name: "f" }, { name: "f", multiple: true }] } }],
	])("%s → 定义期人话报错", (_label, def) => {
		expect(() => defineApi(def as never)).toThrowError(/契约/);
	});

	it("form 与 body 互斥的报错指路（提示写进 form.fields）", () => {
		expect(() => defineApi({
			apiPrefix: "/o",
			route: "/up",
			method: "POST",
			body: z.object({ a: z.string() }),
			form: { files: [{ name: "f" }] },
		})).toThrowError(/form 与 body 互斥/);
		expect(() => defineApi({ apiPrefix: "/o", route: "/up", method: "POST", form: { files: [{ name: "f" }, { name: "f" }] } }))
			.toThrowError(/multiple: true/);
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
