import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect } from "@playwright/test";

/**
 * 模板工程 dev 服务的 db（本文件位于 tests/e2e/fixtures，上溯三级到仓库根）。
 * 新布局（src/<name>/{api,web}）下 db 与 config.yaml 同在工程根；
 * api/db.sqlite 是旧布局残留，oj 已不读写它，指回去会让归一静默打空。
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const DB_PATH = path.join(REPO_ROOT, "packages/cli/templates/db.sqlite");
const SEED_PATH = path.join(REPO_ROOT, "packages/cli/templates/src/_platform/api/seed.sql");

/**
 * 归一 admin 账号夹具（幂等）：口令重置为种子值（123456）+ 清 must_change +
 * 清登录限流窗口。全新 db 的 admin 是 must_change=1，会弹强制改密阻塞 e2e；
 * 上一轮 e2e 若改过口令，本轮 123456 登不上——都靠这里归一。
 */
export function resetAdminFixture(): void {
	const grep = execFileSync("grep", ["-oE", String.raw`\$2y\$10\$[A-Za-z0-9./]+`, SEED_PATH], { encoding: "utf-8" });
	const hash = grep.split("\n")[0]!.trim();
	execFileSync("sqlite3", [DB_PATH, `UPDATE users SET password_hash='${hash}', must_change=0 WHERE username='admin';`]);
	execFileSync("sqlite3", [DB_PATH, "DELETE FROM sys_login_throttle; DELETE FROM sys_rate_window;"]);
}

/**
 * 进入模板主界面：goto → admin/123456 登录 → 等布局 chrome 就绪。
 * 前置：resetAdminFixture() 已跑（globalSetup）。
 */
export async function enterTemplateApp(page: Page): Promise<void> {
	await page.goto("/");
	const submit = page.locator("form button[type=\"submit\"]").first();
	await expect(submit).toBeVisible({ timeout: 15_000 });
	await page.locator("form input").first().fill("admin");
	await page.locator("form input[type=\"password\"]").fill("123456");
	await submit.click();
	await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });
	await expect(page.locator(".ant-menu li").first()).toBeVisible({ timeout: 20_000 });
}

/**
 * 页外 API 调用的通用头：Bearer + 租户。
 *
 * `X-TENANT-ID` 必带：tenant.enable 后除 anonymous_paths 白名单外缺头即
 * 400 `missing tenant header`。这里写死部署默认租户（前端 `DEFAULT_TENANT` 同值）——
 * 模板 e2e 跑的是单租户 dev 站点，多租户场景另行带参。
 */
export function apiHeaders(token: string): Record<string, string> {
	return { "Authorization": `Bearer ${token}`, "X-TENANT-ID": "default" };
}

/** 用页外 request 直登 API，返回 Bearer token（给 push 端点造确定性数据用） */
export async function apiLogin(page: Page): Promise<string> {
	const res = await page.request.post("/api/auth/login", {
		data: { username: "admin", password: "123456" },
		headers: { "X-TENANT-ID": "default" },
	});
	const body = await res.json();
	if (body.code !== 0)
		throw new Error(`API login failed: ${JSON.stringify(body)}`);
	return body.data.access_token as string;
}
