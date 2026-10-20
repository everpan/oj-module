import type { Locator, Page } from "@playwright/test";

/**
 * 菜单交互 fixtures。
 *
 * 关键事实（legacy=411e353b 与 playground 共同适用）：
 * - antd 收起态不挂载子项——叶子项必须在其 submenu 展开后才进入 DOM；
 * - legacy 默认手风琴模式（preferences.accordion=true，同层互斥、祖先保留），
 *   「全部同时展开」在该环境下不可能成立，全量遍历必须逐组访问；
 * - 只点「当前可见」的 submenu title——隐藏容器里的 title 不可见，
 *   点它会卡 actionability 30s 直至用例超时。
 */

const settle = (page: Page) => page.waitForTimeout(250); // 展开动画 + 子项挂载

/**
 * 递归遍历所有叶子菜单项（深度优先，手风琴安全）：
 * 先访问本组已挂载的叶子，再逐个打开嵌套子组继续下钻。
 * 手风琴会关闭同层兄弟，但兄弟的叶子必然已被访问（先叶后组的顺序保证）。
 *
 * shouldVisit 返回 false 的项不点击（默认全访问）。用于已知存量缺陷页：
 * 崩溃页会替换整棵路由树并毒化同一会话内的后续遍历（菜单 locator 失效），
 * 必须完全跳过点击，而非仅跳过断言。
 */
async function visitUlChildren(
	page: Page,
	ul: Locator,
	visit: (item: Locator) => Promise<void>,
	shouldVisit: (item: Locator) => Promise<boolean>,
): Promise<void> {
	const items = ul.locator("> li.ant-menu-item");
	const itemCount = await items.count();
	for (let i = 0; i < itemCount; i++) {
		const item = items.nth(i);
		if (await shouldVisit(item))
			await visit(item);
	}

	const groups = ul.locator("> li.ant-menu-submenu");
	const groupCount = await groups.count();
	for (let gi = 0; gi < groupCount; gi++) {
		const group = groups.nth(gi);
		// 当前路由所在组常已自动展开，点击反而会收起（同 openFirstMenuGroup 的教训）
		const isOpen = await group.evaluate(el => el.classList.contains("ant-menu-submenu-open"));
		if (!isOpen) {
			await group.locator("> .ant-menu-submenu-title").click();
			await settle(page);
		}
		await visitUlChildren(page, group.locator("> ul"), visit, shouldVisit);
	}
}

/**
 * 深度优先访问菜单树上每个根菜单的叶子项（M1/M2/M3 用）。
 * 2026-10-20 起侧边栏有底部固定区（order<0）——DOM 上出现第二个 .ant-menu-root
 * （空表不渲染），逐根遍历而非单根假设。
 */
export async function visitEveryMenuItem(
	page: Page,
	visit: (item: Locator) => Promise<void>,
	shouldVisit: (item: Locator) => Promise<boolean> = async () => true,
): Promise<void> {
	const roots = page.locator(".ant-menu-root");
	const rootCount = await roots.count();
	for (let i = 0; i < rootCount; i++) {
		await visitUlChildren(page, roots.nth(i), visit, shouldVisit);
	}
}

/**
 * 从菜单项 DOM 提取路由路径（data-menu-id 形如 "rc-menu-uuid-/system/user"）。
 * 与 e2e 侧 KNOWN_BROKEN_ROUTES 豁免表配合使用。
 */
export async function getItemRoutePath(item: Locator): Promise<string> {
	const id = await item.getAttribute("data-menu-id");
	return (id ?? "").replace(/^rc-menu-uuid-/, "");
}

/**
 * 打开第一个顶层组并展开其嵌套子组，使该组的叶子项进入 DOM。
 * tabbar 用例只需「连续可点的两三个叶子」，无需全量展开；
 * playground 首组即唯一组（demo），legacy 首组含多个叶子，均满足。
 */
export async function openFirstMenuGroup(page: Page): Promise<void> {
	const first = page.locator(".ant-menu-root > li.ant-menu-submenu").first();
	// 当前路由所在组常被自动展开——此时点击会把它收起（T2-T5 全挂的教训），仅未展开时点击
	const isOpen = await first.evaluate(el => el.classList.contains("ant-menu-submenu-open"));
	if (!isOpen) {
		await first.locator("> .ant-menu-submenu-title").click();
		await settle(page);
	}
	for (let guard = 0; guard < 10; guard++) {
		const nested = first
			.locator("li.ant-menu-submenu:not(.ant-menu-submenu-open) > .ant-menu-submenu-title")
			.filter({ visible: true })
			.first();
		if (await nested.count() === 0)
			return;
		await nested.click();
		await settle(page);
	}
}
