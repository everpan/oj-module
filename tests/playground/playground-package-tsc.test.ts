import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { PLAYGROUND_DIR } from "../helpers/paths";

/**
 * P3.7：外部模块工程的类型检查只依赖 npm 包名。
 *
 * playground 的 tsconfig 不做任何包名 → 框架源码的 paths 映射，
 * `@oj-module/runtime` 必须经 node_modules → package.json exports
 * 解析到 dist/index.d.ts，且该声明树自包含（jss/icons 等内部类型不外泄）。
 * 这是对「外部工程无框架源码」的最终验收。
 */
describe("playground 仅靠包名通过 tsc（P3.7）", () => {
	it("playground tsconfig 存在且不含 runtime 的 paths 映射", () => {
		const tsconfig = JSON.parse(execSync("cat tsconfig.json", { cwd: PLAYGROUND_DIR }).toString());
		const paths = tsconfig.compilerOptions?.paths ?? {};
		expect(Object.keys(paths).filter(k => k.startsWith("@oj-module"))).toEqual([]);
	});

	it("npx tsc -p tsconfig.json --noEmit 通过（走 dist 声明）", () => {
		expect(() => {
			execSync("npx tsc -p tsconfig.json --noEmit", {
				cwd: PLAYGROUND_DIR,
				stdio: "pipe",
				timeout: 120_000,
			});
		}).not.toThrow();
	});
});
