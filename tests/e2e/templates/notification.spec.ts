import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { apiLogin, enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * 通知中心 / 铃铛互动（templates e2e）：
 * - 清空对广播也生效（2026-10-20 修复：广播本体是共享行，清空落「对我隐藏」标记）；
 * - 「查看所有消息」导航到 /notification-center（N3 落地）；
 * - 类型（notice/pm/mention）Tab 过滤。
 *
 * 数据前置：globalSetup 归一 admin；beforeAll 经 API 推送三类通知各一条——
 * 类型过滤断言只要求「所推类型至少 1 条且标签一致」，对种子/历史残留数据容差。
 */
test.describe.serial("通知中心（templates）", () => {
	let token: string;

	async function openBell(page: Page) {
		await page.locator("header button:has(.anticon-bell)").click();
		const popover = page.locator(".ant-popover");
		await expect(popover).toBeVisible();
		await expect(popover.locator(".ant-list-item").first()).toBeVisible({ timeout: 10_000 });
		return popover;
	}

	test.beforeAll(async ({ browser }) => {
		const page = await browser.newPage();
		token = await apiLogin(page);
		// 三类各推一条（广播归 notice；按人 push 缺省收件人 = 当前用户）
		await page.request.post("/api/notification/push-broadcast", {
			headers: { Authorization: `Bearer ${token}` },
			data: { title: "e2e-类型-通知", message: "broadcast notice", category: "notice" },
		});
		await page.request.post("/api/notification/push", {
			headers: { Authorization: `Bearer ${token}` },
			data: { title: "e2e-类型-私信", message: "personal pm", category: "pm" },
		});
		await page.request.post("/api/notification/push", {
			headers: { Authorization: `Bearer ${token}` },
			data: { title: "e2e-类型-艾特", message: "personal mention", category: "mention" },
		});
		await page.close();
	});

	test.beforeEach(async ({ page }) => {
		await enterTemplateApp(page);
	});

	// N1：铃铛弹层——条目渲染 + 类别标签（修复点：消息按类型区分）
	test("N1: 铃铛弹层展示通知与类别标签", async ({ page }) => {
		const popover = await openBell(page);
		// 弹层上限 50 条，种子/历史残留可容忍；三条推送必须可见且各带类别标签
		const items = popover.locator(".ant-list-item");
		expect(await items.count()).toBeGreaterThanOrEqual(3);
		// 三条推送各带类别标签（通知/私信/@我）；多次运行会重复推送同名条目，取 first 容差
		await expect(popover.locator(".ant-list-item", { hasText: "e2e-类型-通知" }).locator(".ant-tag").first()).toHaveText(/通知/);
		await expect(popover.locator(".ant-list-item", { hasText: "e2e-类型-私信" }).locator(".ant-tag").first()).toHaveText(/私信/);
		await expect(popover.locator(".ant-list-item", { hasText: "e2e-类型-艾特" }).locator(".ant-tag").first()).toHaveText(/@我/);
	});

	// N2：「查看所有消息」跳转通知中心页（修复点：viewAll 接线 + 页面落地）
	test("N2: 查看所有消息跳转通知中心", async ({ page }) => {
		const popover = await openBell(page);
		await popover.locator(".ant-list-footer button").last().click();
		await page.waitForURL("**/notification-center");
		await expect(page.locator(".ant-segmented")).toBeVisible();
		await expect(page.locator(".ant-list-item").first()).toBeVisible();
	});

	// N3：类型 Tab 过滤（修复点：消息未按类型区分）
	test("N3: 通知中心按类型过滤", async ({ page }) => {
		await page.goto("/notification-center");
		await expect(page.locator(".ant-segmented")).toBeVisible();
		await expect(page.locator(".ant-list-item").first()).toBeVisible({ timeout: 10_000 });

		await page.locator(".ant-segmented-item", { hasText: "私信" }).click();
		await expect(page.locator(".ant-list-item").first()).toBeVisible();
		// 可见过滤后条目全部带「私信」标签
		const tags = page.locator(".ant-list-item .ant-tag");
		const count = await tags.count();
		expect(count).toBeGreaterThanOrEqual(1);
		for (let i = 0; i < count; i++)
			await expect(tags.nth(i)).toHaveText(/私信/);

		await page.locator(".ant-segmented-item", { hasText: "@我" }).click();
		await expect(page.locator(".ant-list-item", { hasText: "e2e-类型-艾特" }).first()).toBeVisible();

		await page.locator(".ant-segmented-item", { hasText: "通知" }).first().click();
		await expect(page.locator(".ant-list-item", { hasText: "e2e-类型-通知" }).first()).toBeVisible();
	});

	// N4：清空——按人与广播全部消失（修复点：清空不起效——广播项残留）
	test("N4: 清空后弹层与中心页均无残留", async ({ page }) => {
		await page.goto("/notification-center");
		await expect(page.locator(".ant-list-item").first()).toBeVisible({ timeout: 10_000 });
		await page.locator("button", { hasText: "清空" }).click();
		// antd v6 Popconfirm 渲染在 popover 容器内；确认按钮文案随 locale（中文「确 定」/英文「OK」）
		await page.getByRole("button", { name: /^(OK|确\s*定)$/ }).click();
		await expect(page.locator(".ant-empty")).toBeVisible({ timeout: 10_000 });

		// 弹层同口径：铃铛列表为空（排除清空确认弹窗——其容器同为 .ant-popover 且此刻正在退场）
		await page.locator("header button:has(.anticon-bell)").click();
		const popover = page.locator(".ant-popover:not(.ant-popconfirm)");
		await expect(popover).toBeVisible();
		await expect(popover.locator(".ant-list-item")).toHaveCount(0);
	});
});
