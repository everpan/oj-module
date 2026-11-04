import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 框架层文案 i18n 回归（2026-11-04）。
 *
 * 两处来源不在模板 locale 里，切语言时容易被漏掉：
 * - `FormAvatarItem`（runtime 组件）曾硬编码「更换头像」；
 * - ProForm 的默认操作栏（重置/提交）走 pro-components 自己的 intl，
 *   `ConfigProvider locale` 切了也不生效，需 `ProConfigProvider intl`。
 *
 * 这里用「我的资料」页（同时含头像上传与 ProForm 提交栏）从真实页面钉住：
 * 英文下标签/按钮全英文，中文下仍是中文。
 */
async function switchLanguage(page: import("@playwright/test").Page, language: string) {
	await page.evaluate((lang) => {
		const key = Object.keys(localStorage).find(k => k.endsWith("-preferences"));
		if (!key)
			throw new Error("preferences store key not found");
		const raw = JSON.parse(localStorage.getItem(key)!);
		raw.state = { ...raw.state, language: lang };
		localStorage.setItem(key, JSON.stringify(raw));
	}, language);
	await page.reload();
	await expect(page.locator(".ant-menu li").first()).toBeVisible({ timeout: 15_000 });
}

test.describe("框架层文案 i18n（templates）", () => {
	test("头像按钮与 ProForm 操作栏随语言切换", async ({ page }) => {
		await enterTemplateApp(page);
		await page.goto("/personal-center/my-profile");

		// 中文基线
		await expect(page.getByLabel("邮箱")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByRole("button", { name: "更换头像" })).toBeVisible();
		await expect(page.getByRole("button", { name: /重\s*置/ })).toBeVisible();
		await expect(page.getByRole("button", { name: /提\s*交/ })).toBeVisible();

		await switchLanguage(page, "en-US");
		await page.goto("/personal-center/my-profile");

		await expect(page.getByLabel("Email")).toBeVisible({ timeout: 10_000 });
		await expect(page.getByRole("button", { name: "Change Avatar" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();
	});
});
