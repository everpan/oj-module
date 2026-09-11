import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkApi } from "../../packages/cli/src/contract/check";
import { runApi } from "../../packages/cli/src/contract/run";

/**
 * D12 / F19：`ram api --check` 豁免清单（api/.ram-api-exempt.json）。
 * - modules：整模块跳过 route 双向对账。
 * - paths：路径前缀跳过（/* 一层通配）；既作用于 handler 未登记，也作用于 dist 多。
 * 仅降级，绝不引入新错误；非豁免项目行为不变。
 */

const tmpDirs: string[] = [];

function makeProject(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ram-exempt-test-"));
	tmpDirs.push(dir);
	mkdirSync(join(dir, "api/src/order"), { recursive: true });
	// 一个合法契约（让 discoverContracts 不抛；并提供非豁免回归基线）
	writeFileSync(join(dir, "api/src/order/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";

export const getOrderList = defineApi({
	apiPrefix: "/order",
	route: "/list",
	data: z.object({ list: z.array(z.object({ id: z.number() })), total: z.number() }),
});
`);
	return dir;
}

function writeExempt(cwd: string, obj: unknown, name = ".ram-api-exempt.json"): void {
	writeFileSync(join(cwd, "api", name), typeof obj === "string" ? obj : JSON.stringify(obj));
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("checkApi 豁免清单（D12/F19）", () => {
	it("modules 豁免：web handler 无契约不报 route-unregistered（exit 0）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		// 手写一个无契约的 web handler（init 模板同源场景）
		mkdirSync(join(cwd, "api/src/web/user-info"), { recursive: true });
		writeFileSync(join(cwd, "api/src/web/user-info/api.ts"), `
export default {
	get(): void {
		json.ok({});
	},
};
`);
		writeExempt(cwd, { modules: ["web"] });
		const { violations } = await checkApi({ cwd });
		expect(violations.find(v => v.kind === "route-unregistered")).toBeUndefined();
		expect(violations.filter(v => v.level === "error")).toEqual([]);
	});

	it("非豁免回归：无 exempt 时 web handler 仍报 route-unregistered（行为不变）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		mkdirSync(join(cwd, "api/src/web/user-info"), { recursive: true });
		writeFileSync(join(cwd, "api/src/web/user-info/api.ts"), `
export default {
	get(): void {
		json.ok({});
	},
};
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "route-unregistered" }),
		]));
		expect(violations.find(v => v.kind === "route-unregistered")?.message).toContain("web/user-info");
	});

	it("paths 豁免：dist auth/* 不报 dist 多（routes-js-drift）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		writeExempt(cwd, { paths: ["/auth/*"] });
		mkdirSync(join(cwd, "api/dist/order-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "api/dist/order-0.1.0/routes.js"), `// 由 oj build 生成；勿手改。
export default [
  { method: "get", pattern: "order/list", file: "list/api.js" },
  { method: "post", pattern: "auth/login", file: "auth/login/api.js" },
  { method: "post", pattern: "auth/refresh", file: "auth/refresh/api.js" },
];
`);
		const { violations } = await checkApi({ cwd });
		expect(violations.find(v => v.kind === "routes-js-drift")).toBeUndefined();
	});

	it("paths 通配只放宽一层：auth/x/y 仍报 dist 多（不被 auth/* 豁免）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		writeExempt(cwd, { paths: ["/auth/*"] });
		mkdirSync(join(cwd, "api/dist/order-0.1.0"), { recursive: true });
		writeFileSync(join(cwd, "api/dist/order-0.1.0/routes.js"), `// 由 oj build 生成；勿手改。
export default [
  { method: "get", pattern: "auth/x/y", file: "auth/x/y/api.js" },
];
`);
		const { violations } = await checkApi({ cwd });
		expect(violations).toEqual(expect.arrayContaining([
			expect.objectContaining({ level: "error", kind: "routes-js-drift" }),
		]));
		expect(violations.find(v => v.kind === "routes-js-drift")?.message).toContain("auth/x/y");
	});

	it("cLI --exempt <path> 覆盖默认文件：自定义路径生效", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		mkdirSync(join(cwd, "api/src/legacy/dead"), { recursive: true });
		writeFileSync(join(cwd, "api/src/legacy/dead/api.ts"), `
export default {
	post(): void {
		json.ok();
	},
};
`);
		// 默认位置无 exempt 文件 → 应报错；用自定义路径豁免 legacy
		const exemptFile = join(cwd, "my-exempt.json");
		writeFileSync(exemptFile, JSON.stringify({ modules: ["legacy"] }));
		const { violations } = await checkApi({ cwd, exempt: exemptFile });
		expect(violations.find(v => v.kind === "route-unregistered")).toBeUndefined();
		expect(violations.filter(v => v.level === "error")).toEqual([]);
	});

	it("exempt 缺失/损坏 → 空豁免（不报错，行为回退默认）", async () => {
		const cwd = makeProject();
		await runApi({ cwd });
		mkdirSync(join(cwd, "api/src/web/user-info"), { recursive: true });
		writeFileSync(join(cwd, "api/src/web/user-info/api.ts"), `
export default { get(): void { json.ok({}); } };
`);
		// 缺失文件：用 --exempt 指一个不存在的 path → 空豁免，web 仍报 error（回退正确）
		const { violations } = await checkApi({ cwd, exempt: join(cwd, "nope.json") });
		expect(violations.find(v => v.kind === "route-unregistered")?.message).toContain("web/user-info");
		// 损坏 JSON：默认路径写坏文件 → 不抛异常，按空豁免处理（web 仍报 error）
		writeFileSync(join(cwd, "api/.ram-api-exempt.json"), "{ not json");
		await expect(checkApi({ cwd })).resolves.toBeDefined();
		const broken = await checkApi({ cwd });
		expect(broken.violations.find(v => v.kind === "route-unregistered")?.message).toContain("web/user-info");
	});
});
