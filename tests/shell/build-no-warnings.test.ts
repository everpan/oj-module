import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 构建零告警回归（202610101439 治理 import-is-undefined 告警洪泛）。
 *
 * 默认跳过：真跑 build:shell 会刷新 shell-dist（CSP nonce 轮换弄脏工作区），
 * 常规 `pnpm test` 里启用会撞发布脚本的干净树门禁（publish-packages.mjs）。
 * 显式 opt-in：
 *   OJM_RUN_SHELL_BUILD=1 pnpm vitest run tests/shell/build-no-warnings.test.ts
 */
const ENABLED = process.env.OJM_RUN_SHELL_BUILD === "1";

describe("build:shell 零 WARNING（opt-in，真跑构建）", () => {
	it.skipIf(!ENABLED)("输出不含 ▲ [WARNING]", () => {
		const result = spawnSync("pnpm", ["--filter", "@oj-module/cli", "build:shell"], {
			cwd: PROJECT_ROOT,
			encoding: "utf-8",
			maxBuffer: 64 * 1024 * 1024,
		});
		// esbuild 告警走 stderr，stdout/stderr 都要查
		const warnings = [...`${result.stdout}\n${result.stderr}`.matchAll(/▲ \[WARNING\].*/g)].map(m => m[0]);
		expect(warnings, `build:shell 出现 ${warnings.length} 条 WARNING：\n${warnings.join("\n")}`).toEqual([]);
	}, 300_000);
});
