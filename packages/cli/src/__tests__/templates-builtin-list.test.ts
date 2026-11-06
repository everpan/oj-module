/**
 * 漂移守卫：templates 自带模块名单（src/.ojm-builtin.json）必须与
 * init.include.yaml 白名单的派生结果一致（单一真源是白名单，builtin.ts）。
 *
 * templates 是脚手架源工程自身：ojm init 只给目标工程生成名单文件，
 * 源工程这份是手工补录的（2026-11-06），缺守卫就会与白名单漂移——
 * 白名单新增模块后构建会再次冒出「缺方案契约」误报。
 *
 * Phase B 例外（2026-11-07 裁决）：oj-market 在**模板工程**名单里被刻意移除——
 * 市场 UI 模块化后它是第一方方案包（`ojm build --bundle oj-market`，契约
 * src/oj-market/solution.yaml），名单在场会被内置排除拒打包。用户工程名单由
 * init 按白名单派生仍含 oj-market（api 编排面随脚手架内置）——两侧分歧即本测试
 * 钉住的语义，勿「顺手对齐」。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_LIST_FILE, deriveBuiltinModules, readBuiltinModules } from "../builtin";
import { collectDefaultModuleDrift, readInitInclude } from "../scaffold-guard";

const templatesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");
/** Phase B：第一方打包放行的刻意分歧（见文件头） */
const FIRST_PARTY_PACKAGE_EXCEPTIONS = ["oj-market"];

describe("templates 自带模块名单", () => {
	it("src/.ojm-builtin.json 存在且 = 白名单派生 − 第一方打包例外", () => {
		const derived = [...deriveBuiltinModules(readInitInclude(templatesRoot))]
			.filter(m => !FIRST_PARTY_PACKAGE_EXCEPTIONS.includes(m));
		const actual = readBuiltinModules(templatesRoot);
		expect([...actual].sort()).toEqual([...derived].sort());
		expect(actual.size).toBeGreaterThan(0);
	});

	it("覆盖误报当事模块 app；oj-market 被第一方打包例外移除（用户工程名单仍含）", () => {
		const actual = readBuiltinModules(templatesRoot);
		expect(actual.has("app")).toBe(true);
		expect(actual.has("oj-market")).toBe(false);
	});

	it("名单文件名与 builtin.ts 约定一致", () => {
		expect(BUILTIN_LIST_FILE).toBe(".ojm-builtin.json");
	});

	it("工程即 templates 自身时脚手架门禁放行（基线 == 自身，demo-only 不算漂移）", () => {
		expect(collectDefaultModuleDrift(templatesRoot)).toBeNull();
	});
});
