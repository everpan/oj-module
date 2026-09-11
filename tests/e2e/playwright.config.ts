import process from "node:process";
import { defineConfig } from "@playwright/test";

const target = (process.env.E2E_TARGET ?? "playground") as "playground" | "legacy";

const TARGETS = {
	playground: {
		baseURL: "http://localhost:5174",
		webServer: {
			command: "pnpm --filter playground dev",
			url: "http://localhost:5174",
			// ojm dev 端口被占会顺延（HANDOFF §8 坑），不复用、撞车即报错
			reuseExistingServer: false,
			timeout: 120_000,
		},
	},
	legacy: {
		baseURL: "http://localhost:3333",
		webServer: {
			// playwright webServer 的 cwd 是 config 所在目录（tests/e2e/），故用 ../../。
			// 禁用 verify-deps：worktree 的 .git 是文件，simple-git-hooks prepare
			// 必失败，pnpm 11 run 前的自动 install 会拖死/中止 dev 启动
			command: "pnpm --config.verify-deps-before-run=false --dir ../../.e2e-legacy dev -- --strictPort",
			url: "http://localhost:3333",
			reuseExistingServer: false,
			timeout: 120_000,
		},
	},
} as const;

export default defineConfig({
	testDir: "./layout",
	// legacy vite dev 对 fake 端点按需编译 + 首次登录链路慢，放宽用例与断言时限
	timeout: target === "legacy" ? 90_000 : 30_000,
	retries: 0,
	workers: 1, // 串行：tabbar/menu 用例有全局 UI 状态，并行会互相干扰
	reporter: [["list"]],
	use: {
		baseURL: TARGETS[target].baseURL,
		trace: "retain-on-failure",
	},
	expect: { timeout: target === "legacy" ? 15_000 : 5_000 },
	webServer: TARGETS[target].webServer,
	projects: [{ name: target }],
});
