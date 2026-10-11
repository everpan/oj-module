/**
 * 混合 gitignore 方案下的测试自举。
 *
 * runtime/dist 与 cli/shell-dist 已不再入库（改为构建期生成）。宿主 shell-dist
 * 缺失时（干净 clone / CI 首次跑测试）自动 build:shell 重建；已存在则跳过，
 * 避免每次测试都重跑重型构建（kit 的 vite 构建 + editor 5.1MB 资产打包）。
 *
 * build:shell 内部会顺带构建 runtime 与 @plane/kit，并读取已提交的
 * @plane/editor 的 dist/editor.js（该产物无法在 oj-module 侧重建，仍强制入库）。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SHELL_DIST = path.resolve("packages/cli/shell-dist/versions.json");

export default function globalSetup() {
	if (fs.existsSync(SHELL_DIST))
		return;
	console.warn("[global-setup] shell-dist 缺失，自动运行 build:shell ...");
	execSync("pnpm --filter @oj-module/cli build:shell", { stdio: "inherit" });
}
