import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { checkApi, loadExemption } from "../../packages/cli/src/contract/check";
import { planStubWrites } from "../../packages/cli/src/contract/emit-stub";
import { buildIr } from "../../packages/cli/src/contract/ir";
import { runApi } from "../../packages/cli/src/contract/run";
import { API_DEF, API_DEF_LEGACY, defineApi, z } from "../../packages/runtime/contract";

/**
 * P3 改名兼容读取三连（设计 §7 R2/R3/R4）：
 * 存量工程升级后，旧名（ram）产物必须仍被正确识别——否则会误判为「人工编辑」
 * 或豁免失效，产生静默错误而非报错。
 */

const tmpDirs: string[] = [];
function makeTmp(): string {
	const dir = mkdtempSync(join(process.cwd(), "node_modules/.cache/ojm-compat-"));
	tmpDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const d of tmpDirs)
		rmSync(d, { recursive: true, force: true });
});

describe("r4：豁免清单双名读取", () => {
	function makeProject(): string {
		const cwd = makeTmp();
		mkdirSync(join(cwd, "api"), { recursive: true });
		return cwd;
	}

	it("只存旧名 .ram-api-exempt.json → 仍被读取", () => {
		const cwd = makeProject();
		writeFileSync(join(cwd, "api/.ram-api-exempt.json"), JSON.stringify({ modules: ["web"], paths: ["/auth/*"] }));
		const exemption = loadExemption({ cwd });
		expect(exemption.modules).toEqual(["web"]);
		expect(exemption.paths).toEqual(["/auth/*"]);
	});

	it("新名存在时优先于旧名", () => {
		const cwd = makeProject();
		writeFileSync(join(cwd, "api/.ram-api-exempt.json"), JSON.stringify({ modules: ["legacy"] }));
		writeFileSync(join(cwd, "api/.ojm-api-exempt.json"), JSON.stringify({ modules: ["next"] }));
		expect(loadExemption({ cwd }).modules).toEqual(["next"]);
	});

	it("两处都缺失 → 空豁免（不抛错）", () => {
		expect(loadExemption({ cwd: makeProject() })).toEqual({ modules: [], paths: [] });
	});
});

describe("r2：stub 指纹头双前缀接受", () => {
	const identityFix = async (code: string) => code;
	const ir = buildIr({
		getOrderList: defineApi({
			apiPrefix: "/order",
			route: "/list",
			data: z.object({ total: z.number() }),
		}),
	});
	const FILE = "api/src/order/list/api.ts";

	it("存量产物（// ram-api:stub）随契约变更 → update（不误判人工编辑）", async () => {
		const first = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		const files = new Map(first.filter(w => w.action !== "skip").map(w => [w.filePath, w.content] as const));
		// 旧前缀 + 同一内容哈希：既有指纹仍匹配，只是头文本是旧名
		files.set(FILE, files.get(FILE)!.replace("// ojm-api:stub", "// ram-api:stub"));

		const second = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: p => files.get(p) });
		const item = second.find(w => w.filePath === FILE);
		expect(item?.action).toBe("update");
		expect(item?.content).toMatch(/^\/\/ ojm-api:stub /);
	});

	it("旧前缀且契约未变 → 仍升级为 update（把旧头刷成新头），标记 prefixUpgrade", async () => {
		const first = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		const files = new Map(first.filter(w => w.action !== "skip").map(w => [w.filePath, w.content] as const));
		files.set(FILE, files.get(FILE)!.replace("// ojm-api:stub", "// ram-api:stub"));

		const second = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: p => files.get(p) });
		const item = second.find(w => w.filePath === FILE);
		expect(item?.action).toBe("update");
		// 纯前缀升级：--check 不当过期误报（见下方 checkApi 用例）
		expect(item?.prefixUpgrade).toBe(true);
	});

	it("旧前缀 + 契约真变更 → update 且非 prefixUpgrade（check 仍报过期）", async () => {
		const first = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		const files = new Map(first.filter(w => w.action !== "skip").map(w => [w.filePath, w.content] as const));
		files.set(FILE, files.get(FILE)!.replace("// ojm-api:stub", "// ram-api:stub"));
		const ir2 = buildIr({
			getOrderList: defineApi({
				apiPrefix: "/order",
				route: "/list",
				data: z.object({ total: z.number(), page: z.number() }),
			}),
		});
		const second = await planStubWrites(ir2, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: p => files.get(p) });
		const item = second.find(w => w.filePath === FILE);
		expect(item?.action).toBe("update");
		expect(item?.prefixUpgrade).toBeFalsy();
		expect(item?.content).toContain("page");
	});

	it("checkApi：存量旧头 stub 不误报过期，重跑后刷为新头", async () => {
		const cwd = makeTmp();
		mkdirSync(join(cwd, "api/src/order"), { recursive: true });
		writeFileSync(join(cwd, "api/src/order/contract.ts"), `
import { defineApi, z } from "@oj-module/runtime/contract";
export const getOrderList = defineApi({
	apiPrefix: "/order",
	route: "/list",
	data: z.object({ total: z.number() }),
});
`);
		await runApi({ cwd });
		const stubPath = join(cwd, "api/src/order/list/api.ts");
		// 模拟存量工程：旧指纹头 + 旧名豁免清单
		writeFileSync(join(cwd, "api/.ram-api-exempt.json"), JSON.stringify({ modules: [] }));
		writeFileSync(stubPath, readFileSync(stubPath, "utf-8").replace("// ojm-api:stub", "// ram-api:stub"));

		const { violations } = await checkApi({ cwd });
		expect(violations.filter(v => v.level === "error")).toEqual([]);

		await runApi({ cwd });
		expect(readFileSync(stubPath, "utf-8")).toMatch(/^\/\/ ojm-api:stub /);
	});

	it("旧前缀 + 内容被人改过 → 仍判人工编辑（skip），兼容不放大权限", async () => {
		const first = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: () => undefined });
		const files = new Map(first.filter(w => w.action !== "skip").map(w => [w.filePath, w.content] as const));
		files.set(FILE, files.get(FILE)!
			.replace("// ojm-api:stub", "// ram-api:stub")
			.replace("json.ok({", "// 人写的逻辑\n\tjson.ok({"));

		const second = await planStubWrites(ir, { apiSrcDir: "api/src", eslintFix: identityFix, readFile: p => files.get(p) });
		const item = second.find(w => w.filePath === FILE);
		expect(item?.action).toBe("skip");
		expect(item?.reason).toMatch(/人工编辑|--check/);
	});
});

describe("r3：端点品牌双符号识别", () => {
	it("defineApi 只打新符号 ojm.api.def，不打旧符号", () => {
		const def = defineApi({ apiPrefix: "/order", route: "/list" });
		expect((def as Record<PropertyKey, unknown>)[API_DEF]).toBe(true);
		expect((def as Record<PropertyKey, unknown>)[API_DEF_LEGACY]).toBeUndefined();
	});

	it("buildIr 能识别只打旧符号 ram.api.def 的存量产物", () => {
		const legacy = { apiPrefix: "/order", route: "/list" };
		Object.defineProperty(legacy, Symbol.for("ram.api.def"), { value: true, enumerable: false });
		const built = buildIr({ legacy: legacy as never });
		expect(built).toHaveLength(1);
		expect(built[0]!.apiPrefix).toBe("/order");
	});

	it("无品牌标记的普通导出仍被忽略", () => {
		expect(buildIr({ plain: { apiPrefix: "/order", route: "/list" } })).toEqual([]);
	});
});

describe("r1：命令名使用 ojm（旧名不再出现在日志前缀）", () => {
	it("usage 文本以 ojm 列命令，并标注 ram 为弃用别名", async () => {
		const { usageText } = await import("../../packages/cli/src/usage");
		const text = usageText();
		expect(text).toMatch(/ojm dev/);
		expect(text).toMatch(/ojm api/);
		expect(text).toMatch(/ram 是 ojm 的弃用别名/);
	});
});
