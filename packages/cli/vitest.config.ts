import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// cli 包内单元测试（contract 翻译层 / openapi 解析 / 代码发射）。
// 与根 vite.config.ts（App 链 e2e + fake server，只收 tests/**）隔离，避免 fake 目录依赖。
// root 必须锚定本包目录：缺省取 CWD，从仓库根跑 `--config packages/cli/vitest.config.ts`
// 时 include 会相对仓库根解析而一个测试都找不到。
export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
