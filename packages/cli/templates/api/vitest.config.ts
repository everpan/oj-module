import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 后端模块测试（BDD）：node:sqlite 内存库 + 真实迁移建表（见 tests/fixture.ts）。
// root 锚定本目录，保证从工程根跑 vitest 时 include 相对本目录解析。
export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	test: {
		include: ["tests/**/*.spec.ts"],
		environment: "node",
	},
});
