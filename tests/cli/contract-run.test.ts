import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runApi } from "../../packages/cli/src/contract/run";

/**
 * AC-D7：`ram api` 编排（discover → evaluate → IR → 发射 → 幂等写盘）。
 * 端到端夹具：tmp 工程（node_modules/.cache 下，workspace 依赖可解析）
 * 各含一份 uni-dev 契约（api/src/order/contract.ts）与纯前端契约
 * （modules/src/demo/api/contract.ts），断言四产物路径 + 关键内容 + 二次运行零写入。
 */

const tmpDirs: string[] = [];

function makeProject(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ram-run-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, "api/src/order"), { recursive: true });
	writeFileSync(join(dir, "api/src/order/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";

export const getOrderList = defineApi({
	apiPrefix: "/order",
	route: "/list",
	query: z.object({ page: z.number().int().min(1) }),
	data: z.object({ list: z.array(z.object({ id: z.number(), order_no: z.string() })), total: z.number() }),
	description: "订单列表",
});

export const getOrderDetail = defineApi({
	apiPrefix: "/order",
	route: "/item/{id}",
	params: z.object({ id: z.number() }),
	data: z.object({ id: z.number(), order_no: z.string() }),
});
`);
	mkdirSync(join(dir, "modules/src/demo/api"), { recursive: true });
	writeFileSync(join(dir, "modules/src/demo/api/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";

export const getDashboard = defineApi({
	apiPrefix: "/demo",
	route: "/dashboard",
	data: z.object({ visitors: z.number(), trend: z.array(z.number()) }),
});
`);
	return dir;
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("runApi（AC-D7 编排 + 幂等写盘）", () => {
	it("uni-dev 契约：client 落前端模块目录，routes/openapi 落契约旁，stub 落 oj 树", async () => {
		const cwd = makeProject();
		const result = await runApi({ cwd });

		// client 双产物 → modules/src/order/api/（模块名 = apiPrefix 去首斜杠，AC-D9）
		const client = readFileSync(join(cwd, "modules/src/order/api/client.ts"), "utf8");
		expect(client).toContain("export function bindRequest");
		expect(client).toContain("export async function getOrderList");
		expect(existsSync(join(cwd, "modules/src/order/api/client.schemas.ts"))).toBe(true);

		// routes.json / openapi.yaml → 契约同目录
		const routes = JSON.parse(readFileSync(join(cwd, "api/src/order/routes.json"), "utf8")) as { method: string, pattern: string }[];
		expect(routes).toContainEqual({ method: "GET", pattern: "order/item/{id}" });
		expect(readFileSync(join(cwd, "api/src/order/openapi.yaml"), "utf8")).toContain("/order/item/{id}");

		// stub → oj 目录镜像树（带指纹，json.ok 预填示例值）
		const stub = readFileSync(join(cwd, "api/src/order/list/api.ts"), "utf8");
		expect(stub).toMatch(/^\/\/ ram-api:stub getOrderList sha256:[0-9a-f]{64}/);
		expect(stub).toContain("json.ok({");
		expect(existsSync(join(cwd, "api/src/order/item/api.ts"))).toBe(true);

		expect(result.contracts).toBe(2);
		expect(result.written.length).toBeGreaterThan(0);
	});

	it("纯前端契约：四产物全部落契约同目录（无 stub）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		const dir = join(cwd, "modules/src/demo/api");
		expect(readFileSync(join(dir, "client.ts"), "utf8")).toContain("export async function getDashboard");
		expect(existsSync(join(dir, "client.schemas.ts"))).toBe(true);
		expect(JSON.parse(readFileSync(join(dir, "routes.json"), "utf8"))).toEqual([{ method: "GET", pattern: "demo/dashboard" }]);
		expect(readFileSync(join(dir, "openapi.yaml"), "utf8")).toContain("/demo/dashboard");
		// 纯前端形态不生成 oj stub
		expect(existsSync(join(cwd, "api/src/demo"))).toBe(false);
	});

	it("二次运行：内容无变化零写入（幂等）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		const second = await runApi({ cwd });
		expect(second.written).toEqual([]);
		expect(second.stubs.created + second.stubs.updated).toBe(0);
	});

	it("uni-dev 契约 apiPrefix 与目录名不符 → 人话报错（AC-D9 字面相等约束）", async () => {
		const cwd = makeProject();
		writeFileSync(join(cwd, "api/src/order/contract.ts"), `
import { defineApi } from "@oj-module/runtime/contract";
export const ep = defineApi({ apiPrefix: "/billing", route: "/x" });
`);
		await expect(runApi({ cwd })).rejects.toThrowError(/apiPrefix.*billing.*order|字面相等/);
	});
});
