import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildModules } from "../../packages/cli/src/build";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * P3 回归用例（实施计划 Phase 0→2，docs/plans/20261121-2040）。
 *
 * 历史（2026-11-20 RED → 2026-11-21 GREEN）：
 *   源码树模块的停用状态没有任何状态源承载——写 modules.json 会被例行构建整表
 *   重写复活；写 sidecar 同名记录会触发双轨同名红线硬失败（详见当日提交记录）。
 *   overlay 化后：sidecar solutions 行（无 face）经 materialize 按名叠停用掩码，
 *   停用状态跨构建存活（本用例 2026-11-21 转绿，@fixme overlay-phase1 已兑现）。
 *
 * 本用例模拟「管理员停用源码树模块 app」的新状态源写入：sidecar 行
 * （enabled=false，无 face——builtin 无 face），例行重建后断言停用存活。
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

/** 模拟「停用源码树模块」的 overlay 状态源写入：sidecar 行（无 face） */
function simulateDisableBuiltin(name: string, version: string) {
	const dir = path.join(WORK, "modules", ".solutions");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "state.yaml"),
		`solutions:\n  ${name}:\n    version: "${version}"\n    enabled: false\n`,
	);
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

		// 管理员停用源码树模块 app（sidecar overlay 行），随后例行重建
		simulateDisableBuiltin("app", "0.1.0");
		await buildModules(WORK);
	}, 300_000);

	afterAll(() => {
		fs.rmSync(WORK, { recursive: true, force: true });
	});

	it("停用状态跨构建存活（2026-11-20 红 → 2026-11-21 绿）", () => {
		const app = readManifest().find(m => m.name === "app");
		expect(app, "清单中应有 app").toBeTruthy();
		expect(app!.enabled, "sidecar 停用的源码树模块应跨构建存活（materialize 按名叠掩码）").toBe(false);
	});

	it("停用语义完整：停用的是构建条目本身而非仅 sidecar", () => {
		// sidecar 无 face 的 builtin 记录本来就不被 merge 采纳——
		// 若该断言也红，说明复活路径与推导一致（modules.json 被整表重写）
		const raw = fs.readFileSync(path.join(DIST, "modules.json"), "utf-8");
		expect(raw).toContain("\"enabled\": false");
	});
});
