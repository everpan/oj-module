import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 角色/权限控制点多语言展示回归（2026-11-06）。
 *
 * /system/roles 页两块翻译来源：
 * · 角色 tab：builtin 角色名走 `system:rolesPage.roleTitle.<name>`（库内 title 是 seed 中文文本、
 *   title_key 为 null，UI 按 key 实时翻译——R2 的 builtin 分支）；
 * · 权限点 tab：seed 权限点带 title_key（system:perm.*），走 `t(title_key, { defaultValue: code })`
 *   实时翻译（R2 主路径）。
 * 中英文都必须渲染译文、不直出键名。语言切换沿 system-settings-i18n 同口径（localStorage 偏好）。
 */
test.describe("角色/权限页 i18n（templates）", () => {
	test("角色名与权限点在中英文下都渲染译文，不直出键名", async ({ page }) => {
		await enterTemplateApp(page, { username: "superadmin" });
		await page.goto("/system/roles");

		// 中文：角色 tab（superadmin 被展示层隐去，admin 行走 roleTitle.admin 译文）
		await expect(page.locator("body")).toContainText("系统管理员", { timeout: 10_000 });

		// 切到权限点 tab：seed 权限点 title_key 翻译
		await page.getByRole("tab", { name: "权限点" }).click();
		await expect(page.locator("body")).toContainText("组织架构全量读权限");
		await expect(page.locator("body")).not.toContainText("system:perm.platform_org_read_all");

		// 切英文：改偏好持久化里的 language 再重载，不依赖偏好面板 DOM
		await page.evaluate(() => {
			const key = Object.keys(localStorage).find(k => k.endsWith("-preferences"));
			if (!key)
				throw new Error("preferences store key not found");
			const raw = JSON.parse(localStorage.getItem(key)!);
			raw.state = { ...raw.state, language: "en-US" };
			localStorage.setItem(key, JSON.stringify(raw));
		});
		await page.reload();

		await expect(page.locator("body")).toContainText("Administrator", { timeout: 15_000 });
		await page.getByRole("tab", { name: "Permissions", exact: true }).click();
		await expect(page.locator("body")).toContainText("Org directory: read all");
		await expect(page.locator("body")).not.toContainText("system:perm.platform_org_read_all");
	});
});
