import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MODULES_DIR, PLAYGROUND_DIR, PROJECT_ROOT } from "../helpers/paths";

/**
 * P3.2 包名化契约（设计文档 D3）：模块工程只允许
 * `import ... from "@oj-module/runtime"` 取用框架能力，
 * 禁止任何 `#src/*` 框架内部路径（那是宿主工程的私有别名）。
 *
 * 「模块 import 的符号是否都在冻结出口里」由 tsc 保证：
 * tsconfig paths 将包名直指 `packages/runtime/src/index.ts`，
 * 出口外符号会在 typecheck 阶段报错（与 tests/runtime-exports.test.ts 闭环）。
 */
const RUNTIME_PACKAGE = "@oj-module/runtime";

function collectTsFiles(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTsFiles(full, out);
		}
		else if (/\.(?:ts|tsx)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

describe("模块包名化（P3.2 / D3）", () => {
	it("modules 与 playground 模块源码零 #src import", () => {
		const offenders: string[] = [];
		for (const dir of [MODULES_DIR, path.join(PLAYGROUND_DIR, "modules")]) {
			for (const file of collectTsFiles(dir)) {
				if (fs.readFileSync(file, "utf-8").includes("from \"#src/")) {
					offenders.push(file);
				}
			}
		}
		expect(offenders, `以下文件仍 import 框架内部路径：${offenders.join(", ")}`).toEqual([]);
	});

	it("每个模块 entry 均从包名导入框架契约", () => {
		const missing: string[] = [];
		for (const dir of [MODULES_DIR, path.join(PLAYGROUND_DIR, "modules")]) {
			for (const name of fs.readdirSync(dir)) {
				const entry = path.join(dir, name, "entry.ts");
				if (fs.existsSync(entry) && !fs.readFileSync(entry, "utf-8").includes(RUNTIME_PACKAGE)) {
					missing.push(entry);
				}
			}
		}
		expect(missing, `以下 entry 未从 ${RUNTIME_PACKAGE} 导入：${missing.join(", ")}`).toEqual([]);
	});

	it("monorepo 解析：包名直指 runtime 源码（tsconfig paths + vite alias）", () => {
		const tsconfig = fs.readFileSync(path.join(PROJECT_ROOT, "tsconfig.json"), "utf-8");
		expect(tsconfig).toContain("\"@oj-module/runtime\"");

		const viteConfig = fs.readFileSync(path.join(PROJECT_ROOT, "vite.config.ts"), "utf-8");
		expect(viteConfig).toContain("@oj-module/runtime");
	});

	it("模块独立构建将包名视为 external（由宿主 importmap 提供）", () => {
		const buildScript = fs.readFileSync(path.join(PROJECT_ROOT, "scripts/build-modules.ts"), "utf-8");
		expect(buildScript).toContain(RUNTIME_PACKAGE);
	});

	it("modules/ 纳入根 tsconfig include（B8：模块源码参与全量类型检查）", () => {
		const tsconfig = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "tsconfig.json"), "utf-8"));
		expect(tsconfig.include).toContain("modules");
	});
});
