import process from "node:process";

import { defineConfig } from "@playwright/test";

/**
 * 模板工程（packages/cli/templates）专属 e2e：通知中心/铃铛互动/我的资料入库等
 * 模板形态特性。2026-11-02 起这是**唯一**的 e2e 套件（apps/playground* 下线），
 * 跑前确认没有其他服务占用 5174。
 *
 * globalSetup 负责 admin 夹具归一（口令/must_change/限流），详见 fixtures/enter-template-app.ts。
 */
export default defineConfig({
	timeout: 30_000,
	retries: 0,
	workers: 1, // 串行：通知用例有清空等破坏性操作，且共用一个 dev db
	reporter: [["list"]],
	expect: { timeout: 5_000 },
	globalSetup: "./fixtures/reset-template-fixture.ts",
	webServer: {
		command: "pnpm --filter @oj-module/template-demo dev",
		url: "http://localhost:5174",
		// 复用已启动的 templates dev 服务（ojm dev 被占端口会顺延，顺延后探活 URL
		// 对不上会再起一个实例——跑前确认没有其他 5174 服务）
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	projects: [
		{
			name: "templates",
			testDir: "./templates",
			use: { baseURL: "http://localhost:5174", trace: "retain-on-failure" },
		},
	],
});
