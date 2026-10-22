// BDD：判权出口——assertPermission 四级链（DB 权威源）+ 撤销即强退 + is_forbidden + 系统管理员断言。
// AC 锚点：AC1-1~6（判定矩阵走 DB 全链路）、AC1-9（assertSystemAdmin/assertSuperAdmin）、D10（缓存失效=撤销即强退）。
// 夹具即真实库：角色/绑定/禁用态全部 INSERT 进 sqlite，断言走 service 公开出口（不 mock 判定）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { assertPermission, assertSuperAdmin, assertSystemAdmin, invalidateUser } from "../src/_platform/api/_shared/service/infra/access";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

/** 造用户（users 必填列最小集），返回 id。 */
function mkUser(username: string, opts: { forbidden?: boolean } = {}): number {
	dbo.prepare("INSERT INTO users (username, password_hash, is_forbidden) VALUES (?, 'x', ?)")
		.run(username, opts.forbidden ? 1 : 0);
	return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

function bindRole(userId: number, role: string) {
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(userId, role);
}

function grant(role: string, code: string, module = "wiki") {
	dbo.prepare("INSERT OR IGNORE INTO sys_permission (code, module) VALUES (?, ?)").run(code, module);
	dbo.prepare("INSERT OR IGNORE INTO sys_role_permission (role_name, permission_code) VALUES (?, ?)").run(role, code);
}

function asUser(userId: number | undefined) {
	g.http = userId === undefined ? {} : { user: { id: userId } };
}

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	invalidateAll();
	asUser(undefined);
	vi.useRealTimers();
});

/** 每用例清空缓存与 RBAC 数据（users 保留，fixture admin id=1 无角色）。 */
function invalidateAll() {
	for (const r of dbo.prepare("SELECT id FROM users").all() as { id: number }[])
		invalidateUser(r.id);
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM sys_role_permission");
	dbo.exec("DELETE FROM sys_permission");
}

describe("AC1-1~6：四级链经 DB 权威源判定", () => {
	it("AC1-1 superadmin 通过任意 code（无需绑定）", async () => {
		const uid = mkUser("u1");
		bindRole(uid, "superadmin");
		asUser(uid);
		await expect(assertPermission("wiki.page.delete")).resolves.toBeUndefined();
	});

	it("AC1-2 admin 通过任意 code（无需绑定）", async () => {
		const uid = mkUser("u2");
		bindRole(uid, "admin");
		asUser(uid);
		await expect(assertPermission("any.thing")).resolves.toBeUndefined();
	});

	it("AC1-3 持 <模块>.admin 通过该模块全部 code（零配置推导）", async () => {
		const uid = mkUser("u3");
		bindRole(uid, "wiki.admin");
		asUser(uid);
		await expect(assertPermission("wiki.page.edit")).resolves.toBeUndefined();
	});

	it("AC1-3 负例：<模块>.admin 不越权其他模块", async () => {
		const uid = mkUser("u3n");
		bindRole(uid, "wiki.admin");
		asUser(uid);
		await expect(assertPermission("blog.page.edit")).rejects.toMatchObject({ status: 403 });
	});

	it("AC1-4 角色绑定精确命中 code 即通过", async () => {
		const uid = mkUser("u4");
		bindRole(uid, "editor");
		grant("editor", "wiki.page.edit");
		asUser(uid);
		await expect(assertPermission("wiki.page.edit")).resolves.toBeUndefined();
	});

	it("AC1-5 绑定未命中即 403", async () => {
		const uid = mkUser("u5");
		bindRole(uid, "editor");
		grant("editor", "wiki.page.edit");
		asUser(uid);
		await expect(assertPermission("wiki.page.delete")).rejects.toMatchObject({ status: 403 });
	});

	it("AC1-6 deprecated 权限点判权不过滤（已绑定角色照常通过）", async () => {
		const uid = mkUser("u6");
		bindRole(uid, "editor");
		grant("editor", "wiki.legacy");
		dbo.prepare("UPDATE sys_permission SET deprecated = 1 WHERE code = 'wiki.legacy'").run();
		asUser(uid);
		await expect(assertPermission("wiki.legacy")).resolves.toBeUndefined();
	});
});

describe("D10：撤销即强退（写时失效，TTL 不挡撤销）", () => {
	it("撤销绑定 + invalidateUser → 下一次请求即 403", async () => {
		const uid = mkUser("u7");
		bindRole(uid, "editor");
		grant("editor", "wiki.page.edit");
		asUser(uid);
		await expect(assertPermission("wiki.page.edit")).resolves.toBeUndefined();
		dbo.prepare("DELETE FROM sys_role_permission WHERE role_name = 'editor'").run();
		invalidateUser(uid);
		await expect(assertPermission("wiki.page.edit")).rejects.toMatchObject({ status: 403 });
	});

	it("TTL 兜底：写后未失效时缓存命中（10s 内不重复查库语义）", async () => {
		const uid = mkUser("u8");
		bindRole(uid, "editor");
		grant("editor", "wiki.page.edit");
		asUser(uid);
		await expect(assertPermission("wiki.page.edit")).resolves.toBeUndefined();
		// 未失效：即使库中已撤销，缓存仍放行（写路径负责失效，TTL 只兜崩溃）
		dbo.prepare("DELETE FROM sys_role_permission WHERE role_name = 'editor'").run();
		await expect(assertPermission("wiki.page.edit")).resolves.toBeUndefined();
	});

	it("TTL 到期后重查库", async () => {
		const uid = mkUser("u9");
		bindRole(uid, "editor");
		grant("editor", "wiki.page.edit");
		asUser(uid);
		await expect(assertPermission("wiki.page.edit")).resolves.toBeUndefined();
		dbo.prepare("DELETE FROM sys_role_permission WHERE role_name = 'editor'").run();
		vi.setSystemTime(Date.now() + 11_000);
		await expect(assertPermission("wiki.page.edit")).rejects.toMatchObject({ status: 403 });
	});
});

describe("禁用与未认证", () => {
	it("is_forbidden=1 即拒（持 superadmin 也不例外）", async () => {
		const uid = mkUser("u10", { forbidden: true });
		bindRole(uid, "superadmin");
		asUser(uid);
		await expect(assertPermission("wiki.page.edit")).rejects.toMatchObject({ status: 403 });
	});

	it("未认证（无 http.user）即拒", async () => {
		asUser(undefined);
		await expect(assertPermission("wiki.page.edit")).rejects.toMatchObject({ status: 403 });
	});
});

describe("AC1-9：系统管理员断言（D11）", () => {
	it("assertSystemAdmin：admin 通过、editor 403、superadmin 通过", async () => {
		const admin = mkUser("u11a");
		bindRole(admin, "admin");
		asUser(admin);
		await expect(assertSystemAdmin()).resolves.toBeUndefined();

		const editor = mkUser("u11b");
		bindRole(editor, "editor");
		asUser(editor);
		await expect(assertSystemAdmin()).rejects.toMatchObject({ status: 403 });

		const sup = mkUser("u11c");
		bindRole(sup, "superadmin");
		asUser(sup);
		await expect(assertSystemAdmin()).resolves.toBeUndefined();
	});

	it("assertSuperAdmin：admin 也 403（安全敏感项边界，D11）", async () => {
		const admin = mkUser("u12a");
		bindRole(admin, "admin");
		asUser(admin);
		await expect(assertSuperAdmin()).rejects.toMatchObject({ status: 403 });

		const sup = mkUser("u12b");
		bindRole(sup, "superadmin");
		asUser(sup);
		await expect(assertSuperAdmin()).resolves.toBeUndefined();
	});

	it("断言出口同样吃 is_forbidden（禁用超管立即全拒）", async () => {
		const sup = mkUser("u13", { forbidden: true });
		bindRole(sup, "superadmin");
		asUser(sup);
		await expect(assertSuperAdmin()).rejects.toMatchObject({ status: 403 });
	});
});
