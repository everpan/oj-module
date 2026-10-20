import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";

test.describe("sidebar", () => {
	test.beforeEach(async ({ page }) => {
		await enterApp(page);
	});

	// S1：布局 chrome 齐全且菜单非空（HANDOFF §4 闭环用例）
	test("S1: 布局 chrome 渲染且菜单非空", async ({ page }) => {
		await expect(page.locator("header")).toBeVisible();
		await expect(page.locator("aside")).toBeVisible();
		await expect(page.locator("main")).toBeVisible();
		// 2026-10-20 起侧边栏可有底部固定区（第二个 .ant-menu-root）：锚定主菜单
		await expect(page.locator(".ant-menu-root").first()).toBeVisible();
		await expect(page.locator(".ant-menu-root .ant-menu-item")).not.toHaveCount(0);
	});

	// S2/S3：折叠触发器收起再展开（aside 无 collapsed 类，折叠态体现在宽度与菜单 inline-collapsed）
	test("S2-S3: 侧栏折叠与恢复", async ({ page }) => {
		const sider = page.locator("aside");
		// 2026-10-20 起可能存在底部固定区菜单（第二个 .ant-menu-root）：折叠断言锚定主菜单
		const menu = page.locator(".ant-menu-root").first();
		const widthBefore = await sider.evaluate(el => el.getBoundingClientRect().width);
		// PC 端折叠触发器在侧栏底部 SiderTrigger（header 内的折叠按钮仅移动端渲染）
		const trigger = page.locator("aside button:has(.anticon-menu-fold), aside button:has(.anticon-menu-unfold)");
		await trigger.first().click();
		await expect(menu).toHaveClass(/ant-menu-inline-collapsed/);
		// 宽度经 transition 过渡（~300ms），轮询至收敛，避免读到过渡中间值
		await expect.poll(async () => sider.evaluate(el => el.getBoundingClientRect().width), { timeout: 3000 }).toBeLessThan(widthBefore);
		await trigger.first().click();
		await expect(menu).not.toHaveClass(/ant-menu-inline-collapsed/);
		await expect.poll(async () => sider.evaluate(el => el.getBoundingClientRect().width), { timeout: 3000 }).toBe(widthBefore);
	});

	// S4：当前路由对应菜单项高亮、父级 submenu 展开
	test("S4: 菜单选中态跟随路由", async ({ page }) => {
		await expect(page.locator(".ant-menu-item-selected, .ant-menu-submenu-selected").first()).toBeVisible();
	});

	// S5：submenu 点击只展开/收起，不跳转
	test("S5: submenu 展开不跳转", async ({ page }) => {
		const submenuTitle = page.locator(".ant-menu-submenu-title").first();
		test.skip(await submenuTitle.count() === 0, "当前环境无 submenu");
		const urlBefore = page.url();
		await submenuTitle.click();
		await page.waitForTimeout(500); // 展开动画
		expect(page.url()).toBe(urlBefore);
	});

	// S6：底部固定区（order < 0，2026-10-20）。system 模块 order=-100，
	// DOM 上出现第二个 .ant-menu-root（底槽，空表不渲染）：/system 组只出现在
	// 底槽，且底槽 pin 在主菜单之后、SiderTrigger 之上。
	test("S6: 底部固定区菜单 pin 在侧栏底部", async ({ page }) => {
		const sider = page.locator("aside");
		const roots = page.locator("aside .ant-menu-root");
		await expect(roots).toHaveCount(2);
		const mainMenu = roots.nth(0);
		const bottomMenu = roots.nth(1);

		// /system 组只出现在底部区（antd 6：submenu 的 data-menu-id 在标题 div 上）
		await expect(bottomMenu.locator("[data-menu-id$=\"/system\"]")).toBeVisible();
		expect(await mainMenu.locator("[data-menu-id$=\"/system\"]").count()).toBe(0);

		// 几何断言：底槽在主菜单之下，且底边紧靠侧栏底部（只隔 SiderTrigger）
		const asideBox = await sider.boundingBox();
		const mainBox = await mainMenu.boundingBox();
		const bottomBox = await bottomMenu.boundingBox();
		expect(bottomBox!.y).toBeGreaterThan(mainBox!.y);
		const gapToAsideBottom = asideBox!.y + asideBox!.height - (bottomBox!.y + bottomBox!.height);
		expect(gapToAsideBottom).toBeLessThanOrEqual(60);

		// 底部区条目走完整数据链路：展开组 → 点子项跳转（submenu 标题只展开不导航）
		await bottomMenu.locator(".ant-menu-submenu-title[data-menu-id$=\"/system\"]").click();
		await page.waitForTimeout(300); // 展开动画
		await bottomMenu.locator("li[data-menu-id$=\"/system/user\"]").click();
		await expect.poll(() => new URL(page.url()).pathname, { timeout: 5000 }).toBe("/system/user");
	});
});
