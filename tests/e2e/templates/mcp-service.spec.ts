import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * MCP 服务页（templates e2e，2026-11-13 增补）：三态 expose 形态展示 + 工具检索过滤 +
 * 分组工具表分页。后端目录取 oj-market 代理（oj ≥ 0.1.135，24 个 oj_market_* 工具入白名单），
 * 单组 > 10 工具即出分页条。
 */
test.describe("MCP 服务页（templates）", () => {
	test.beforeEach(async ({ page }) => {
		await enterTemplateApp(page, { username: "superadmin" });
	});

	test.afterEach(async ({ page }, testInfo) => {
		if (testInfo.status !== "passed") {
			await page.screenshot({ path: "/tmp/mcp-fail.png", fullPage: true }).catch(() => {});
		}
	});

	test("P1: 状态卡显示 expose 形态（已启用 + 列表面 flat）", async ({ page }) => {
		await page.goto("/system/framework/mcp");
		// 路由标题（system:menu.mcp = "MCP 服务"；页面正文不渲染 "MCP 服务管理" 字样）
		await expect(page.getByText("MCP 服务").first()).toBeVisible();
		// 状态：已启用（mcp.enabled: true）
		await expect(page.getByText("已启用", { exact: true })).toBeVisible();
		// expose 形态标签（默认 flat，未写 expose 键）
		await expect(page.getByText(/列表面 .*flat/)).toBeVisible();
	});

	test("P1: 检索过滤——无匹配空态、清空恢复", async ({ page }) => {
		await page.goto("/system/framework/mcp");
		const search = page.getByPlaceholder("搜索工具名 / 描述 / 方案");
		await expect(search).toBeVisible();
		// 目录异步加载；非方案组（未装方案时全部皆「非方案」）默认折叠，先等折叠头出现再展开
		const headers = page.locator(".ant-collapse-header");
		await expect(headers.first()).toBeVisible({ timeout: 20_000 });
		for (let i = 0; i < await headers.count(); i++) {
			await headers.nth(i).click();
		}
		await expect(page.locator(".ant-table-tbody tr").first()).toBeVisible({ timeout: 20_000 });

		// 不可能命中的关键字 → 空态（空态卡在折叠区外，无需展开即可见）
		await search.fill("zzz_no_such_tool_zzz");
		await expect(page.getByText(/没有匹配/)).toBeVisible();

		// 清空 → 回到全量（检索摘要回到「共 114 个工具」，该文本在折叠区外、不依赖展开态）
		await search.fill("");
		await expect(page.getByText(/共 114 个工具/)).toBeVisible();
	});

	test("P1: 工具多时分页——分组表出分页条且可翻页", async ({ page }) => {
		await page.goto("/system/framework/mcp");
		// 展开全部「非方案」折叠组，工具表才入 DOM
		const headers = page.locator(".ant-collapse-header");
		await expect(headers.first()).toBeVisible({ timeout: 20_000 });
		for (let i = 0; i < await headers.count(); i++) {
			await headers.nth(i).click();
		}
		await expect(page.locator(".ant-table-tbody tr").first()).toBeVisible({ timeout: 20_000 });

		// oj-market 组含 24 个工具 → 至少一个分组表出分页条且存在第 2 页
		const pagination = page.locator(".ant-pagination").first();
		await expect(pagination).toBeVisible();
		const page2 = pagination.locator(".ant-pagination-item-2");
		if (await page2.count() > 0) {
			await page2.click();
			await expect(pagination.locator(".ant-pagination-item-active")).toHaveText("2");
		}
	});
});
