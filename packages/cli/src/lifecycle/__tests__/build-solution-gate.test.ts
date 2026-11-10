// BDD：普通 `ojm build` 的文件面契约门禁（C2-12a/12c/25 构建期 fail-fast 补口）。
// 背景：C2-12c 表前缀门禁此前只接在 `ojm build --bundle` 校验段（契约 §4.1 P1-11 锚点），
// 普通 build 全链路零检查点——前缀违规要到打包第二步才暴露，第一步 `ojm build` 零报错。
// 本门禁让普通 build 在任何产物写入前，对全部用户方案契约执行与 bundle 校验段同源的
// 文件面校验（checkTables + checkLocales 同一块代码，两处执行）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSolutionFileContract } from "../../bundle";

let project: string;

beforeEach(() => {
	project = mkdtempSync(join(tmpdir(), "ojm-gate-proj-"));
});

afterEach(() => {
	rmSync(project, { recursive: true, force: true });
});

/** 最小 module-root 用户方案：api 侧 + schema.yaml + 模块级契约 */
function addSolution(name: string, schemaYaml: string, apiSection?: string): void {
	mkdirSync(join(project, "src", name, "api"), { recursive: true });
	writeFileSync(join(project, "src", name, "api", "manifest.yaml"), `name: ${name}\ndesc: x\nversion: 0.1.0\n`);
	writeFileSync(join(project, "src", name, "api", "schema.yaml"), schemaYaml);
	writeFileSync(join(project, "src", name, "solution.yaml"), [
		`name: ${name}`,
		"version: 0.1.0",
		`summary: ${name} 方案`,
		...(apiSection ? [apiSection] : []),
		"",
	].join("\n"));
}

const GOOD_SCHEMA = "prefix: demo_\ntables:\n  demo_note: {}\n";

describe("assertSolutionFileContract（普通 ojm build 文件面门禁）", () => {
	it("零用户契约（纯脚手架空工程）静默通过", async () => {
		await expect(assertSolutionFileContract(project)).resolves.toBeUndefined();
	});

	it("schema.yaml 缺 prefix → 抛 C2-12c（此前普通 build 对此零报错）", async () => {
		addSolution("demo", "tables:\n  demo_note: {}\n", "api:\n  module: demo");
		await expect(assertSolutionFileContract(project)).rejects.toThrow(/C2-12c.*缺 prefix/s);
	});

	it("保留段 prefix（oj_evil_）→ 抛 C2-12c 第一方保留段", async () => {
		addSolution("demo", "prefix: oj_evil_\ntables:\n  oj_evil_note: {}\n", "api:\n  module: demo");
		await expect(assertSolutionFileContract(project)).rejects.toThrow(/C2-12c.*保留段/s);
	});

	it("合法前缀且表名带前缀 → 放行", async () => {
		addSolution("demo", GOOD_SCHEMA, "api:\n  module: demo\n  tables: [demo_note]");
		await expect(assertSolutionFileContract(project)).resolves.toBeUndefined();
	});

	it("引用式方案（api 段无 tables）+ schema.yaml 违规 → 仍判罚（表名冲突与打包形态无关）", async () => {
		addSolution("demo", "tables:\n  demo_note: {}\n", "api:\n  module: demo");
		await expect(assertSolutionFileContract(project)).rejects.toThrow(/C2-12c.*缺 prefix/s);
	});

	it("locales 双语缺引用 key → 抛 C2-25（同块文件面校验一并生效）", async () => {
		addSolution("demo", GOOD_SCHEMA, "api:\n  module: demo\n  tables: [demo_note]\nroutes:\n  - {path: /demo, category: main, order: 200, title_key: demo:menu.main}");
		await expect(assertSolutionFileContract(project)).rejects.toThrow(/C2-25/);
	});
});
