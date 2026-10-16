// system 管理前端模板模块的浏览器验收冒烟（规格 §7 验收标准的可复跑证据）。
//
// 前置（一次性，见 docs/plans/2026-10-16-system-admin-handover.md §6）：
//   临时工程已 `ojm init`，已 `oj openapi` + `ojm api` 生成 __client，
//   `pnpm dev` 起在 http://localhost:5174，后端 db 处于**初始 seed 态**
//   （仅 admin/123456 且 must_change=1；本脚本会改密并建号，跑完须重置 db 才能复跑）。
//
// 用法：node scripts/smoke-system-admin.mjs [base]         # 默认 http://localhost:5174
//
// 覆盖：AC1-27 must_change 悬挂期引导改密 → 6 页可用 → 建号表单校验 →
//       成员资格（superadmin 入口/保存/回显）→ 自操作禁用 → 操作日志 →
//       非管理员路由级拒绝 + 菜单不可见。
import process from "node:process";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:5174";
const rows = [];
let failed = 0;
function ok(name, pass, extra = "") {
	if (!pass)
		failed++;
	rows.push(`${pass ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
}

async function login(page, username, password) {
	await page.goto(`${BASE}/login`);
	await page.locator("#username").fill(username);
	await page.locator("input[type=\"password\"]").first().fill(password);
	await page.locator("button[type=\"submit\"]").click();
	await page.waitForURL(u => !String(u).includes("/login"), { timeout: 15000 });
}

async function changePassword(page, oldPwd, newPwd) {
	await page.locator("input[type=\"password\"]").nth(0).fill(oldPwd);
	await page.locator("input[type=\"password\"]").nth(1).fill(newPwd);
	await page.locator("input[type=\"password\"]").nth(2).fill(newPwd);
	await page.locator("button[type=\"submit\"]").click();
	await page.waitForTimeout(2000);
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(15000);

try {
	// AC1-27：首登 must_change 悬挂期，任何管理端点 403 → 页面渲染引导卡而非错误边界
	await login(page, "admin", "123456");
	await page.goto(`${BASE}/system/users`);
	const guidedBtn = page.getByRole("button", { name: /去修改密码|Change password/ });
	let guided = false;
	try {
		await guidedBtn.waitFor({ state: "visible", timeout: 12000 });
		guided = true;
	}
	catch {}
	ok("AC1-27 must_change 引导面板", guided, page.url());

	if (guided)
		await guidedBtn.click();
	await page.waitForURL(u => String(u).includes("/change-password"), { timeout: 10000 });
	await changePassword(page, "123456", "admin888");
	ok("改密后回登录页（旧会话吊销）", page.url().includes("/login"), page.url());

	// AC1-3/7：新密码重登 → 菜单 + 6 页可用
	await login(page, "admin", "admin888");
	await page.goto(`${BASE}/home`);
	await page.waitForTimeout(1200);
	ok("菜单含系统管理", (await page.getByText(/^(系统管理|System)$/).count()) > 0);

	for (const [path, re] of [
		["/system/users", /用户名|Username/],
		["/system/roles", /superadmin|超级管理员/],
		["/system/oplog", /user\.create|action/i],
		["/system/settings", /站点标题|Site Title/],
		["/system/login-methods", /本地口令|Local/],
	]) {
		await page.goto(`${BASE}${path}`);
		await page.waitForTimeout(1500);
		ok(`页面 ${path}`, (await page.getByText(re).first().count().catch(() => 0)) > 0);
	}

	// AC1-1：建号（短密码前端拦截 + 成功落表）
	await page.goto(`${BASE}/system/users`);
	await page.waitForTimeout(1200);
	await page.locator("button").filter({ hasText: /建号|Create User/ }).first().click();
	const dlg = page.locator(".ant-modal").last();
	await dlg.locator("#username").fill("user1");
	await dlg.locator("input[type=\"password\"]").fill("123");
	await dlg.locator("button.ant-btn-primary").click();
	await page.waitForTimeout(800);
	ok("短密码被前端校验拦截", (await dlg.locator(".ant-form-item-explain-error").count()) > 0);
	await dlg.locator("input[type=\"password\"]").fill("user123");
	await dlg.locator("button.ant-btn-primary").click();
	await page.waitForTimeout(2000);
	ok("建号 user1 出现于列表", (await page.locator("tr", { hasText: "user1" }).count()) > 0);

	// AC1-7：成员资格仅 superadmin 可见入口，整集替换生效并回显
	const memberBtn = page.locator("tr", { hasText: "user1" }).getByRole("button", { name: /成员资格|Membership/ });
	ok("superadmin 见成员资格入口", (await memberBtn.count()) > 0);
	if (await memberBtn.count()) {
		await memberBtn.click();
		await page.waitForTimeout(1500);
		await page.locator(".ant-checkbox-wrapper").filter({ hasText: "editor" }).click();
		// 注意：antd 两字按钮会渲染成「保 存」，按文本匹配会失手，故按结构取
		await page.locator(".ant-card button.ant-btn-primary").click();
		await page.waitForTimeout(2000);
		ok("成员资格保存回列表", page.url().includes("/system/users"));
		ok("user1 角色列含 editor", (await page.locator("tr", { hasText: "user1" }).getByText("editor").count()) > 0);
	}

	// AC1-1 自操作防护：本人行不给会失败的按钮
	const adminRow = page.locator("tr", { hasText: "admin" }).first();
	ok("本人行重置口令禁用", await adminRow.locator("button").filter({ hasText: /重置口令|Reset/ }).isDisabled().catch(() => false));

	// AC1-4：操作日志有数据
	await page.goto(`${BASE}/system/oplog`);
	await page.waitForTimeout(1800);
	const opRows = await page.locator(".ant-table-tbody tr").count();
	ok("操作日志有记录", opRows > 0 && !(await page.locator(".ant-empty").count()), `rows=${opRows}`);

	// AC1-5/6 + 规格 §4：非管理员（editor）路由级拒绝 + 菜单不可见
	const page2 = await browser.newPage();
	page2.setDefaultTimeout(15000);
	await login(page2, "user1", "user123");
	await page2.goto(`${BASE}/change-password`);
	await page2.waitForTimeout(1000);
	await changePassword(page2, "user123", "user456");
	await login(page2, "user1", "user456");
	await page2.goto(`${BASE}/system/users`);
	await page2.waitForTimeout(1800);
	// B16：角色不符时 /system 路由不注入 → React Router 无匹配落 404；
	// 若路由在而 API 403，则渲染「无权限」面板——两种都算被拒
	const denied = (await page2.getByText(/无权限|Forbidden|404 Not Found/).count()) > 0;
	ok("非 admin 直达 /system 被拒（路由级/页面级）", denied, page2.url());
	ok("非 admin 无系统管理菜单", (await page2.getByText(/^(系统管理|System)$/).count()) === 0);
	await page2.close();
}
catch (e) {
	failed++;
	rows.push(`ABORT ${e.message} @ ${page.url()}`);
}

await browser.close();
console.log(rows.join("\n"));
console.log(`\n${rows.length - failed}/${rows.length} 通过`);
process.exit(failed ? 1 : 0);
