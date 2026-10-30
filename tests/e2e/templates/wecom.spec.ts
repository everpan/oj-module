import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { enterTemplateApp, execSql } from "../fixtures/enter-template-app";

/**
 * 企微代开发的前端链路（计划 Phase 4「真实套件跑通」的浏览器侧）。
 *
 * 真套件（企微服务商后台）跑不了自动化，但**浏览器这一侧的行为**可以钉死：
 *   · 登录页按 `wecom.enabled` 长出「企业微信」方式，提交后把企业代码带到授权入口；
 *   · `/login?wecom_ticket=&tenant=` 落地页自动换票并进主界面（票据租户即会话租户）；
 *   · 票据无效时给明确文案、且不把用户困住（还能改用账号密码）；
 *   · 代开发后台只对超管开放（非超管渲染「无权限」而非空表——空表会让人以为没数据）。
 *
 * 票据表 `wecom_login_ticket` 是**共享表**（`tenant: false`），只存 sha256：这里按同口径
 * 直接投一行，等价于「callback 刚签发过一张票」，不伪造企微上游。
 */

/** 用例专用的企业代码（= tenant_id，`tenantOfCorp` 恒等映射） */
const CORP = "ww_e2e";
const WECOM_USER = "wecom:e2e-zhangsan";

function sha256Hex(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

function setWecomEnabled(on: boolean): void {
	execSql(`UPDATE sys_setting SET value='${on ? "1" : "0"}' WHERE key='wecom.enabled';`);
}

/** 投一张有效票（幂等：先清同 hash 的旧行），返回明文票据 */
function seedTicket(raw: string, uid: number): void {
	const now = Math.floor(Date.now() / 1000);
	execSql(`DELETE FROM wecom_login_ticket WHERE ticket_hash='${sha256Hex(raw)}';
		INSERT INTO wecom_login_ticket (ticket_hash, uid, owner_tenant, expires_at, used, created_at)
		VALUES ('${sha256Hex(raw)}', ${uid}, '${CORP}', ${now + 300}, 0, ${now});`);
}

/** 造一个企微来源的外部号（同租户内幂等），返回 uid */
function seedWecomUser(): number {
	const out = execSql(`DELETE FROM users WHERE tenant_id='${CORP}' AND username='${WECOM_USER}';
		INSERT INTO users (tenant_id, username, password_hash, source, display_name)
		VALUES ('${CORP}', '${WECOM_USER}', 'x', 'wecom', '张三');
		SELECT last_insert_rowid();`);
	return Number(out.trim().split("\n").pop());
}

test.describe("企微登录（templates）", () => {
	test.beforeAll(() => {
		setWecomEnabled(true);
	});

	// 后置复原：其他 spec 的登录页断言（单表单、无 tab）依赖 wecom 关闭
	test.afterAll(() => {
		setWecomEnabled(false);
	});

	test("W1: 登录页出现企业微信方式，提交后带企业代码跳授权入口", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("form").first()).toBeVisible({ timeout: 15_000 });

		await page.getByRole("tab", { name: "企业微信" }).click();
		await page.getByLabel("企业代码").fill(CORP);

		// 整页跳转（window.location.assign）：这里断言「带对了 corp」，
		// 响应是 400「企业微信未配置」——本机 dev 没配套件凭据，正是要覆盖的运维事故面
		const authorized = page.waitForRequest(req => req.url().includes("/api/auth/wecom/login"));
		await page.getByRole("button", { name: "使用企业微信登录" }).click();
		const url = new URL((await authorized).url());
		expect(url.pathname).toContain("/api/auth/wecom/login");
		expect(url.searchParams.get("corp")).toBe(CORP);
	});

	test("W2: ?wecom_ticket= 落地自动换票进主界面，且租户落成票据所属企业", async ({ page }) => {
		const raw = `e2e${Date.now()}${"0".repeat(32)}`;
		seedTicket(raw, seedWecomUser());

		await page.goto(`/login?wecom_ticket=${raw}&tenant=${CORP}`);
		await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });
		// 登录表单应已消失（换票成功 → 跳主界面）
		await expect(page.locator("form input[type=\"password\"]")).toHaveCount(0);
		// 票据里的租户是权威值：落地页要先写 store，后续请求才带得对
		const stored = await page.evaluate(() => window.localStorage.getItem("oj-tenant"));
		expect(stored ?? "").toContain(CORP);
	});

	test("W3: 票据无效 → 明确文案，且仍可改用账号密码登录", async ({ page }) => {
		await page.goto(`/login?wecom_ticket=${"f".repeat(64)}&tenant=${CORP}`);
		await expect(page.locator(".ant-alert")).toContainText("登录票据无效或已使用", { timeout: 20_000 });
		// 不把人困在错误页：tab 仍在，切回账号密码就能继续
		await expect(page.getByRole("tab", { name: "账号密码" })).toBeVisible();
	});
});

test.describe("代开发后台（templates）", () => {
	test("W4: 非超管进入 /system/wecom 渲染「无权限」，不是空表", async ({ page }) => {
		await enterTemplateApp(page);
		await page.goto("/system/wecom");
		await expect(page.getByText("无权限")).toBeVisible({ timeout: 20_000 });
		// 空表会让人以为「只是还没企业授权」，这里必须没有表格
		await expect(page.getByRole("button", { name: "生成开通链接" })).toHaveCount(0);
	});

	test("W5: 超管看到开通入口与已开通清单", async ({ page }) => {
		await enterTemplateApp(page, { username: "superadmin" });
		await page.goto("/system/wecom");
		await expect(page.getByRole("button", { name: "生成开通链接" })).toBeVisible({ timeout: 20_000 });
		// exact：空表占位文案「暂无已开通企业」也含这四个字，模糊匹配会撞 strict mode
		await expect(page.getByText("已开通企业", { exact: true })).toBeVisible();
	});
});
