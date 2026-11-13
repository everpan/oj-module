import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 个人中心「修改密码」卡片（templates e2e，2026-11-13 增补）：登录态自助改密
 * （PUT /api/auth/password，本人 + 旧口令）。唯一 superadmin 此前无界面入口，本卡片补齐。
 * 成功后后端吊销 refresh 并换发 token，本地必须清会话回登录页（onDone → logout + navigate）。
 *
 * 用 superadmin 演练：先改到临时口令、断言回登录页，再用临时口令登回、改回种子口令，
 * 保证夹具（aA123456）不受影响，后续用例可正常登录。
 */
test.describe("个人中心：修改密码卡片（templates）", () => {
	const ORIGINAL = "aA123456";
	const TEMP = "NewPass123!";

	test.afterEach(async ({ page }, testInfo) => {
		if (testInfo.status !== "passed") {
			await page.screenshot({ path: "/tmp/cp-fail.png", fullPage: true }).catch(() => {});
		}
	});

	test("P1: 提交成功则清会话回登录页，且可改回原口令（夹具不受影响）", async ({ page }) => {
		await enterTemplateApp(page, { username: "superadmin" });
		await page.goto("/personal-center/my-profile");
		await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();

		// 改到临时口令
		await page.getByLabel("当前密码", { exact: true }).fill(ORIGINAL);
		await page.getByLabel("新密码", { exact: true }).fill(TEMP);
		await page.getByLabel("确认新密码", { exact: true }).fill(TEMP);
		await page.getByRole("button", { name: "修改密码" }).click();

		// 清会话 → 回登录页
		await expect(page).toHaveURL(/\/login/);

		// 用临时口令登回（走与首登同一的 enterTemplateApp，等登录表单就绪再填）
		await enterTemplateApp(page, { username: "superadmin", password: TEMP });

		// 改回种子口令，恢复夹具
		await page.goto("/personal-center/my-profile");
		await expect(page).toHaveURL(/\/personal-center\/my-profile/, { timeout: 10_000 });
		await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible({ timeout: 10_000 });
		await page.getByLabel("当前密码", { exact: true }).fill(TEMP);
		await page.getByLabel("新密码", { exact: true }).fill(ORIGINAL);
		await page.getByLabel("确认新密码", { exact: true }).fill(ORIGINAL);
		await page.getByRole("button", { name: "修改密码" }).click();
		await expect(page).toHaveURL(/\/login/);
	});
});
