// BDD：脚手架 package.json scripts 与模板的双写守卫（T3，发布工程师评审建议）。
// 生成器（init.ts generatePackageJson）与模板（templates/package.json）各写一份 scripts，
// 人肉同步必漂移（实证：typecheck:api 曾漏发生成器）——钉成测试：生成 scripts 的每个键
// 都必须存在于模板 scripts（值一致），新增 script 先改模板再改生成器。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generatePackageJson } from "../init";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("脚手架 package.json scripts 双写守卫（T3）", () => {
	it("生成 scripts 的每个键都存在于模板且值一致", () => {
		const template = JSON.parse(readFileSync(join(cliRoot, "templates/package.json"), "utf-8"));
		const generated = generatePackageJson(cliRoot, "guard-check");
		for (const [key, value] of Object.entries(generated.scripts)) {
			expect(template.scripts[key], `生成器有而模板无的 script：${key}（先改 templates/package.json）`)
				.toBe(value);
		}
	});

	it("多方案 scripts 齐备：new / bundle / typecheck:api", () => {
		const generated = generatePackageJson(cliRoot, "guard-check");
		expect(generated.scripts.new).toBe("ojm new");
		expect(generated.scripts.bundle).toBe("ojm build --bundle");
		expect(generated.scripts["typecheck:api"]).toBe("tsc --noEmit -p src/tsconfig.json");
	});
});
