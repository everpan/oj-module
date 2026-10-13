import process from "node:process";
import { defineConfig } from "@playwright/test";

const target = (process.env.E2E_TARGET ?? "playground") as "playground" | "legacy";

// 全栈形态（playground-oj）：带真实 oj 后端（api/config.yaml），/api 反代到 oj，
// 通知多模块后端语义（push/del/隔离/403）只能在此形态下 e2e。端口与纯前端形态错开，
// 避免两形态并行时撞车。
const FULLSTACK_PORT = 5175;
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
	playgroundOj: {
		baseURL: `http://localhost:${FULLSTACK_PORT}`,
		webServer: {
			command: `pnpm --filter playground-oj dev ${FULLSTACK_PORT}`,
			url: `http://localhost:${FULLSTACK_PORT}`,
			// 复用已启动的服务：ojm dev 在子进程 cwd 下偶发拉不起后端，且其严格端口
			// 策略（被占顺延）会让 playwright 探活目标与测试目标错位。手动起服务后
			// 由 playwright 复用，最稳。
			reuseExistingServer: true,
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

// 通知 API 走全栈形态；legacy worktree 无 notification 模块，回退到 legacy 服务（用例内 skip）
const apiTarget = target === "legacy" ? TARGETS.legacy : TARGETS.playgroundOj;

export default defineConfig({
	// legacy vite dev 对 fake 端点按需编译 + 首次登录链路慢，放宽用例与断言时限
	timeout: target === "legacy" ? 90_000 : 30_000,
	retries: 0,
	workers: 1, // 串行：tabbar/menu 用例有全局 UI 状态，并行会互相干扰
	reporter: [["list"]],
	expect: { timeout: target === "legacy" ? 15_000 : 5_000 },
	// webServer 下沉到各 project，避免只跑某一 project 时无关服务也起
	projects: [
		{
			name: target,
			testDir: "./layout",
			use: { baseURL: TARGETS[target].baseURL, trace: "retain-on-failure" },
			webServer: TARGETS[target].webServer,
		},
		// 通知多模块后端语义走真实运行服务（ojm dev 反代的 /api），与 layout UI 基线分目录
		{
			name: `${target}-api`,
			testDir: "./api",
			use: { baseURL: apiTarget.baseURL, trace: "retain-on-failure" },
			webServer: apiTarget.webServer,
		},
	],
});
