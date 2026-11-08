import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 我的资料入库（templates e2e）：表单提交 → POST /api/personal-center/profile 落库 →
 * user-info 重拉回显。修复前 handleFinish 只弹 toast 不发请求，改完刷新即丢。
 *
 * 该页 ProForm 的 email / phoneNumber 是 required（产品设定，不是测试约定），
 * 而 seed 里的 admin 两列皆空 —— 不填就卡在校验上，onFinish 不会触发。
 * 这里按「用户真实操作」把必填项补齐，值固定以保证幂等（会写回 admin 行）。
 */
test.describe("我的资料（templates）", () => {
	test.beforeEach(async ({ page }) => {
		await enterTemplateApp(page);
	});

	test("P1: 用户名只读不可修改", async ({ page }) => {
		await page.goto("/personal-center/my-profile");
		await expect(page.locator("form").first()).toBeVisible();

		const usernameInput = page.getByLabel("用户名");
		await expect(usernameInput).toBeVisible();
		await expect(usernameInput).toBeDisabled();
		await expect(usernameInput).toHaveValue("admin");
	});

	test("P1: 头像与 header 一致不出现 vercel 兜底图", async ({ page }) => {
		await page.goto("/personal-center/my-profile");
		await expect(page.locator("form").first()).toBeVisible();

		// seed admin 无头像：header 与资料页都应回退到图标态，不出现凭空兜底图
		// （限定 form 作用域：通知 seed 数据也用 vercel 图，但仅在通知弹层渲染）
		await expect(page.locator("form img[src*='avatar.vercel.sh']")).toHaveCount(0);
		await expect(page.locator(".ant-avatar .anticon-user").first()).toBeVisible();
	});

	test("P1: 编辑个人简介保存后持久化", async ({ page }) => {
		const desc = `e2e-desc-${Date.now()}`;
		await page.goto("/personal-center/my-profile");
		await expect(page.locator("form").first()).toBeVisible();

		await page.getByLabel("邮箱").fill("admin@e2e.local");
		await page.getByLabel("联系电话").fill("13800138000");
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
