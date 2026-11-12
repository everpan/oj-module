/**
 * init 白名单完整性审计（scaffold-guard.auditInitInclude）。
 *
 * 契约：`src/app/{api,web}/<模块>` 下每个目录都要有归属——被 include 收录（整目录，
 * 或像 web/home 那样只列子路径）、或在 exclude 里显式登记不下发。两边都没有 → 拒 init。
 *
 * 为什么值得一条测试：2026-11-12 全量演练实锤 wecom-bot 漏收——init 不报错，只是
 * 模块不进新工程，openapi.json 里的 /api/wecom-bot/mcp 还被 pruneUnincludedApiPaths
 * 一并剪掉，新工程等于从来没有它。最后一条用例直接审计仓库里的真实模板树，
 * 以后新增模块忘登记，这里先红。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertInitIncludeComplete, auditInitInclude, readInitExclude } from "../scaffold-guard";

const templatesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");
const tmpDirs: string[] = [];

/** 造一棵最小模板树：init.include.yaml 原文 + 需要落盘的文件（目录自动建） */
function fixture(yamlText: string, files: string[]): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-include-"));
	tmpDirs.push(root);
	fs.writeFileSync(path.join(root, "init.include.yaml"), yamlText);
	for (const rel of files) {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, "");
	}
	return root;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0))
		fs.rmSync(dir, { recursive: true, force: true });
});

describe("init.include.yaml 完整性审计", () => {
	it("api 模块两处都没登记 → uncovered（wecom-bot 漏收的复现）", () => {
		const root = fixture("include:\n  - src/app/api/auth\n", [
			"src/app/api/auth/manifest.yaml",
			"src/app/api/wecom-bot/manifest.yaml",
		]);
		expect(auditInitInclude(root).uncovered).toEqual(["src/app/api/wecom-bot"]);
		expect(() => assertInitIncludeComplete(root)).toThrow(/src\/app\/api\/wecom-bot/);
	});

	it("exclude 登记即有归属：demo-only 模块不必进 include", () => {
		const root = fixture(
			"include:\n  - src/app/api/auth\nexclude:\n  - src/app/api/home\n",
			["src/app/api/auth/manifest.yaml", "src/app/api/home/manifest.yaml"],
		);
		expect(auditInitInclude(root).uncovered).toEqual([]);
	});

	it("web 模块只列子路径也算覆盖（web/home 形态）", () => {
		const root = fixture(
			"include:\n  - src/app/web/home/routes.ts\n",
			["src/app/web/home/routes.ts", "src/app/web/home/pages/x.tsx"],
		);
		expect(auditInitInclude(root).uncovered).toEqual([]);
	});

	it("web 模块整目录没被收录也没登记 → uncovered", () => {
		const root = fixture("include:\n  - src/app/web/login\n", [
			"src/app/web/login/page.tsx",
			"src/app/web/forgotten/page.tsx",
		]);
		expect(auditInitInclude(root).uncovered).toEqual(["src/app/web/forgotten"]);
	});

	it("平铺布局 src/<模块>/api 未登记 → uncovered（oj-market 漏收同型）", () => {
		const root = fixture("include:\n  - src/oj-market/api\n  - src/oj-market/web/__client\n", [
			"src/oj-market/api/api.ts",
			"src/oj-market/web/__client/index.ts",
			"src/other-solution/api/api.ts",
		]);
		expect(auditInitInclude(root).uncovered).toEqual(["src/other-solution/api"]);
	});

	it("exclude 指向不存在的目录 → fail-fast（拼错等于没排除）", () => {
		const root = fixture("include: []\nexclude:\n  - src/app/api/hom\n", []);
		expect(() => readInitExclude(root)).toThrow(/src\/app\/api\/hom/);
	});

	it("真实模板树审计通过：新增模块忘登记，本用例先红", () => {
		expect(auditInitInclude(templatesRoot)).toEqual({ uncovered: [] });
		// demo-only 必须显式登记，否则会被当成「漏收」——这条钉住 exclude 段的存在
		const exclude = [...readInitExclude(templatesRoot)];
		expect(exclude).toContain("src/app/api/home");
		expect(exclude).toContain("src/about/web");
	});
});
