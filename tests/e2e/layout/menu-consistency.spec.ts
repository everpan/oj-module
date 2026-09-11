import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { enterApp } from "../fixtures/enter-app";
import { getEnv } from "../fixtures/env";
import { getItemRoutePath, visitEveryMenuItem } from "../fixtures/menu";

/** 点击叶子项并消化外链弹页（legacy 外链项 window.open，当前页不导航） */
async function clickItem(page: Page, item: Locator): Promise<void> {
	const urlBefore = page.url();
	await item.click();
	await page.waitForURL(url => url.toString() !== urlBefore, { timeout: 3000 }).catch(() => {});
	for (const popup of page.context().pages()) {
		if (popup !== page)
			await popup.close().catch(() => {});
	}
}

// 存量缺陷豁免登记（显式豁免 ≠ 掩盖，修复后应从此表移除）：
// /personal-center/my-profile 在 importmap 资产链形态（playground 宿主 / App 链
// 生产）渲染崩溃（React #130，受控 Form.Item 链）；App 链 dev 不受影响。
// 三形态对照与取证记录见
// docs/prd/202609010056-playground-full-modules-plan.md 差异项 D2。
const KNOWN_BROKEN_ROUTES = ["/personal-center/my-profile"];

function isKnownBroken(url: string): boolean {
	const path = new URL(url).pathname;
	return KNOWN_BROKEN_ROUTES.some(route => path.endsWith(route));
}

// 遍历层面的豁免：已知崩溃页必须完全跳过点击——崩溃替换整棵路由树，
// 会毒化同一会话内的后续遍历（菜单 locator detached/不可见，连锁超时），
// 仅跳过断言不够。
async function skipKnownBrokenItem(item: Locator): Promise<boolean> {
	const routePath = await getItemRoutePath(item);
	return !KNOWN_BROKEN_ROUTES.some(route => routePath.endsWith(route));
}

/**
 * 内容非空不变量（按页型分派）：
 * - iframe 嵌入页（/outside/embedded/*）：内容载体是跨域 iframe——无文本、
 *   无元素子节点，Playwright 的 toBeEmpty 会把「只含 iframe 的容器」判为
 *   empty（取证：main innerHTML=1658、iframe 稳定在场、textContent=""）。
 *   不变量应为「当前页的 iframe 在场」。不能以 DOM 现状判定页型：KeepAlive
 *   会把已访问 iframe 页的 iframe 留在 DOM（URL 已切走的 403 页也能数到）。
 * - 其余页面：main 非空。
 */
const IFRAME_PAGE_PATTERN = /\/outside\/embedded\//;

async function expectMainRendered(page: Page, url: string): Promise<void> {
	if (IFRAME_PAGE_PATTERN.test(url)) {
		await expect(
			page.locator("main iframe").first(),
			`iframe 缺失：${url}`,
		).toBeVisible();
		return;
	}
	await expect(page.locator("main"), `空 main：${url}`).not.toBeEmpty();
}

test.describe("menu-consistency", () => {
	test.beforeEach(async ({ page }) => {
		await enterApp(page);
	});

	// M1：每个菜单项可点击、URL 变化、内容区非空；数据全来自运行时 DOM。
	// 深度优先逐组访问（legacy 手风琴模式同层互斥，无法全量展开）
	test("M1: 全部菜单项可达且内容非空", async ({ page }) => {
		const { allowBlankRoutes } = getEnv();
		let visited = 0;
		await visitEveryMenuItem(page, async (item) => {
			await clickItem(page, item);
			// legacy 假菜单含无组件路由（/route-nest/menu2），空白属数据特性而非布局缺陷
			const url = page.url();
			if (!allowBlankRoutes && !isKnownBroken(url))
				await expectMainRendered(page, url);
			visited++;
		}, skipKnownBrokenItem);
		expect(visited).toBeGreaterThan(0);
	});

	// M2：菜单项点击后，对应项高亮（当前路由 ↔ 菜单选中态一致）
	test("M2: 当前路由对应菜单项高亮", async ({ page }) => {
		let visited = 0;
		await visitEveryMenuItem(page, async (item) => {
			await clickItem(page, item);
			await expect(page.locator(".ant-menu-root .ant-menu-item-selected")).toHaveCount(1);
			visited++;
		}, skipKnownBrokenItem);
		expect(visited).toBeGreaterThan(0);
	});

	// M3：深链接直达（设计矩阵 M2 的「直接 URL 访问」路径，审查补充）。
	// 点击导航与直接加载走的是不同机制：直接加载时选中态依赖 useMatches 的
	// match.id（偏差 1 修复点）与 ojm dev 的 SPA history fallback——此用例
	// 让这两处回归可见。URL 集合 = 初始落地页 + M1 式点击导航到的每个叶子。
	test("M3: 菜单路由深链接直达且高亮不落 404", async ({ page }) => {
		const { allowBlankRoutes } = getEnv();
		const urls = new Set<string>([page.url()]);
		await visitEveryMenuItem(page, async (item) => {
			await clickItem(page, item);
			urls.add(page.url());
		}, skipKnownBrokenItem);
		// legacy 假菜单含指向不存在路由的演示项，点击会落到内置 /exception/404
		// 兜底页——兜底页本身不是「菜单路由直达」不变量的对象（P7.14 已单测覆盖）
		const targets = [...urls].filter(u => !u.includes("/exception/"));
		for (const url of targets) {
			await page.goto(new URL(url).pathname);
			if (isKnownBroken(url))
				continue;
			// 叶子路由：恰 1 个选中 item（antd 会同时给父组挂 submenu-selected，
			// 不计入）；组落地页（index 子路由被直接深链时）：无 item，恰 1 个选中 submenu（同 S4）
			await expect.poll(async () => {
				const items = await page.locator(".ant-menu-root .ant-menu-item-selected").count();
				if (items > 0)
					return items === 1;
				const subs = await page.locator(".ant-menu-root .ant-menu-submenu-selected").count();
				return subs === 1;
			}).toBe(true);
			expect(page.url(), `深链接 ${url} 不应落 404`).not.toContain("/exception/404");
			if (!allowBlankRoutes)
				await expectMainRendered(page, url);
		}
	});
});
