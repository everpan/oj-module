import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 前端组件测试（*.test.tsx）：jsdom 环境 + antd 所需的 matchMedia / ResizeObserver /
// IntersectionObserver polyfill（见 tests/setup.ts）。后端 spec.ts 走 node 环境，由
// vitest.config.ts 承载；两者通过 include 区分，互不打扰。
// globals: true 启用 testing-library 的 afterEach 自动清理，避免多用例间 DOM 累加。
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	root,
	resolve: {
		alias: [{ find: /^#\/([^/]+)\/(.*)$/, replacement: `${root}src/app/api/$1/$2` }],
	},
	test: {
		include: [
			"src/app/web/system/pages/mcp/index.test.tsx",
			"src/app/web/system/pages/roles/index.test.tsx",
			"src/app/web/system/pages/users/index.test.tsx",
			"src/app/web/personal-center/pages/my-profile/change-password-card.test.tsx",
		],
		environment: "jsdom",
		globals: true,
		setupFiles: ["./tests/setup.ts"],
		// @ant-design/pro-components 以 "type":"module" 发布却内含 CJS 的 lib/index.js，
		// vitest 按 ESM 解析会报 "exports is not defined"；inline 让其走 vite 的 module 字段（ESM 构建）。
		server: { deps: { inline: ["@ant-design/pro-components"] } },
	},
});
