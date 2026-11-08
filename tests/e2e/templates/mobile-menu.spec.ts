import { expect, test } from "@playwright/test";

/**
 * iPhone SE 375×667：移动端菜单是「整屏高度 + 遮罩」的 Drawer。
 * 回归：点叶子菜单项后抽屉必须自动收起，否则导航后的页面仍被遮罩盖住
 * （用户实测「菜单占据整个页，对应页面看不见」）。
 *
 * 不复用 enterTemplateApp：它的就绪断言依赖侧栏 .ant-menu li 可见，
 * 而移动端菜单默认收起、DOM 不在页面里，会误判未就绪。
 */
test.describe("移动端菜单（375×667）", () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test("点菜单项后抽屉收起，目标页面可见", async ({ page }) => {
		await page.goto("/");
		const submit = page.locator("form button[type=\"submit\"]").first();
		await expect(submit).toBeVisible({ timeout: 15_000 });
		await page.locator("form input").first().fill("admin");
		await page.locator("form input[type=\"password\"]").fill("aA123456");
		await submit.click();
		// 登录页（fullscreen）也有 header：必须等 pathname 真正落到 /home 再点头部按钮
		// （不能只匹配 URL 字符串——/login?redirect=/home 也会命中 /home$）
		await page.waitForURL(url => url.pathname === "/home", { timeout: 20_000 });
		await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });

		// 打开移动端抽屉
		await page.locator("header button").first().click();
		const drawer = page.locator(".ant-drawer");
		await expect(drawer).toHaveClass(/ant-drawer-open/);
		await expect(page.locator(".ant-drawer-mask")).toBeVisible();

		// 个人中心 → 我的资料（叶子项）
		await drawer.locator(".ant-menu-submenu-title", { hasText: "个人中心" }).click();
		await drawer.locator(".ant-menu-item", { hasText: "我的资料" }).click();

		await expect(page).toHaveURL(/\/personal-center\/my-profile$/);
		await expect(drawer).not.toHaveClass(/ant-drawer-open/);
		await expect(page.locator(".ant-drawer-mask")).toBeHidden();
	});
});
