/**
 * 漂移守卫：templates 自带模块名单（src/.ojm-builtin.json）必须与
 * init.include.yaml 白名单的派生结果一致（单一真源是白名单，builtin.ts）。
 *
 * templates 是脚手架源工程自身：ojm init 只给目标工程生成名单文件，
 * 源工程这份是手工补录的（2026-11-06），缺守卫就会与白名单漂移——
 * 白名单新增模块后构建会再次冒出「缺方案契约」误报。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN_LIST_FILE, deriveBuiltinModules, readBuiltinModules } from "../builtin";
import { collectDefaultModuleDrift, readInitInclude } from "../scaffold-guard";

const templatesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates");
describe("templates 自带模块名单", () => {
	it("src/.ojm-builtin.json 存在且与白名单派生结果一致", () => {
		const derived = deriveBuiltinModules(readInitInclude(templatesRoot));
		const actual = readBuiltinModules(templatesRoot);
		expect([...actual].sort()).toEqual([...derived].sort());
		expect(actual.size).toBeGreaterThan(0);
	});

	it("覆盖误报当事模块 app / oj-market", () => {
		const actual = readBuiltinModules(templatesRoot);
		expect(actual.has("app")).toBe(true);
		expect(actual.has("oj-market")).toBe(true);
	});

	it("名单文件名与 builtin.ts 约定一致", () => {
		expect(BUILTIN_LIST_FILE).toBe(".ojm-builtin.json");
	});

	it("工程即 templates 自身时脚手架门禁放行（基线 == 自身，demo-only 不算漂移）", () => {
		expect(collectDefaultModuleDrift(templatesRoot)).toBeNull();
	});
});
