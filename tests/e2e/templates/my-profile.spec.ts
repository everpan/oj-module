import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 我的资料入库（templates e2e）：表单提交 → POST /api/personal-center/profile 落库 →
 * user-info 重拉回显。修复前 handleFinish 只弹 toast 不发请求，改完刷新即丢。
 */
test.describe("我的资料（templates）", () => {
	test.beforeEach(async ({ page }) => {
		await enterTemplateApp(page);
	});

	test("P1: 编辑个人简介保存后持久化", async ({ page }) => {
		const desc = `e2e-desc-${Date.now()}`;
		await page.goto("/personal-center/my-profile");
		await expect(page.locator("form").first()).toBeVisible();

		const textarea = page.locator("form textarea").first();
		await textarea.fill(desc);
		await page.locator("button", { hasText: /提\s*交/ }).first().click();
		await expect(page.locator(".ant-message", { hasText: "更新基本信息成功" })).toBeVisible({ timeout: 10_000 });

		// 整页刷新：值须来自服务端（user-info）而非内存 store，即已入库
		await page.reload();
		await expect(page.locator("form").first()).toBeVisible();
		await expect(page.locator("form textarea").first()).toHaveValue(desc, { timeout: 10_000 });
	});
});
