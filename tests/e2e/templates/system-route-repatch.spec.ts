import { expect, test } from "@playwright/test";

import { enterTemplateApp } from "../fixtures/enter-template-app";

/**
 * system 模块路由登录后重登记回归（B16，2026-10-24）。
 *
 * 历史 bug：宿主链（shell）路由表只在 Boot 期按当时角色建一次；Boot 期
 * user-info 失败（后端闪断/过期 token 刷新失败）→ 角色空 → requiredRoles
 * 门禁模块被过滤出路由表；随后 SPA 登录（不刷新页面）只有 access store
 * （菜单）被重登记，渲染用的自建 router 不接收 patchRoutes——菜单回来了，
 * /system/* 仍不在路由表里，直达恒落 catch-all 404「返回首页」，须硬刷新才恢复。
 *
 * 本用例确定性地复刻该时序：先登录拿 token → 掐断 user-info 重载（Boot 期
 * 角色空）→ 放行后 SPA 重新登录 → 断言 /system/users 渲染用户管理页。
 */

/** SPA 内导航（不触发整页重载）：pushState + popstate，react-router 据此换页 */
async function spaGoto(page: import("@playwright/test").Page, path: string): Promise<void> {
	await page.evaluate((p) => {
		history.pushState(null, "", p);
		window.dispatchEvent(new PopStateEvent("popstate"));
	}, path);
}

test.describe("system 模块路由登录后重登记（templates）", () => {
	test("Boot 期 user-info 失败后 SPA 重新登录，/system/users 仍可达（不再落 404 兜底）", async ({ page }) => {
		// 1) 正常登录拿 token（globalSetup 已归一 admin 口令）
		await enterTemplateApp(page);
		await expect(page.locator("header")).toBeVisible();

		// 2) 掐断 user-info 后重载：Boot 期 token 存在但拉取失败 → 角色空 →
		//    /system 不进宿主路由表（复刻故障前置态）
		await page.route("**/api/web/user-info", route => route.abort("failed"));
		await page.reload();
		await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });

		// 3) 放行 user-info，SPA 回到登录页重新登录（全程不刷新页面）
		await page.unroute("**/api/web/user-info");
		await spaGoto(page, "/login");
		const password = page.locator("form input[type=\"password\"]");
		await expect(password).toBeVisible({ timeout: 15_000 });
		await page.locator("form input").first().fill("admin");
		await password.fill("123456");
		await page.locator("form button[type=\"submit\"]").first().click();
		await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });

		// 4) 菜单里系统管理回来（access store 已重登记）
		await expect(page.locator("body")).toContainText("系统管理", { timeout: 10_000 });

		// 5) SPA 直达 /system/users：路由表必须已按新角色重登记，渲染用户管理页
		//    而非 catch-all 404「返回首页」
		await spaGoto(page, "/system/users");
		await expect(page.locator("body")).toContainText("用户管理", { timeout: 10_000 });
		await expect(page.locator("body")).not.toContainText("返回首页");
	});
});
