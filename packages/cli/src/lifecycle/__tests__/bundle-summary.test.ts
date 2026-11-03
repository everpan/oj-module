// BDD：`ojm build` 末尾用户方案摘要（计划 docs/plans/20261103-0925-ojm-build-solution-summary.md）。
// 摘要只报告不裁决：判定口径与 --bundle 打包对象同源（模块级契约 ∪ 根契约，减内置名单）；
// log 注入断言，夹具只摆契约/名单/构建结果三样，不需要真实工程结构。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summarizeBuiltSolutions } from "../../bundle";

let project: string;
let lines: string[];

beforeEach(() => {
	project = mkdtempSync(join(tmpdir(), "ojm-build-summary-"));
	lines = [];
});

afterEach(() => {
	rmSync(project, { recursive: true, force: true });
});

/** 模块级契约：src/<name>/solution.yaml（+ web/entry.ts 保持真实模块目录形态） */
function moduleContract(name: string): void {
	const dir = join(project, "src", name);
	mkdirSync(join(dir, "web"), { recursive: true });
	writeFileSync(join(dir, "web", "entry.ts"), "export default {};\n");
	writeFileSync(join(dir, "solution.yaml"), `name: ${name}\nversion: 1.0.0\nsummary: ${name}\n`);
}

function builtinList(names: string[]): void {
	mkdirSync(join(project, "src"), { recursive: true });
	writeFileSync(join(project, "src", ".ojm-builtin.json"), JSON.stringify({ modules: names }));
}

function summaryOf(built: { name: string, version: string }[]): string[] {
	summarizeBuiltSolutions(project, built, l => lines.push(l));
	return lines;
}

describe("summarizeBuiltSolutions", () => {
	it("场景：全部构建成功 → 一行列出可打包方案 + 一行列出内置模块", () => {
		moduleContract("crm");
		moduleContract("erp");
		builtinList(["home", "login"]);
		const out = summaryOf([
			{ name: "crm", version: "1.0.0" },
			{ name: "erp", version: "0.2.0" },
			{ name: "home", version: "9.9.9" },
			{ name: "login", version: "9.9.9" },
		]);
		expect(out.some(l => l.includes("用户方案 2 份已构建") && l.includes("crm@1.0.0") && l.includes("erp@0.2.0"))).toBe(true);
		expect(out.some(l => l.includes("框架自带模块 2 份已构建"))).toBe(true);
	});

	it("场景：方案没进构建 → 点名未构建方案与排查方向", () => {
		moduleContract("crm");
		moduleContract("erp");
		builtinList(["home"]);
		const out = summaryOf([
			{ name: "crm", version: "1.0.0" },
			{ name: "home", version: "9.9.9" },
		]);
		expect(out.some(l => l.includes("crm@1.0.0"))).toBe(true);
		expect(out.filter(l => l.includes("erp")).join("\n")).toContain("未构建");
	});

	it("场景：零用户方案 → 提示 ojm new", () => {
		moduleContract("home");
		builtinList(["home"]);
		const out = summaryOf([{ name: "home", version: "9.9.9" }]);
		expect(out.some(l => l.includes("用户方案 0 份") && l.includes("ojm new"))).toBe(true);
	});

	it("场景：非内置模块缺契约 → 警告不会被打包", () => {
		builtinList(["home"]);
		const out = summaryOf([
			{ name: "foo", version: "0.1.0" },
			{ name: "home", version: "9.9.9" },
		]);
		expect(out.some(l => l.includes("缺方案契约") && l.includes("foo@0.1.0"))).toBe(true);
	});

	it("场景：旧单方案工程（根契约、无 src/ 树）→ 列出根契约方案，不误报缺契约", () => {
		writeFileSync(join(project, "manifest.yaml"), "name: demo-solution\nversion: 0.1.0\nsummary: 旧写法\n");
		const out = summaryOf([{ name: "demo-solution", version: "0.1.0" }]);
		expect(out.some(l => l.includes("用户方案 1 份已构建") && l.includes("demo-solution@0.1.0"))).toBe(true);
		expect(out.every(l => !l.includes("缺方案契约"))).toBe(true);
	});

	it("场景：新脚手架形态（内置集中 src/app，无用户方案）→ 0 份提示，src/app 不被误判", () => {
		// 脚手架 init 后：src/ 下只有 app（平台聚合树，无契约）与 oj-market，均在内置名单
		mkdirSync(join(project, "src", "app", "web"), { recursive: true });
		writeFileSync(join(project, "src", "app", "web", "entry.ts"), "export default {};\n");
		mkdirSync(join(project, "src", "oj-market", "web"), { recursive: true });
		writeFileSync(join(project, "src", "oj-market", "web", "entry.ts"), "export default {};\n");
		builtinList(["app", "oj-market", "_platform", "auth", "notification", "personal-center", "system", "web"]);
		const out = summaryOf([
			{ name: "app", version: "0.2.56" },
			{ name: "oj-market", version: "0.2.56" },
		]);
		expect(out.some(l => l.includes("用户方案 0 份") && l.includes("ojm new"))).toBe(true);
		expect(out.some(l => l.includes("框架自带模块 2 份已构建"))).toBe(true);
		expect(out.every(l => !l.includes("缺方案契约"))).toBe(true);
	});
});
