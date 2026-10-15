import type { ContractMockRoute } from "../../packages/cli/src/contract/mock";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { exampleFromJsonSchema, loadContractMocks, matchContractRoute, resolveMock } from "../../packages/cli/src/contract/mock";
import { writeOpenapiJson } from "./_fixtures";

/**
 * AC-D14 纯前端契约 mock：openapi.json（oj v0.1.71 产物）驱动示例值响应。
 * 段级 matcher 特异性：字面段 > 参数段 > catch-all；手写 mock 精确匹配优先。
 *
 * 示例值由 jsonSchemaToSample 确定性生成（零依赖、不引入 faker）。
 */

const tmpDirs: string[] = [];

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("exampleFromJsonSchema（确定性示例值）", () => {
	it("string → 默认「示例」；enum 首值；number 取 min；object/array 递归", () => {
		const value = exampleFromJsonSchema({
			type: "object",
			properties: {
				email: { type: "string" },
				site: { type: "string" },
				status: { type: "string", enum: ["open", "closed"] },
				amount: { type: "number", minimum: 10 },
				name: { type: "string" },
			},
			required: ["email", "site", "status", "amount", "name"],
		}) as Record<string, unknown>;
		expect(value.email).toBe("示例");
		expect(value.site).toBe("示例");
		expect(value.status).toBe("open");
		// 评审 F4：示例值必须满足自家约束（≥min）
		expect(value.amount as number).toBeGreaterThanOrEqual(10);
		expect(typeof value.name).toBe("string");
	});

	it("评审 F4：max/min_length 约束被遵守（mock 不得自违例）", () => {
		const value = exampleFromJsonSchema({
			type: "object",
			properties: {
				small: { type: "number", maximum: 5 },
				ranged: { type: "number", minimum: 10, maximum: 20 },
				long: { type: "string", minLength: 10 },
			},
			required: ["small", "ranged", "long"],
		}) as Record<string, number | string>;
		expect(value.small).toBeLessThanOrEqual(5);
		expect(value.ranged).toBeGreaterThanOrEqual(10);
		expect(value.ranged).toBeLessThanOrEqual(20);
		expect((value.long as string).length).toBeGreaterThanOrEqual(10);
	});

	it("评审 F1：示例值结构对齐 schema（嵌套 array / 可选 / nullable / 非单实类型 union）", () => {
		const value = exampleFromJsonSchema({
			type: "object",
			properties: {
				tags: { type: "array", items: { type: "number" } },
				note: { type: "string" },
				memo: { type: ["string", "null"] },
				id: { type: ["number", "string"] },
			},
			required: ["tags", "note", "memo", "id"],
		}) as Record<string, unknown>;
		expect(Array.isArray(value.tags)).toBe(true);
		expect(typeof (value.tags as unknown[])[0]).toBe("number");
		expect(typeof value.note).toBe("string");
		expect(value.memo).toBe("示例"); // nullable → 取非 null 实类型 string
		expect(value.id).toBeNull(); // 非单实类型 union：无可取样本 → null
	});
});

describe("matchContractRoute（段级特异性）", () => {
	const routes: ContractMockRoute[] = [
		{ method: "GET", pattern: "/order/item/{id}", data: 1 },
		{ method: "GET", pattern: "/order/item/hot", data: 2 },
		{ method: "GET", pattern: "/order/file/{*path}", data: 3 },
		{ method: "POST", pattern: "/order/item/{id}", data: 4 },
	];

	it.each([
		["GET", "/order/item/hot", 2, "字面段优先于参数段"],
		["GET", "/order/item/42", 1, "参数段兜底"],
		["GET", "/order/file/a/b/c.png", 3, "catch-all 匹配多段"],
		["POST", "/order/item/42", 4, "method 参与匹配"],
	] as const)("%s %s → data=%s（%s）", (method, path, expected, _label) => {
		expect(matchContractRoute(routes, method, path)?.data).toBe(expected);
	});

	it.each([
		["GET", "/order/item", "段数不足不匹配"],
		["GET", "/order/file", "catch-all 至少一段"],
		["DELETE", "/order/item/42", "method 不符"],
		["GET", "/other/item/42", "前缀字面段不符"],
	] as const)("%s %s → undefined（%s）", (method, path, _label) => {
		expect(matchContractRoute(routes, method, path)).toBeUndefined();
	});
});

describe("resolveMock（手写优先，契约兜底）", () => {
	const contract: ContractMockRoute[] = [{ method: "GET", pattern: "/order/item/{id}", data: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } }];
	const handwritten = [{
		method: "get",
		url: "/order/item/1",
		response: () => ({ code: 0, msg: "ok", data: { id: 1, source: "手写" } }),
	}];

	it("手写精确命中 → 用手写（契约不生效）", () => {
		const respond = resolveMock(handwritten as never, contract, "GET", "/order/item/1");
		expect(respond?.()).toMatchObject({ data: { source: "手写" } });
	});

	it("手写未命中 → 契约 pattern 兜底，返回 oj 信封示例值（满足 data schema）", () => {
		const respond = resolveMock(handwritten as never, contract, "GET", "/order/item/99");
		const env = respond?.() as { code: number, msg: string, data: { id: number } };
		expect(env.code).toBe(0);
		expect(env.data.id).toBeGreaterThanOrEqual(1); // number min 缺省 → 1
	});

	it("两头都未命中 → undefined", () => {
		expect(resolveMock(handwritten as never, contract, "GET", "/none")).toBeUndefined();
	});
});

describe("loadContractMocks（dev 启动装载）", () => {
	it("从 openapi.json 装载 mock 路由表（data 为 JSON Schema）", async () => {
		const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-mock-test-"));
		tmpDirs.push(dir);
		writeOpenapiJson(dir, [
			{ module: "demo", route: "/dashboard", method: "GET", data: { type: "object", properties: { visitors: { type: "number" } }, required: ["visitors"] } },
		]);
		const routes = await loadContractMocks(dir);
		expect(routes).toEqual([{ method: "GET", pattern: "/demo/dashboard", data: expect.anything() }]);
	});
});
