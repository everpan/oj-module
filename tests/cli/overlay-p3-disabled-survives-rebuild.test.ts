import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildModules } from "../../packages/cli/src/build";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * @fixme overlay-phase1 —— P3 RED 用例（实施计划 Phase 0 / docs/plans/20261121-2040）。
 *
 * 缺陷实锤（主文档 §2-P3，代码推导 2026-11-20；本用例 2026-11-21 复现）：
 *   源码树模块条目在 modules.json 里的 enabled=false 会被下次 `ojm build` **静默复活**——
 *   `module-build.ts` 对所有构建条目写死 enabled=true，installed-merge 只把 sidecar
 *   里**有 face 旁车**的已装方案的状态叠回去；源码树模块的停用标记没有任何
 *   状态源承载，老 modules.json 本身就是唯一存留点，而例行构建整个重写它。
 *
 * 实跑补充发现（反常识）：setEnabled 对纯源码树模块会拒绝（「未安装」，
 * installer.ts:1249）；且若强行给源码树模块名写 sidecar solutions 记录，
 * 下次构建不是 warn 跳过而是被 restoreInstalledFaces 从版本目录重物化 face
 * 后触发「双轨同名红线」硬失败（installed-merge.ts:194）。也就是说**停用
 * 源码树模块在当前体系里无路可走**——这正是 overlay 表要把 enabled 变成
 * 按 name 承载的状态的原因。
 *
 * 本用例直接写文件面（modules.json enabled=false）复现最小复活机制。
 *
 * 当前代码预期：**红**（app 被复活为 enabled=true）。
 * Phase 2（overlay 表接管状态真源）完成后转绿。
 */

const TEMPLATE = path.join(PROJECT_ROOT, "packages/cli/templates");
let WORK: string;
let DIST: string;

interface ModuleManifest {
	name: string
	version: string
	enabled: boolean
}

function readManifest(): ModuleManifest[] {
	return JSON.parse(fs.readFileSync(path.join(DIST, "modules.json"), "utf-8")) as ModuleManifest[];
}

/** 复现「源码树模块条目被停用」的最小文件面：modules.json enabled=false */
function simulateDisabledEntry(name: string) {
	const manifestPath = path.join(DIST, "modules.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ModuleManifest[];
	const entry = manifest.find(m => m.name === name);
	expect(entry, `清单中应有 ${name}`).toBeTruthy();
	entry!.enabled = false;
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("停用的内建模块在例行构建后保持停用（P3 RED）", () => {
	beforeAll(async () => {
		WORK = fs.mkdtempSync(path.join(PROJECT_ROOT, "tmp-overlay-p3-"));
		fs.cpSync(path.join(TEMPLATE, "src"), path.join(WORK, "src"), { recursive: true });
		fs.cpSync(path.join(TEMPLATE, "web.config.ts"), path.join(WORK, "web.config.ts"));
		for (const file of ["tsconfig.json", "tsconfig.paths.json"])
			fs.cpSync(path.join(TEMPLATE, file), path.join(WORK, file));
		fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "tmp-overlay-p3", type: "module" }));
		fs.symlinkSync(path.join(TEMPLATE, "node_modules"), path.join(WORK, "node_modules"), process.platform === "win32" ? "junction" : "dir");
		DIST = path.join(WORK, "dist", "web");

		// 首次构建（正常全启用）
		await buildModules(WORK);

		// 管理员停用源码树模块 app（文件面停用标记），随后例行重建
		simulateDisabledEntry("app");
		await buildModules(WORK);
	}, 300_000);

	afterAll(() => {
		fs.rmSync(WORK, { recursive: true, force: true });
	});

	it("停用状态跨构建存活（当前代码必红：被静默复活）", () => {
		const app = readManifest().find(m => m.name === "app");
		expect(app, "清单中应有 app").toBeTruthy();
		expect(app!.enabled, "停用的内建模块不应被例行构建复活（@fixme overlay-phase1）").toBe(false);
	});

	it("停用语义完整：停用的是构建条目本身而非仅 sidecar", () => {
		// sidecar 无 face 的 builtin 记录本来就不被 merge 采纳——
		// 若该断言也红，说明复活路径与推导一致（modules.json 被整表重写）
		const raw = fs.readFileSync(path.join(DIST, "modules.json"), "utf-8");
		expect(raw).toContain("\"enabled\": false");
	});
});
