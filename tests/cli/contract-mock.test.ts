import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { exampleFromSchema, loadContractMocks, matchContractRoute, resolveMock } from "../../packages/cli/src/contract/mock";
import { z } from "../../packages/runtime/contract";

/**
 * AC-D14 纯前端契约 mock：routes.json/schema 示例值驱动；
 * 段级 matcher 特异性：字面段 > 参数段 > catch-all；手写 mock 精确匹配优先。
 */

const tmpDirs: string[] = [];

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("exampleFromSchema（语义启发示例值）", () => {
	it("string format → faker 对应器；enum 首值；number 取 min", () => {
		const value = exampleFromSchema(z.object({
			email: z.string().email(),
			site: z.string().url(),
			at: z.string().datetime(),
			status: z.enum(["open", "closed"]),
			amount: z.number().min(10),
			name: z.string(),
		}), { seed: 42 }) as Record<string, unknown>;
		expect(String(value.email)).toMatch(/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/);
		expect(String(value.site)).toMatch(/^https?:\/\//);
		expect(String(value.at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(value.status).toBe("open");
		// 评审 F4：示例值必须满足自家约束（≥min），不再是恰取 min
		expect(value.amount as number).toBeGreaterThanOrEqual(10);
		expect(typeof value.name).toBe("string");
	});

	it("评审 F4：max/min_length 约束被遵守（mock 不得自违例）", () => {
		const value = exampleFromSchema(z.object({
			small: z.number().max(5),
			ranged: z.number().min(10).max(20),
			long: z.string().min(10),
		}), { seed: 7 }) as Record<string, number | string>;
		expect(value.small).toBeLessThanOrEqual(5);
		expect(value.ranged).toBeGreaterThanOrEqual(10);
		expect(value.ranged).toBeLessThanOrEqual(20);
		expect((value.long as string).length).toBeGreaterThanOrEqual(10);
	});

	it("评审 F1：mock 示例值能过生成 schema 的 safeParse（date 即 ISO 串，端到端对齐）", async () => {
		const { emitSchemaSource } = await import("../../packages/cli/src/contract/emit-schema");
		const source = emitSchemaSource(z.object({ day: z.date(), at: z.string().datetime() }));
		expect(source).toContain("z.iso.datetime()");
		// eslint-disable-next-line no-new-func -- 测试专用：还原 codegen 产物做端到端断言，非生产路径
		const schema = new Function("z", `return (${source})`)(z) as z.ZodType;
		const value = exampleFromSchema(z.object({ day: z.date(), at: z.string().datetime() }), { seed: 7 });
		expect(schema.safeParse(value).success).toBe(true);
	});

	it("嵌套 array/optional/nullable/union/date", () => {
		const value = exampleFromSchema(z.object({
			tags: z.array(z.number()),
			note: z.string().optional(),
			memo: z.string().nullable(),
			id: z.union([z.number(), z.string()]),
			day: z.date(),
		}), { seed: 42 }) as Record<string, unknown>;
		expect(Array.isArray(value.tags)).toBe(true);
		expect(typeof (value.tags as unknown[])[0]).toBe("number");
		expect(value.memo).toBeNull();
		expect(typeof value.id).toBe("number"); // union 取首选项
		expect(typeof value.day).toBe("string"); // date → ISO 串（线上传输形态）
	});
});

describe("matchContractRoute（段级特异性）", () => {
	const routes = [
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
	const contract = [{ method: "GET", pattern: "/order/item/{id}", data: z.object({ id: z.number() }) }];
	const handwritten = [{
		method: "get",
		url: "/order/item/1",
		response: () => ({ code: 0, msg: "ok", data: { id: 1, source: "手写" } }),
	}];

	it("手写精确命中 → 用手写（契约不生效）", () => {
		const respond = resolveMock(handwritten, contract, "GET", "/order/item/1");
		expect(respond?.()).toMatchObject({ data: { source: "手写" } });
	});

	it("手写未命中 → 契约 pattern 兜底，返回 oj 信封示例值", () => {
		const respond = resolveMock(handwritten, contract, "GET", "/order/item/99");
		expect(respond?.()).toMatchObject({ code: 0, msg: "ok", data: { id: expect.any(Number) } });
	});

	it("两头都未命中 → undefined", () => {
		expect(resolveMock(handwritten, contract, "GET", "/none")).toBeUndefined();
	});
});

describe("loadContractMocks（dev 启动装载）", () => {
	it("从契约求值出 mock 路由表（跳过 raw 端点）", async () => {
		const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-mock-test-"));
		tmpDirs.push(dir);
		mkdirSync(join(dir, "web/src/demo/client"), { recursive: true });
		writeFileSync(join(dir, "web/src/demo/client/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";
export const getDashboard = defineApi({
	apiPrefix: "/demo",
	route: "/dashboard",
	data: z.object({ visitors: z.number() }),
});
export const download = defineApi({ apiPrefix: "/demo", route: "/file/{*path}", response: "raw" });
`);
		const routes = await loadContractMocks(dir);
		expect(routes).toEqual([{ method: "GET", pattern: "/demo/dashboard", data: expect.anything() }]);
	});
});
