// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
	assertDefaultModulesUntouched,
	collectDefaultModuleDrift,
	isProtectedRel,
	protectedTemplateFiles,
	readInitInclude,
	removeExtraProtectedFiles,
	templatesRoot,
} from "../../packages/cli/src/scaffold-guard";

/**
 * 脚手架完整性门禁（BDD）——内置模块自治契约：
 *
 * - `src/app` 内置模块与 `src/oj-market` 由上游自治，下游不得本地修改；
 * - `ojm build` 前逐文件与**当前 cli 包内 templates** 比对（上游模板即基线，
 *   CLI 升级后旧默认模块即视为漂移，必须先 `ojm init --yes` 同步）；
 * - 修改 / 缺失 / 多出三类漂移均 fail-fast，且不写任何构建产物；
 * - 门禁开关 = `src/.ojm-builtin.json` 存在（缺失 = 旧工程，退化现状不拦）；
 * - 门禁不是安全边界：删除开关文件即退回旧行为（与 builtin.ts 哲学一致）。
 */

function tmpProject(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "ojm-guard-"));
}

/** 工程侧落一个文件（自动建父目录） */
function put(root: string, rel: string, content: string): void {
	fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
	fs.writeFileSync(path.join(root, rel), content);
}

/** 声明内置模块概念（门禁生效开关） */
function enableGuard(root: string): void {
	put(root, "src/.ojm-builtin.json", JSON.stringify({ modules: ["app", "oj-market"] }));
}

/** 按白名单拷贝保护集（init 对保护集的等效行为：无占位符/区间，逐字节拷贝） */
function copyProtectedSet(root: string): void {
	const templatesDir = templatesRoot();
	for (const rel of readInitInclude(templatesDir)) {
		if (!isProtectedRel(rel))
			continue;
		fs.cpSync(path.join(templatesDir, rel), path.join(root, rel), { recursive: true });
	}
}

const ENTRY_REL = "src/app/web/entry.ts";
const AUTH_MANIFEST_REL = "src/app/api/auth/manifest.yaml";

function templateText(rel: string): string {
	return fs.readFileSync(path.join(templatesRoot(), rel), "utf-8");
}

let proj: string;
beforeEach(() => {
	proj = tmpProject();
});

describe("门禁开关", () => {
	it("无 src/.ojm-builtin.json（旧工程）→ 收集返回 null、assert 不抛，即使内容已被改", () => {
		put(proj, ENTRY_REL, `${templateText(ENTRY_REL)}\n// 本地魔改\n`);
		expect(collectDefaultModuleDrift(proj)).toBeNull();
		expect(() => assertDefaultModulesUntouched(proj)).not.toThrow();
	});
});

describe("漂移收集（Given 工程声明了内置模块）", () => {
	beforeEach(() => enableGuard(proj));

	it("按白名单拷贝保护集（刚 init 形态）→ 零漂移", () => {
		copyProtectedSet(proj);
		expect(collectDefaultModuleDrift(proj)).toEqual({ modified: [], missing: [], extra: [] });
	});

	it("行尾 CRLF 归一：git autocrlf 改写不误报", () => {
		put(proj, ENTRY_REL, templateText(ENTRY_REL).replaceAll("\n", "\r\n"));
		expect(collectDefaultModuleDrift(proj)!.modified).toEqual([]);
	});

	it("内容被修改 → modified 列出相对路径", () => {
		put(proj, ENTRY_REL, `${templateText(ENTRY_REL)}\nexport const hack = 1;\n`);
		expect(collectDefaultModuleDrift(proj)!.modified).toContain(ENTRY_REL);
	});

	it("白名单文件缺失 → missing", () => {
		put(proj, ENTRY_REL, templateText(ENTRY_REL));
		expect(collectDefaultModuleDrift(proj)!.missing).toContain(AUTH_MANIFEST_REL);
	});

	it("保护目录内多出模板没有的文件 → extra；自定义模块目录（src/crm）不参与", () => {
		put(proj, ENTRY_REL, templateText(ENTRY_REL));
		put(proj, "src/app/web/pages/hacked.tsx", "export default null;\n");
		put(proj, "src/crm/web/entry.ts", "export default null;\n");
		const drift = collectDefaultModuleDrift(proj)!;
		expect(drift.extra).toContain("src/app/web/pages/hacked.tsx");
		expect(drift.extra.every(f => f.startsWith("src/app/") || f.startsWith("src/oj-market/"))).toBe(true);
	});
});

describe("assertDefaultModulesUntouched", () => {
	it("漂移 → 抛错：点名文件、说明上游自治、给出 ojm init --yes 处置", () => {
		enableGuard(proj);
		put(proj, ENTRY_REL, "完全不同的内容\n");
		let error: Error | undefined;
		try {
			assertDefaultModulesUntouched(proj);
		}
		catch (e) {
			error = e as Error;
		}
		expect(error, "应抛错").toBeInstanceOf(Error);
		expect(error!.message).toContain(ENTRY_REL);
		expect(error!.message).toContain("ojm init --yes");
		expect(error!.message).toContain("上游");
	});

	it("零漂移 → 不抛", () => {
		enableGuard(proj);
		copyProtectedSet(proj);
		expect(() => assertDefaultModulesUntouched(proj)).not.toThrow();
	});
});

describe("removeExtraProtectedFiles（--yes 恢复的清理面）", () => {
	it("只删保护根内模板没有的文件；白名单文件与自定义模块不动；遗留空目录一并清理", () => {
		enableGuard(proj);
		put(proj, ENTRY_REL, templateText(ENTRY_REL));
		put(proj, "src/app/web/pages/hacked.tsx", "export default null;\n");
		put(proj, "src/crm/web/entry.ts", "export default null;\n");
		const removed = removeExtraProtectedFiles(proj);
		expect(removed).toEqual(["src/app/web/pages/hacked.tsx"]);
		expect(fs.existsSync(path.join(proj, "src/app/web/pages/hacked.tsx"))).toBe(false);
		expect(fs.existsSync(path.join(proj, "src/app/web/pages"))).toBe(false);
		expect(fs.readFileSync(path.join(proj, ENTRY_REL), "utf-8")).toBe(templateText(ENTRY_REL));
		expect(fs.readFileSync(path.join(proj, "src/crm/web/entry.ts"), "utf-8")).toBe("export default null;\n");
	});
});

describe("保护集与不变量", () => {
	it("isProtectedRel：保护根及其子路径 true；src/crm、工程级文件、src 根散文件 false", () => {
		for (const ok of ["src/app", "src/app/web/entry.ts", "src/oj-market/web/entry.ts"])
			expect(isProtectedRel(ok), ok).toBe(true);
		for (const no of ["src/crm/web/entry.ts", "src/styles.css", "config.yaml"])
			expect(isProtectedRel(no), no).toBe(false);
	});

	it("保护集只来自白名单的保护根条目", () => {
		const files = protectedTemplateFiles(templatesRoot(), readInitInclude(templatesRoot()));
		expect(files.length).toBeGreaterThan(100);
		for (const f of files)
			expect(f.startsWith("src/app/") || f.startsWith("src/oj-market/"), f).toBe(true);
	});

	it("不变量：保护集内模板文件不得含占位符与 demo-only 区间（init 拷贝时会改写这些，留着必造成门禁假阳性）", () => {
		const templatesDir = templatesRoot();
		for (const rel of protectedTemplateFiles(templatesDir, readInitInclude(templatesDir))) {
			const text = fs.readFileSync(path.join(templatesDir, rel), "utf-8");
			expect(text.includes("__JWT_SECRET__") || text.includes("__PROJECT_NAME__"), rel).toBe(false);
			expect(/\/\/\s*#region\s+demo-only/.test(text), rel).toBe(false);
		}
	});
});
