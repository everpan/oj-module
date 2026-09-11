import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_ROOT, RUNTIME_DIR } from "../helpers/paths";

/**
 * 框架反向依赖模块的已知清单（B3）。
 *
 * P2 会切断这两处依赖（runtime 内置 NotFound / UnknownComponent），届时白名单应清空。
 * 此用例的作用是防止迁移过程中反向依赖继续扩散。
 */
const REVERSE_DEPENDENCY_WHITELIST = [
	"router/routes/core/fallback.ts",
	"router/utils/generate-routes-from-backend.ts",
];

function collectFiles(dir: string): string[] {
	if (!fs.existsSync(dir))
		return [];

	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? collectFiles(full) : [full];
	});
}

describe("monorepo 目录布局", () => {
	it("框架源码位于 packages/runtime/src", () => {
		for (const subdir of ["router", "layout", "components", "module-loader", "locales"]) {
			expect(fs.existsSync(path.join(RUNTIME_DIR, subdir)), `packages/runtime/src 应包含 ${subdir}/`).toBe(true);
		}
	});

	it("根目录不应残留 src/", () => {
		expect(
			fs.existsSync(path.join(PROJECT_ROOT, "src")),
			"框架源码已迁至 packages/runtime/src，根目录不应再有 src/",
		).toBe(false);
	});

	it("框架反向依赖模块的文件不得超出白名单", () => {
		const offenders = collectFiles(RUNTIME_DIR)
			.filter(file => /\.tsx?$/.test(file))
			.filter(file => /["']#web\//.test(fs.readFileSync(file, "utf-8")))
			.map(file => path.relative(RUNTIME_DIR, file).split(path.sep).join("/"))
			.filter(file => !REVERSE_DEPENDENCY_WHITELIST.includes(file));

		expect(offenders, `以下文件新增了框架 → 模块的反向依赖：${offenders.join(", ")}`).toEqual([]);
	});

	it("tsconfig 的 #src/* 应指向 packages/runtime/src/*", () => {
		const tsconfig = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "tsconfig.json"), "utf-8"));
		expect(tsconfig.compilerOptions.paths["#src/*"]).toEqual(["./packages/runtime/src/*"]);
	});
});
