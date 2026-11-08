import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 主菜单与底部固定菜单同时展开时，底部不能把主菜单压成零高度。
 * 空间不足由两块各自滚动承担，outer aside 不整体滚动、不互相覆盖。
 */
test.describe("侧边栏双菜单滚动", () => {
	test("小视口同时展开后主菜单仍有滚动视口，底部菜单独立滚动", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 300 });
		await enterTemplateApp(page);

		for (const text of ["方案市场", "系统管理", "框架管理"])
			await page.locator("aside .ant-menu-submenu-title", { hasText: text }).click();

		const openSubmenus = page.locator("aside .ant-menu-submenu-open");
		await expect(openSubmenus).toHaveCount(3);
		await expect(openSubmenus.last().locator(":scope > ul")).toBeVisible();
		await expect.poll(() => page.locator("aside").evaluate(aside =>
			aside.getAnimations({ subtree: true }).length,
		)).toBe(0);

		const main = page.locator("aside > div.flex-1");
		const mainScroller = main.locator(".simplebar-content-wrapper");
		const geometry = await main.evaluate((mainEl) => {
			const bottomEl = mainEl.nextElementSibling;
			const scroller = mainEl.querySelector(".simplebar-content-wrapper");
			if (!(bottomEl instanceof HTMLElement) || !(scroller instanceof HTMLElement))
				throw new Error("侧栏主/底菜单结构不完整");
			const mainRect = mainEl.getBoundingClientRect();
			const bottomRect = bottomEl.getBoundingClientRect();
			const bottomStyle = getComputedStyle(bottomEl);
			return {
				mainHeight: mainRect.height,
				mainClientHeight: scroller.clientHeight,
				mainScrollHeight: scroller.scrollHeight,
				bottomClientHeight: bottomEl.clientHeight,
				bottomScrollHeight: bottomEl.scrollHeight,
				bottomOverflowY: bottomStyle.overflowY,
				overlap: Math.max(0, Math.min(mainRect.bottom, bottomRect.bottom) - Math.max(mainRect.top, bottomRect.top)),
				asideClientHeight: mainEl.parentElement?.clientHeight,
				asideScrollHeight: mainEl.parentElement?.scrollHeight,
			};
		});

		expect(geometry.mainHeight).toBeGreaterThanOrEqual(40);
		expect(geometry.mainClientHeight).toBeGreaterThanOrEqual(40);
		expect(geometry.mainScrollHeight).toBeGreaterThan(geometry.mainClientHeight);
		expect(geometry.bottomScrollHeight).toBeGreaterThan(geometry.bottomClientHeight);
		expect(["auto", "scroll"]).toContain(geometry.bottomOverflowY);
		expect(geometry.overlap).toBe(0);
		expect(geometry.asideScrollHeight).toBe(geometry.asideClientHeight);

		await mainScroller.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect.poll(() => mainScroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
	});
});
