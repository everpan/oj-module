import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runApi } from "../../packages/cli/src/contract/run";
import { writeOpenapiJson } from "./_fixtures";

/**
 * AC-D7：`ojm api` 编排（发现 openapi.json → IR → 逐模块发射 __client → 写盘；
 * 并为未实现的 handler 生成 stub）。
 *
 * 翻译层退役后，单一事实源即 `ojm openapi ...` 产出的 `openapi.json`（OpenAPI 3.1），
 * 不再消费旧 `contract.ts`。夹具：tmp 工程（node_modules/.cache 下）含一份 openapi.json，
 * 覆盖 uni-dev 模块（order，含后端 handler 树）与纯前端模块（demo）。
 */

const tmpDirs: string[] = [];

function makeProject(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-run-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, "api/src/order"), { recursive: true });
	writeOpenapiJson(dir, [
		{ module: "order", name: "getOrderList", route: "/list", method: "GET", data: { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } }, total: { type: "number" } }, required: ["list", "total"] } },
		{ module: "order", name: "getOrderDetail", route: "/item/{id}", method: "GET", params: { id: { type: "number" } }, data: { type: "object", properties: { id: { type: "number" }, order_no: { type: "string" } }, required: ["id", "order_no"] } },
		{ module: "demo", name: "getDashboard", route: "/dashboard", method: "GET", data: { type: "object", properties: { visitors: { type: "number" }, trend: { type: "array", items: { type: "number" } } }, required: ["visitors", "trend"] } },
	]);
	return dir;
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("runApi（AC-D7 编排 + 幂等写盘）", () => {
	it("openapi.json：client 落前端模块目录，stub 落 oj 树（带指纹，json.ok 预填示例值）", async () => {
		const cwd = makeProject();
		const result = await runApi({ cwd });

		// client 双产物 → web/src/order/__client/（模块名 = apiPrefix 去首斜杠，AC-D9）
		const client = readFileSync(join(cwd, "web/src/order/__client/api.ts"), "utf8");
		expect(client).toContain("export function bindRequest");
		expect(client).toContain("export async function getOrderList");
		expect(client).toContain("export async function getOrderDetail");
		expect(existsSync(join(cwd, "web/src/order/__client/api.schemas.ts"))).toBe(true);

		// stub → oj 目录镜像树（带指纹，json.ok 收口示例值）
		const stubList = readFileSync(join(cwd, "api/src/order/list/api.ts"), "utf8");
		expect(stubList).toMatch(/^\/\/ ojm-api:stub .+ sha256:[0-9a-f]{64}/);
		expect(stubList).toContain("json.ok({");
		expect(existsSync(join(cwd, "api/src/order/item/api.ts"))).toBe(true);

		expect(result.contracts).toBe(2);
		expect(result.written.length).toBeGreaterThan(0);
	});

	it("纯前端模块（无后端 handler）：client + stub 同样生成", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		// 翻译层退役后，openapi.json 是全部模块的单一事实源——含无后端的纯前端模块
		const demoClient = readFileSync(join(cwd, "web/src/demo/__client/api.ts"), "utf8");
		expect(demoClient).toContain("export async function getDashboard");
		expect(existsSync(join(cwd, "web/src/demo/__client/api.schemas.ts"))).toBe(true);
		// 模块在 openapi.json 声明即出 stub（dev 实现后填充；人不实现也不阻断构建）
		expect(existsSync(join(cwd, "api/src/demo/dashboard/api.ts"))).toBe(true);
	});

	it("二次运行：内容无变化零写入（幂等）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		const second = await runApi({ cwd });
		expect(second.written).toEqual([]);
		expect(second.skipped.length).toBeGreaterThan(0);
	});

	it("无 openapi.json → 人话报错指路 `oj openapi`", async () => {
		const cwd = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-run-noopenapi-"));
		tmpDirs.push(cwd);
		mkdirSync(join(cwd, "api/src"), { recursive: true });
		await expect(runApi({ cwd })).rejects.toThrowError(/openapi\.json/);
	});
});
