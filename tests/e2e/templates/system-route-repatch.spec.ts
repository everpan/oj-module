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
 * 角色空）→ 放行后 SPA 重新登录 → 断言 /system/framework/users 渲染用户管理页。
 */

/** SPA 内导航（不触发整页重载）：pushState + popstate，react-router 据此换页 */
async function spaGoto(page: import("@playwright/test").Page, path: string): Promise<void> {
	await page.evaluate((p) => {
		history.pushState(null, "", p);
		window.dispatchEvent(new PopStateEvent("popstate"));
	}, path);
}

test.describe("system 模块路由登录后重登记（templates）", () => {
	test("Boot 期 user-info 失败后 SPA 重新登录，/system/framework/users 仍可达（不再落 404 兜底）", async ({ page }) => {
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
		await password.fill("aA123456");
		await page.locator("form button[type=\"submit\"]").first().click();
		await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });

		// 4) 菜单里系统管理回来（access store 已重登记）
		await expect(page.locator("body")).toContainText("系统管理", { timeout: 10_000 });

		// 5) SPA 直达 /system/framework/users：路由表必须已按新角色重登记，渲染用户管理页
		//    而非 catch-all 404「返回首页」
		await spaGoto(page, "/system/framework/users");
		await expect(page.locator("body")).toContainText("用户管理", { timeout: 10_000 });
		await expect(page.locator("body")).not.toContainText("返回首页");
	});

	/**
	 * 路由级角色子项（站点设置/企微集成）在 SPA 登录后可达（0.2.54 回归）。
	 *
	 * Boot 期无 token → shell 播种演示角色 admin → 按 admin 过滤出 /system（不含
	 * 超管专属子项）并建表；随后 superadmin 登录只调 patchRoutes（只增不删），
	 * 同 path 的旧 /system 表遮蔽新表 → 菜单有子项、点击落 catch-all 404。
	 * 修复：重登记先 _internalSetRoutes 重建根再补子树（按当前角色整棵替换）。
	 */
	test("superadmin SPA 登录后，站点设置 / 企微集成 可点开而非 404", async ({ page }) => {
		await enterTemplateApp(page, { username: "superadmin" });
		await page.getByText("系统管理", { exact: true }).first().click();

		const settings = page.getByText("站点设置", { exact: true }).first();
		await expect(settings).toBeVisible({ timeout: 10_000 });
		await settings.click();
		await expect(page.locator("body")).toContainText("站点标题", { timeout: 10_000 });
		await expect(page.locator("body")).not.toContainText("返回首页");

		const wecom = page.getByText("企微集成", { exact: true }).first();
		await expect(wecom).toBeVisible({ timeout: 10_000 });
		await wecom.click();
		await expect(page.locator("body")).toContainText("部署配置自检", { timeout: 10_000 });
		await expect(page.locator("body")).not.toContainText("返回首页");
	});
});
