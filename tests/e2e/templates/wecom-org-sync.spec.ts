import { expect, test } from "@playwright/test";

import { enterTemplateApp, execSql } from "../fixtures/enter-template-app";

/**
 * 组织架构页顶部的企微同步状态条（方案 §5.4 / §6.4 / §7）——纯前端消费面。
 *
 * 这里断言的是「不同授权事实下页面给什么」，全部可离线复现：**不碰企微上游**，
 * 只往 `wecom_app_profile` / `wecom_sync_job` 投行（等价于回调已落库的历史状态）。
 * 四条纪律各自对应一张卡：
 *   · 没装企微 → 整条不出现（纯 CRUD 站点不该看到企微的任何痕迹）；
 *   · 成员授权（auth_mode=1）→ 明确文案且**不给同步按钮**（点了必然 400）；
 *   · 正常 → 「更新于 X · 自动同步 · 立即同步」，并显示跳过计数；
 *   · 取消授权 → 冻结黄条，同样不给按钮。
 *
 * 租户口径：dev 单租户站点 tenant_id = default，而 `tenantOfCorp` 是恒等映射，
 * 所以这里的企业代码就是 `default`（真部署下它是真实 corpid）。
 */
const CORP = "default";
const AGENT = "100001";

function clean(): void {
	execSql(`DELETE FROM wecom_app_profile WHERE corp_id='${CORP}';
		DELETE FROM wecom_sync_job WHERE tenant_id='${CORP}';`);
}

function seedProfile(authMode: number, status = "active"): void {
	const now = Math.floor(Date.now() / 1000);
	execSql(`DELETE FROM wecom_app_profile WHERE corp_id='${CORP}';
		INSERT INTO wecom_app_profile
			(suite_id, corp_id, agent_id, auth_corp_id, env, corp_name, status, permanent_code_enc, auth_mode, installed_at, update_time)
		VALUES ('suite_e2e', '${CORP}', '${AGENT}', '${CORP}', 'prod', '测试企业', '${status}', 'enc', ${authMode}, ${now}, ${now});`);
}

function seedJob(status: string, stats: { departments: number, members: number, skipped: number }): void {
	const now = Math.floor(Date.now() / 1000);
	const statsText = `{"departments":${stats.departments},"members":${stats.members},"skipped":${stats.skipped},"reconciled":true}`;
	execSql(`DELETE FROM wecom_sync_job WHERE tenant_id='${CORP}';
		INSERT INTO wecom_sync_job
			(tenant_id, corp_id, agent_id, status, phase, cursor_text, stats_text, err_code, err_detail, started_at, finished_at, update_time)
		VALUES ('${CORP}', '${CORP}', '${AGENT}', '${status}', 'reconcile',
			'{"phase":"reconcile","round":1,"depts":[],"at":0,"fatalRun":0}', '${statsText}', NULL, NULL,
			${now - 100}, ${now - 90}, ${now - 90});`);
}

test.describe("企微组织架构同步状态条（templates）", () => {
	test.beforeEach(() => {
		clean();
	});

	test.afterAll(() => {
		clean();
	});

	test("S1: 没装企微的站点看不到任何同步痕迹", async ({ page }) => {
		await enterTemplateApp(page);
		await page.goto("/system/departments");
		await expect(page.getByRole("button", { name: "新建" })).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole("button", { name: "立即同步" })).toHaveCount(0);
		await expect(page.getByText("尚未同步过企微组织架构")).toHaveCount(0);
	});

	test("S2: 成员授权模式 → 明确文案，且不给同步按钮（点了也必然 400）", async ({ page }) => {
		seedProfile(1);
		await enterTemplateApp(page);
		await page.goto("/system/departments");
		await expect(page.getByText("该企业为「成员授权」模式，应用没有通讯录权限")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText("请企业管理员在企微后台把授权模式改为「管理员授权」后重新授权")).toBeVisible();
		await expect(page.getByRole("button", { name: "立即同步" })).toHaveCount(0);
	});

	test("S3: 从没同步过 → 提示未同步 + 立即同步入口", async ({ page }) => {
		seedProfile(0);
		await enterTemplateApp(page);
		await page.goto("/system/departments");
		await expect(page.getByText("尚未同步过企微组织架构")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole("button", { name: "立即同步" })).toBeVisible();
	});

	test("S4: 同步过 → 更新于 + 自动同步 + 跳过计数（权限类降级要如实说出来）", async ({ page }) => {
		seedProfile(0);
		seedJob("done", { departments: 3, members: 5, skipped: 2 });
		await enterTemplateApp(page);
		await page.goto("/system/departments");
		await expect(page.getByText(/企微组织架构更新于/)).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText("自动同步")).toBeVisible();
		await expect(page.getByText("2 个部门因权限被跳过")).toBeVisible();
		await expect(page.getByRole("button", { name: "立即同步" })).toBeVisible();
	});

	test("S5: 已取消授权 → 冻结黄条，不给按钮（保留最后一次同步的快照）", async ({ page }) => {
		seedProfile(0, "disabled");
		seedJob("done", { departments: 3, members: 5, skipped: 0 });
		await enterTemplateApp(page);
		await page.goto("/system/departments");
		await expect(page.getByText("该企业已取消授权或应用已停用，同步已冻结")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole("button", { name: "立即同步" })).toHaveCount(0);
	});
});
