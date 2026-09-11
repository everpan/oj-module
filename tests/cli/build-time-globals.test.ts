import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PLAYGROUND_DIR, PROJECT_ROOT } from "../helpers/paths";

/**
 * 构建期全局的自包含性（A26）。
 *
 * `getAppInfo()` 读全局 `__APP_INFO__`，而它只在**根** `vite.config.ts` 里 define。
 * 根配置只作用于主应用构建，并不会给 runtime 产物留下一个运行期全局——
 * 于是 `runtime.js` 带着裸的 `__APP_INFO__` 发布，宿主（shell）也没注入，
 * 浏览器一初始化 usePreferences（`name: getAppNamespace("preferences")`）
 * 就 ReferenceError 整页崩。
 *
 * runtime 是要当 npm 包分发的，构建期全局必须自己注入（同 R15 的
 * `process.env.NODE_ENV` 一个道理：lib 模式下 vite 不做替换）。
 */

// 注意 RUNTIME_DIR 指向 packages/runtime/src，这里要的是包根目录
const RUNTIME_PKG_DIR = path.join(PROJECT_ROOT, "packages/runtime");
const RUNTIME_VITE_CONFIG = path.join(RUNTIME_PKG_DIR, "vite.config.ts");
const RUNTIME_DIST_JS = path.join(RUNTIME_PKG_DIR, "dist/runtime.js");
const SHELL_RUNTIME_JS = path.join(PROJECT_ROOT, "packages/cli/shell-dist/assets/runtime.js");

/** 已知的构建期注入全局：产物里若还留着裸标识符，就是没人注入 */
const BUILD_TIME_GLOBALS = ["__APP_INFO__"];

describe("构建期全局自包含（A26）", () => {
	it("runtime 的 vite 配置注入了全部构建期全局", () => {
		const config = fs.readFileSync(RUNTIME_VITE_CONFIG, "utf-8");
		for (const globalName of BUILD_TIME_GLOBALS) {
			expect(
				config,
				`${RUNTIME_VITE_CONFIG} 应 define ${globalName}——runtime 要作为 npm 包分发，`
				+ "不能依赖使用方的 vite define（根 vite.config.ts 只作用于主应用构建）",
			).toContain(globalName);
		}
	});

	it("runtime 产物不含未替换的构建期全局", () => {
		const source = fs.readFileSync(RUNTIME_DIST_JS, "utf-8");
		for (const globalName of BUILD_TIME_GLOBALS) {
			const offenders = source
				.split("\n")
				.map((line, i) => [i + 1, line] as const)
				// 注释与字符串里的字面量不算（jsdoc 文本是假阳性源）
				.filter(([, line]) => new RegExp(`(?:^|[^/\\w])${globalName}\\s*[;,)\\[\\].]`).test(line.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/g, "")))
				.map(([n]) => n);

			expect(
				offenders,
				`${path.relative(PROJECT_ROOT, RUNTIME_DIST_JS)} 第 ${offenders.join(", ")} 行仍引用未被替换的 ${globalName}`,
			).toEqual([]);
		}
	});

	it("宿主分发的 runtime.js 同样不含未替换的构建期全局", () => {
		const source = fs.readFileSync(SHELL_RUNTIME_JS, "utf-8");
		for (const globalName of BUILD_TIME_GLOBALS) {
			const offenders = source
				.split("\n")
				.map((line, i) => [i + 1, line] as const)
				.filter(([, line]) => new RegExp(`(?:^|[^/\\w])${globalName}\\s*[;,)\\[\\].]`).test(line.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/g, "")))
				.map(([n]) => n);

			expect(
				offenders,
				`宿主 assets/runtime.js 第 ${offenders.join(", ")} 行仍引用未被替换的 ${globalName}`,
			).toEqual([]);
		}
	});

	it("runtime 产物不含未折叠的环境变量守卫", () => {
		// `getAppNamespace()` 在取不到 VITE_APP_NAMESPACE 时会抛；分发产物里
		// 这条守卫必须已被 define 折叠掉，否则浏览器初始化 store 时整页崩
		for (const [label, file] of [
			["runtime 产物", RUNTIME_DIST_JS],
			["宿主 assets/runtime.js", SHELL_RUNTIME_JS],
		] as const) {
			const source = fs.readFileSync(file, "utf-8");
			expect(
				source.includes("VITE_APP_NAMESPACE is not defined"),
				`${label} 仍保留未折叠的 VITE_APP_NAMESPACE 守卫——`
				+ "runtime 在 packages/runtime 下独立构建，读不到仓库根 .env，"
				+ "须在 vite.config.ts 的 define 里给出默认值",
			).toBe(false);
		}
	});

	it("模块工程无需复制构建期 define（B9 解除）", () => {
		const config = path.join(PLAYGROUND_DIR, "vite.config.ts");
		expect(
			fs.existsSync(config),
			"外部模块工程不应需要 vite 配置（ojm build 以编程式 build() 驱动）",
		).toBe(false);
	});
});
