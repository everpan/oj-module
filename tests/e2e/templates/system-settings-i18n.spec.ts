import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 站点设置页 i18n 回归（2026-11-04）。
 *
 * 聚合为 `src/app/web` 多根模块后，设置页被重写为简化版：组标题直接渲染
 * `g.group`、语言包漏了 `setting.group.*` 与 `setting.market_cdn_url`，导致中英文
 * 都直出 `general` / `framework.market_cdn_url` 这类键名。本用例从真实页面验证
 * 「组标题 + 设置项标签」两种来源都走翻译，并覆盖英文字典确实被加载。
 */
test.describe("站点设置 i18n（templates）", () => {
	test("框架设置组标题与设置项在中英文下都渲染译文，不直出键名", async ({ page }) => {
		await enterTemplateApp(page, { username: "superadmin" });
		await page.goto("/system/settings");

		// 中文：组标题走 setting.group.*，设置项走 seed 的 label_key
		await expect(page.locator("body")).toContainText("站点标题", { timeout: 10_000 });
		await expect(page.locator("body")).toContainText("常规");
		await expect(page.locator("body")).toContainText("市场 CDN 地址");
		await expect(page.locator("body")).not.toContainText("framework.market_cdn_url");

		// 切英文：直接改偏好持久化里的 language 再重载，不依赖偏好面板 DOM
		await page.evaluate(() => {
			const key = Object.keys(localStorage).find(k => k.endsWith("-preferences"));
			if (!key)
				throw new Error("preferences store key not found");
			const raw = JSON.parse(localStorage.getItem(key)!);
			raw.state = { ...raw.state, language: "en-US" };
			localStorage.setItem(key, JSON.stringify(raw));
		});
		await page.reload();

		await expect(page.locator("body")).toContainText("Site Title", { timeout: 15_000 });
		await expect(page.locator("body")).toContainText("General");
		await expect(page.locator("body")).toContainText("Market CDN URL");
		await expect(page.locator("body")).not.toContainText("framework.market_cdn_url");
	});
});
