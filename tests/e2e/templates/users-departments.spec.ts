import type { Page } from "@playwright/test";

import { expect, test } from "@playwright/test";

import { apiHeaders, apiLogin, enterTemplateApp, execSql } from "../fixtures/enter-template-app";

/**
 * 用户列表的「所属部门」列 + 部门筛选（方案 §5.4）。
 *
 * 钉的是一条容易写歪的口径：**筛「研发部」要带出子部门的人**——组织架构里部门是树的、
 * 人往往挂在叶子上，只按选中节点自己过滤会漏掉整棵子树。另一半是「主部门」标记：
 * 一个人可能在多个部门，只有一个 is_main=1，列表要能一眼看出哪个是主部门。
 *
 * 数据用 API 建号 + SQL 挂部门（不经部门页点的那些步），不依赖企微上游。
 */
const PREFIX = "e2e_dept_";
const ROOT = "E2E 研发部";
const CHILD = "E2E 前端组";
const SIBLING = "E2E 商务组";

function scalar(sql: string): number {
	return Number(execSql(sql).trim());
}

function clean(): void {
	execSql(`DELETE FROM sys_dept_member WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${PREFIX}%');
		DELETE FROM sys_dept_member WHERE dept_id IN (SELECT id FROM sys_department WHERE name LIKE 'E2E %');
		DELETE FROM sys_department WHERE name LIKE 'E2E %';
		DELETE FROM users WHERE username LIKE '${PREFIX}%';`);
}

function mkDept(name: string, originId: string, parentId: number | null): number {
	execSql(`INSERT INTO sys_department (tenant_id, origin, origin_id, parent_id, name, order_no, update_time)
		VALUES ('default', 'local', '${originId}', ${parentId ?? "NULL"}, '${name}', 0, 0);`);
	return scalar(`SELECT id FROM sys_department WHERE origin_id = '${originId}';`);
}

function join(uid: number, deptId: number, isMain: boolean): void {
	execSql(`INSERT INTO sys_dept_member (tenant_id, user_id, dept_id, order_no, is_leader, is_main, update_time)
		VALUES ('default', ${uid}, ${deptId}, 0, 0, ${isMain ? 1 : 0}, 0);`);
}

async function mkUser(page: Page, token: string, username: string): Promise<number> {
	const res = await page.request.post("/api/system/users", {
		data: { username, password: "aA123456" },
		headers: apiHeaders(token),
	});
	const body = await res.json();
	if (body.code !== 0)
		throw new Error(`create user failed: ${JSON.stringify(body)}`);
	return body.data.id as number;
}

/** 张三：研发部（主部门）；李四：研发部/前端组；王五：商务组（对照，不该被筛出来） */
async function seed(page: Page): Promise<{ zhang: string, li: string, wang: string }> {
	clean();
	const token = await apiLogin(page);
	const zhang = await mkUser(page, token, `${PREFIX}zhang`);
	const li = await mkUser(page, token, `${PREFIX}li`);
	const wang = await mkUser(page, token, `${PREFIX}wang`);
	const root = mkDept(ROOT, "e2e-root", null);
	const child = mkDept(CHILD, "e2e-child", root);
	const sibling = mkDept(SIBLING, "e2e-sibling", null);
	join(zhang, root, true);
	join(li, child, false);
	join(wang, sibling, true);
	return { zhang: `${PREFIX}zhang`, li: `${PREFIX}li`, wang: `${PREFIX}wang` };
}

test.describe("用户列表：所属部门与部门筛选（templates）", () => {
	test.afterAll(() => {
		clean();
	});

	test("U1: 多部门的人标出「主部门」，没部门的人不画空 Tag", async ({ page }) => {
		await seed(page);
		await enterTemplateApp(page);
		await page.goto("/system/framework/users");
		await expect(page.getByRole("columnheader", { name: "所属部门" })).toBeVisible({ timeout: 15_000 });
		// 主部门排在前，且带「· 主部门」后缀
		await expect(page.getByText(`${ROOT} · 主部门`)).toBeVisible();
		// 李四只在子部门 → 不带主部门后缀
		await expect(page.getByText(`${CHILD} · 主部门`)).toHaveCount(0);
		await expect(page.getByText(CHILD, { exact: true })).toBeVisible();
		// 没有任何部门的人不画空 Tag，落一个破折号
		const adminRow = page.getByRole("row", { name: /^admin / });
		await expect(adminRow.getByRole("cell").nth(3)).toHaveText("—");
	});

	test("U2: 按部门筛选带出子部门的人，其它部门的人被筛掉", async ({ page }) => {
		const seeded = await seed(page);
		await enterTemplateApp(page);
		await page.goto("/system/framework/users");
		await expect(page.getByText(seeded.zhang)).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(seeded.wang)).toBeVisible();

		// antd TreeSelect 的 input 没有 placeholder 属性（占位文案是 span），按角色点更稳
		await page.getByRole("combobox").click();
		await page.locator(`.ant-select-tree-title:text-is("${ROOT}")`).click();

		// 本部门的人还在；子部门（前端组）的人也必须还在——这正是闭包筛选的意义
		await expect(page.getByText(seeded.zhang)).toBeVisible();
		await expect(page.getByText(seeded.li)).toBeVisible();
		await expect(page.getByText(seeded.wang)).toHaveCount(0);
	});
});
