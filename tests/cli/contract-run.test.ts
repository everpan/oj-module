import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { discoverContracts, runApi } from "../../packages/cli/src/contract/run";

/**
 * AC-D7：`ojm api` 编排（discover → evaluate → IR → 发射 → 幂等写盘）。
 * 端到端夹具：tmp 工程（node_modules/.cache 下，workspace 依赖可解析）
 * 各含一份 uni-dev 契约（api/src/order/contract.ts）与纯前端契约
 * （web/src/demo/client/contract.ts），断言四产物路径 + 关键内容 + 二次运行零写入。
 */

const tmpDirs: string[] = [];

function makeProject(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-run-test-"));
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
	mkdirSync(join(dir, "web/src/demo/client"), { recursive: true });
	writeFileSync(join(dir, "web/src/demo/client/contract.ts"), `
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

		// client 双产物 → web/src/order/__client/（模块名 = apiPrefix 去首斜杠，AC-D9）
		const client = readFileSync(join(cwd, "web/src/order/__client/api.ts"), "utf8");
		expect(client).toContain("export function bindRequest");
		expect(client).toContain("export async function getOrderList");
		expect(existsSync(join(cwd, "web/src/order/__client/api.schemas.ts"))).toBe(true);

		// routes.json / openapi.yaml → 契约同目录
		const routes = JSON.parse(readFileSync(join(cwd, "api/src/order/routes.json"), "utf8")) as { method: string, pattern: string }[];
		expect(routes).toContainEqual({ method: "GET", pattern: "order/item/{id}" });
		expect(readFileSync(join(cwd, "api/src/order/openapi.yaml"), "utf8")).toContain("/order/item/{id}");

		// stub → oj 目录镜像树（带指纹，json.ok 预填示例值）
		const stub = readFileSync(join(cwd, "api/src/order/list/api.ts"), "utf8");
		expect(stub).toMatch(/^\/\/ ojm-api:stub getOrderList sha256:[0-9a-f]{64}/);
		expect(stub).toContain("json.ok({");
		expect(existsSync(join(cwd, "api/src/order/item/api.ts"))).toBe(true);

		expect(result.contracts).toBe(2);
		expect(result.written.length).toBeGreaterThan(0);
	});

	it("纯前端契约：四产物全部落契约同目录（无 stub）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		const dir = join(cwd, "web/src/demo/client");
		expect(readFileSync(join(dir, "api.ts"), "utf8")).toContain("export async function getDashboard");
		expect(existsSync(join(dir, "api.schemas.ts"))).toBe(true);
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

describe("client → __client 改名（发现双形态兼容 + 发射目标）", () => {
	it("发现 __client 优先，client 兼容并告警", () => {
		const cwd = makeProject(); // 自带旧形态 web/src/demo/client/contract.ts
		mkdirSync(join(cwd, "web/src/home/__client"), { recursive: true });
		writeFileSync(join(cwd, "web/src/home/__client/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";
export const getHome = defineApi({ apiPrefix: "/home", route: "/dashboard", data: z.object({}) });
`);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const found = discoverContracts(cwd);
			// 新形态：命中且无 warn
			expect(found).toContainEqual({ path: join(cwd, "web/src/home/__client/contract.ts"), module: "home", kind: "frontend" });
			// 旧形态：命中且 console.warn 迁移提示
			expect(found).toContainEqual({ path: join(cwd, "web/src/demo/client/contract.ts"), module: "demo", kind: "frontend" });
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0][0])).toContain("__client");
		}
		finally {
			warn.mockRestore();
		}
	});

	it("__client 与 client 同在 → 只命中 __client（不重复、不告警）", () => {
		const cwd = makeProject();
		mkdirSync(join(cwd, "web/src/demo/__client"), { recursive: true });
		writeFileSync(join(cwd, "web/src/demo/__client/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";
export const getDashboard2 = defineApi({ apiPrefix: "/demo", route: "/dashboard", data: z.object({}) });
`);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const found = discoverContracts(cwd).filter(f => f.module === "demo");
			expect(found).toHaveLength(1);
			expect(found[0].path).toBe(join(cwd, "web/src/demo/__client/contract.ts"));
			expect(warn).not.toHaveBeenCalled();
		}
		finally {
			warn.mockRestore();
		}
	});

	it("artifactPaths：uni-dev 的 client 产物落 web/src/<m>/__client/", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		expect(existsSync(join(cwd, "web/src/order/__client/api.ts"))).toBe(true);
		expect(existsSync(join(cwd, "web/src/order/__client/api.schemas.ts"))).toBe(true);
		expect(existsSync(join(cwd, "web/src/order/client"))).toBe(false);
	});
});
