// BDD：devkit 全链路落地与文档同步（计划 docs/plans/20261103-1020-vendor-devkit-sync）。
// vendor 装/升 oj 后把 bin/devkit 文档**覆盖同步**进 .claude/skills/oj-api-dev/（R2/R3/R4）；
// init 步骤 4 走同一出口（R5，global.d.ts 模板变体保护）；ojm devkit 4b 现状回归（R1）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "../init";
import { syncOjDevkit } from "../vendor";

/* eslint-disable test/prefer-lowercase-title -- 计划编号是验收锚点 */
let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "ojm-devkit-sync-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/** 模拟 @oj-bin/oj postinstall 落盘的 bin/devkit（版本标记进内容以断言覆盖方向） */
function makeDevkit(version: string, dir = join(root, "bin", "devkit")): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `# oj-api-dev skill ${version}\n`);
	writeFileSync(join(dir, "api-manual.md"), `manual ${version}\n`);
	// 旧 init 清单之外的文件——按目录扫描（R6）应收进来
	writeFileSync(join(dir, "scenarios.md"), `scenarios ${version}\n`);
	writeFileSync(join(dir, "global.d.ts"), `// devkit ${version}\n`);
}

const skillOf = (name: string) => join(root, ".claude/skills/oj-api-dev", name);

describe("syncOjDevkit（vendor/init 共用同步出口）", () => {
	it("R2/R6 bin/devkit 齐备 → 全部 .md 同步进 skill 目录（含旧清单外文件；global.d.ts 不进）", () => {
		makeDevkit("v2");
		const r = syncOjDevkit(root, join(root, "bin"), () => {});
		expect(r.ok).toBe(true);
		expect(r.files.sort()).toEqual(["SKILL.md", "api-manual.md", "scenarios.md"]);
		expect(readFileSync(skillOf("SKILL.md"), "utf-8")).toContain("v2");
		expect(readFileSync(skillOf("scenarios.md"), "utf-8")).toContain("v2");
		expect(existsSync(skillOf("global.d.ts"))).toBe(false);
	});

	it("R3 同步是覆盖语义：oj 升级后旧 skill 内容被当前版本刷新（非首拷赢）", () => {
		makeDevkit("v1");
		syncOjDevkit(root, join(root, "bin"), () => {});
		writeFileSync(join(root, "bin", "devkit", "SKILL.md"), "# oj-api-dev skill v2\n");
		syncOjDevkit(root, join(root, "bin"), () => {});
		expect(readFileSync(skillOf("SKILL.md"), "utf-8")).toContain("v2");
	});

	it("R3 bin/devkit 缺 SKILL.md → ok:false，skill 目录不创建、不抛错", () => {
		const r = syncOjDevkit(root, join(root, "bin"), () => {});
		expect(r.ok).toBe(false);
		expect(existsSync(join(root, ".claude/skills/oj-api-dev"))).toBe(false);
	});
});

describe("ojm init 集成（注入 ojInstaller 模拟 vendor 落盘）", () => {
	it("R1/R5 init 后两侧 skill 都在：oj devkit 同步 + ojm devkit 七文件", async () => {
		await initProject(root, {
			yes: true,
			seal: async () => "ENC[test]",
			ojInstaller: async (binDir) => {
				makeDevkit("v1", join(binDir, "devkit"));
			},
		});
		expect(readFileSync(join(root, ".claude/skills/oj-api-dev/SKILL.md"), "utf-8")).toBe("# oj-api-dev skill v1\n");
		expect(existsSync(join(root, ".claude/skills/oj-api-dev/scenarios.md"))).toBe(true);
		for (const name of ["SKILL.md", "manual.md", "README.md", "wecom-daikaifa.md", "wecom-internal-app.md", "publish-walkthrough.md", "newcomer.md"])
			expect(existsSync(join(root, ".claude/skills/ojm-module-dev", name)), name).toBe(true);
	});

	it("R5 工程 global.d.ts 保模板变体：devkit 同名文件不覆盖（init/vendor 均不碰）", async () => {
		await initProject(root, {
			yes: true,
			seal: async () => "ENC[test]",
			ojInstaller: async (binDir) => {
				makeDevkit("v1", join(binDir, "devkit"));
			},
		});
		const rootGlobal = readFileSync(join(root, "global.d.ts"), "utf-8");
		expect(rootGlobal).not.toContain("// devkit v1");
		expect(rootGlobal).toContain(".route");
	});
});
