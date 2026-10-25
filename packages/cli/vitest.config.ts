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
		// build-index 的体积/内存实测要量的「中间对象」是**存活集**，不是未回收的垃圾：
		// 不暴露 gc 时 heapUsed 增量把垃圾一并算进（实测 152MB vs 真实约 30MB），闸门失真。
		// （vitest 4 起 poolOptions 已移除，execArgv 是 test 顶层选项）
		execArgv: ["--expose-gc"],
	},
});
