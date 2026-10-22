import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 后端模块测试（BDD）：node:sqlite 内存库 + 真实迁移建表（见 tests/fixture.ts）。
// root 锚定本目录，保证从工程根跑 vitest 时 include 相对本目录解析。
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	// `#/<模块名>/…` 是 oj 的模块别名（锚在目标模块根，本布局下即 `src/<模块名>/api`）。
	// oj build / ojm dev 在打包器里解析它，vitest 走 vite 的 resolve，必须在此显式映射，
	// 否则跨模块 import 的后端 spec 会以「Cannot find module」整文件跳过。
	// 形如 `#x`（锚本模块根）与导入方相对，静态 alias 表达不了——模板后端不用这种形态，
	// 一旦引入需先补 vitest 侧解析（或改写成 `#/<模块名>/…`）。
	resolve: {
		alias: [{ find: /^#\/([^/]+)\/(.*)$/, replacement: `${srcDir}/$1/api/$2` }],
	},
	test: {
		include: ["tests/**/*.spec.ts"],
		environment: "node",
	},
});
