import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkApi } from "../../packages/cli/src/contract/check";
import { runApi } from "../../packages/cli/src/contract/run";

/**
 * AC-D10：`ram api --check` 三重校验——
 * ①生成物同步（内存重生成 vs 磁盘逐字节 diff）
 * ②route 双向对账（AST 扫 oj api.ts：default 导出方法名 + 语句起始 .route 赋值）
 * ③routes.js diff（release 路由表 vs routes.json）
 */

const tmpDirs: string[] = [];

function makeProject(withContract = true): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ram-check-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, "api/src/order"), { recursive: true });
	if (withContract) {
		writeFileSync(join(dir, "api/src/order/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";

export const getOrderList = defineApi({
	apiPrefix: "/order",
	route: "/list",
	data: z.object({ list: z.array(z.object({ id: z.number() })), total: z.number() }),
});

export const getOrderDetail = defineApi({
	apiPrefix: "/order",
	route: "/item/{id}",
	params: z.object({ id: z.number() }),
	data: z.object({ id: z.number() }),
});
`);
	}
	return dir;
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("checkApi（AC-D10 三重校验）", () => {
	it("全通过：ram api 生成后 check 零违规", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual([]);
	});

	it("①生成物过期（磁盘被改）→ error artifact-stale", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		writeFileSync(join(cwd, "modules/src/order/api/client.ts"), "// 人改了生成物\n");
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "artifact-stale" }),
		]));
		expect(violations.find(v => v.kind === "artifact-stale")?.message).toContain("ram api");
	});

	it("②契约端点无 handler → warn 未实现；handler 未登记契约 → error", async () => {
		const cwd = makeProject();
		// 只手写 item/api.ts（覆盖 getOrderDetail），list 端点无 handler → warn
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
function detail(): void {
	json.ok({ id: 1 });
}
detail.route = "{id}";
export default { get: detail };
`);
		// 手写一个契约外的 handler → error 未登记
		mkdirSync(join(cwd, "api/src/order/legacy"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/legacy/api.ts"), `
export default {
	post(): void {
		json.ok();
	},
};
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "warn", kind: "route-not-implemented" }),
			expect.objectContaining({ level: "error", kind: "route-unregistered" }),
		]));
		expect(violations.find(v => v.kind === "route-not-implemented")?.message).toContain("order/list");
		expect(violations.find(v => v.kind === "route-unregistered")?.message).toContain("legacy");
	});

	it("②参数段不一致（handler {name} vs 契约 {id}）→ error route-params-mismatch", async () => {
		const cwd = makeProject();
		mkdirSync(join(cwd, "api/src/order/item"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/item/api.ts"), `
function get(): void {
	json.ok({ id: 1 });
}
get.route = "{name}";
export default { get };
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "route-params-mismatch" }),
		]));
		expect(violations.find(v => v.kind === "route-params-mismatch")?.message).toMatch(/\{name\}.*\{id\}|\{id\}.*\{name\}/);
	});

	it("③routes.js 与 routes.json 不一致 → error routes-js-drift；无 dist → 提示先 oj build", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		// 无 dist：hints 提示，非违规
		const noDist = await checkApi({ cwd });
		expect(noDist.violations).toEqual([]);
		expect(noDist.hints.join("\n")).toContain("oj build");
		// dist routes.js 缺 getOrderDetail → drift
		mkdirSync(join(cwd, "api/dist/order-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "api/dist/order-0.1.0/routes.js"), `// 由 oj build 生成；勿手改。
export default [
  { method: "get", pattern: "order/list", file: "list/api.js" },
];
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "routes-js-drift" }),
		]));
	});
});
