import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";

test.describe("icons-images", () => {
	test.beforeEach(async ({ page }) => {
		await enterApp(page);
	});

	// I1：图标渲染——header 操作区图标与菜单图标均为真实 <svg>，不是空白占位。
	// 不写死图标名与数量上限（数据驱动：随功能增减自动适应）
	test("I1: header 与菜单图标渲染为 svg", async ({ page }) => {
		const headerIcons = page.locator("header .anticon");
		await expect(headerIcons.first()).toBeVisible();
		const headerCount = await headerIcons.count();
		expect(headerCount, "header 应有多个功能图标").toBeGreaterThanOrEqual(3);
		for (let i = 0; i < headerCount; i++) {
			await expect(headerIcons.nth(i).locator("svg")).toBeVisible();
		}
		// 菜单组图标（顶层条目均有 handle.icon，两环境皆然）
		await expect(page.locator(".ant-menu-root .anticon").first()).toBeVisible();
	});

	// I2：图片加载——无「渲染了 img 却没有 src」的空图（曾因 userStore.avatar=""
	// 使 antd Avatar 渲染 <img src=""> 而全空白），logo data-url 图片真实解码。
	// 外链图片仅要求有 src：假数据头像可能是外网 URL，不作网络加载断言（CI 无网不假红）
	test("I2: 页面图片有效加载且无空 src 图片", async ({ page }) => {
		const emptyImgs = page.locator("img[src=\"\"], img:not([src])");
		await expect(emptyImgs).toHaveCount(0);
		const logo = page.locator("img[alt=\"logo\"]");
		await expect(logo).toBeVisible();
		await expect.poll(async () =>
			logo.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0),
		).toBe(true);
		const external = page.locator("img[src^=\"http\"]");
		const extCount = await external.count();
		for (let i = 0; i < extCount; i++) {
			const src = await external.nth(i).getAttribute("src");
			expect(src, "外链图片应有 src").toBeTruthy();
		}
	});

	// I3：favicon——宿主 HTML 声明图标且资源可达（曾整链缺失：shell/index.html
	// 无 link、dist 无文件、ojm dev 无路由）
	test("I3: favicon 声明且可加载", async ({ page }) => {
		const link = page.locator("link[rel~=\"icon\"]").first();
		await expect(link).toHaveCount(1);
		const href = await link.getAttribute("href");
		expect(href, "favicon href 应存在").toBeTruthy();
		const res = await page.request.get(new URL(href ?? "", page.url()).toString());
		expect(res.ok(), `favicon 请求应成功：${res.status()}`).toBe(true);
		expect(res.headers()["content-type"]).toMatch(/^image\//);
	});
});
