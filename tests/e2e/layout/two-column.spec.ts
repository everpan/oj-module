import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";

test.describe("two-column sidebar", () => {
	// S7：双列导航回归（2026-10-20）。底槽仅存在于侧边导航（layout-sidebar），
	// 双列导航第二列不做底槽——曾因底槽渲染 bottomNavItems 导致「系统管理」
	// 在第二列重复出现（子菜单列表 + 底槽组各一份）。切换偏好到双列导航后断言：
	// aside 内只有两棵菜单树、/system 全栏只出现一次、第二列子菜单正常列出可点。
	test("S7: 双列导航第二列无底槽，系统管理子菜单正常列出", async ({ page }) => {
		await enterApp(page);
		await page.evaluate(() => {
			const key = Object.keys(localStorage).find(k => k.includes("preferences"));
			if (!key)
				throw new Error("preferences storage not found");
			const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
			raw.state = { ...raw.state, navigationStyle: "two-column-navigation" };
			localStorage.setItem(key, JSON.stringify(raw));
		});
		await page.reload();
		await expect(page.locator("header")).toBeVisible();
		const aside = page.locator("aside");
		await expect(aside.locator(".ant-menu-root").first()).toBeVisible();

		// aside 内只有两棵菜单树：第一列根列表 + 第二列子菜单（bug 态会有第三棵底槽树）
		const roots = aside.locator(".ant-menu-root");
		await expect(roots).toHaveCount(2);

		// /system 在整个侧栏只出现一次（第一列根条目，children 已剥离为叶子）
		await expect(aside.locator("[data-menu-id$=\"/system\"]")).toHaveCount(1);

		// 点第一列 /system → 第二列正常列出子菜单，且无重复的系统管理组
		await aside.locator("li[data-menu-id$=\"/system\"]").click();
		const secondColumn = roots.nth(1);
		await expect(secondColumn.locator("li[data-menu-id$=\"/system/user\"]")).toBeVisible();
		await expect(secondColumn.locator("[data-menu-id$=\"/system\"]")).toHaveCount(0);
		await secondColumn.locator("li[data-menu-id$=\"/system/user\"]").click();
		await expect.poll(() => new URL(page.url()).pathname, { timeout: 5000 }).toBe("/system/user");
	});
});
