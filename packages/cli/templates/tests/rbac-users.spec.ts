// BDD：账号管理（B6 建号加固 + B7 四接口服务层）——AC1-7~10。
// 红线：admin 不碰 superadmin/admin 成员资格（AC1-8）；最后 superadmin 不可被撤（AC1-10）；
// 禁止操作自己（AC1-10 注）；roles 写 sys_user_role 唯一权威源 + 写时失效（AC1-7/D10）；
// 禁用/重置口令级联删 refresh（§3.1 吊销联动）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import type { SessionDeps } from "../src/auth/api/_shared/session";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { changePasswordByAdmin, createUser, listUsers, setForbidden, updateUserRoles } from "../src/_platform/api/_shared/service/domain/users";
import { createSession } from "../src/auth/api/_shared/session";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

const bcryptDeps = {
	bcryptHash: async (pw: string) => `hashed:${pw}`,
	bcryptVerify: async (pw: string, h: string) => h === `hashed:${pw}`,
};

function seedRole(name: string) {
	dbo.prepare("INSERT OR IGNORE INTO sys_role (name, module, builtin) VALUES (?, 'framework', 1)").run(name);
}

function mkUser(username: string, opts: { forbidden?: boolean } = {}): number {
	dbo.prepare("INSERT INTO users (username, password_hash, is_forbidden) VALUES (?, 'x', ?)").run(username, opts.forbidden ? 1 : 0);
	return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

function rolesOf(uid: number): string[] {
	return (dbo.prepare("SELECT role_name FROM sys_user_role WHERE user_id = ?").all(uid) as Array<{ role_name: string }>).map(r => r.role_name);
}

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM sys_refresh_token");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM sys_oplog");
	dbo.exec("DELETE FROM users WHERE username LIKE 'u%'");
});

describe("B6：建号加固", () => {
	it("拒绝 ^(ldap|sso): 前缀用户名（防抢占外来号命名空间）", async () => {
		await expect(createUser({ username: "ldap:alice", password: "pw12345" }, bcryptDeps)).rejects.toMatchObject({ status: 400 });
		await expect(createUser({ username: "sso:bob", password: "pw12345" }, bcryptDeps)).rejects.toMatchObject({ status: 400 });
	});

	it("口令 <6 → 400；建号默认 must_change=1", async () => {
		await expect(createUser({ username: "u_short", password: "123" }, bcryptDeps)).rejects.toMatchObject({ status: 400 });
		const uid = await createUser({ username: "u_new", password: "pw12345" }, bcryptDeps);
		const row = dbo.prepare("SELECT must_change, password_hash FROM users WHERE id = ?").get(uid) as { must_change: number, password_hash: string };
		expect(Number(row.must_change)).toBe(1);
		expect(row.password_hash).toBe("hashed:pw12345");
	});

	it("重名 → 400；写审计 user.create", async () => {
		await createUser({ username: "u_dup", password: "pw12345" }, bcryptDeps);
		await expect(createUser({ username: "u_dup", password: "pw12345" }, bcryptDeps)).rejects.toMatchObject({ status: 400 });
		const audit = dbo.prepare("SELECT * FROM sys_oplog WHERE action = 'user.create'").all();
		expect(audit.length).toBe(1);
	});
});

describe("B7/AC1-7：角色分配（sys_user_role 唯一权威源 + 写时失效）", () => {
	it("分配/撤销写 sys_user_role；持有者下一次判权即生效（D10）", async () => {
		seedRole("wiki.editor");
		seedRole("viewer");
		const uid = mkUser("u_frank");
		await updateUserRoles(1, uid, ["wiki.editor", "viewer"]);
		expect(rolesOf(uid).sort()).toEqual(["viewer", "wiki.editor"]);
		await updateUserRoles(1, uid, ["viewer"]);
		expect(rolesOf(uid)).toEqual(["viewer"]);
	});

	it("不存在的角色 → 400", async () => {
		const uid = mkUser("u_norole");
		await expect(updateUserRoles(1, uid, ["ghost.role"])).rejects.toMatchObject({ status: 400 });
	});

	it("AC1-8：admin 分配 superadmin/admin 成员资格 → 403（superadmin 操作者放行）", async () => {
		seedRole("superadmin");
		seedRole("admin");
		const actor = mkUser("u_sup");
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'superadmin')").run(actor);
		const uid = mkUser("u_gina");
		await expect(updateUserRoles(1, uid, ["superadmin"])).rejects.toMatchObject({ status: 403 });
		await expect(updateUserRoles(1, uid, ["admin"])).rejects.toMatchObject({ status: 403 });
		await updateUserRoles(actor, uid, ["superadmin"]); // superadmin 可分配
		expect(rolesOf(uid)).toEqual(["superadmin"]);
	});

	it("AC1-10：唯一 superadmin 的自撤角色/自禁被「禁止操作自己」400（服务端另有最后-superadmin 兜底）", async () => {
		seedRole("superadmin");
		const solo = mkUser("u_solo");
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'superadmin')").run(solo);
		await expect(updateUserRoles(solo, solo, [])).rejects.toMatchObject({ status: 400 });
		await expect(setForbidden(solo, solo, true)).rejects.toMatchObject({ status: 400 });
	});

	it("禁止操作自己：对自己改角色 → 400", async () => {
		await expect(updateUserRoles(1, 1, ["viewer"])).rejects.toMatchObject({ status: 400 });
	});

	it("审计 user.roles.update", async () => {
		seedRole("editor");
		const uid = mkUser("u_aud");
		await updateUserRoles(1, uid, ["editor"]);
		const audit = dbo.prepare("SELECT * FROM sys_oplog WHERE action = 'user.roles.update'").all() as Array<{ target: string }>;
		expect(audit.length).toBe(1);
		expect(audit[0].target).toBe("u_aud");
	});
});

describe("B7：口令重置与禁用（级联吊销）", () => {
	it("管理员重置口令：must_change=1 + 该用户 refresh 全删 + 写时失效", async () => {
		const uid = mkUser("u_reset");
		const s = createSession({ ...bcryptDeps, randomHex: () => "rt-1", sha256Hex: (x: string) => `h(${x})`, signAccess: () => "jwt", accessTtlSecs: 900, refreshTtlSecs: 1000 } satisfies SessionDeps);
		dbo.prepare("UPDATE users SET password_hash = 'hashed:pw12345', must_change = 0 WHERE id = ?").run(uid);
		await s.localLogin("u_reset", "pw12345");
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_refresh_token WHERE user_id = ?").get(uid)).toBeDefined();
		await changePasswordByAdmin(1, uid, "newpw123", bcryptDeps);
		const row = dbo.prepare("SELECT must_change, password_hash FROM users WHERE id = ?").get(uid) as { must_change: number, password_hash: string };
		expect(Number(row.must_change)).toBe(1);
		expect(row.password_hash).toBe("hashed:newpw123");
		const left = dbo.prepare("SELECT COUNT(*) c FROM sys_refresh_token WHERE user_id = ?").get(uid) as { c: number };
		expect(Number(left.c)).toBe(0);
	});

	it("禁止操作自己：管理员重置自己口令 → 400（自助改密走 /auth/password）", async () => {
		await expect(changePasswordByAdmin(1, 1, "newpw123", bcryptDeps)).rejects.toMatchObject({ status: 400 });
	});

	it("禁用：is_forbidden=1 + refresh 全删；禁止禁用自己", async () => {
		const uid = mkUser("u_forbid");
		await setForbidden(1, uid, true);
		expect(Number((dbo.prepare("SELECT is_forbidden FROM users WHERE id = ?").get(uid) as { is_forbidden: number }).is_forbidden)).toBe(1);
		await expect(setForbidden(1, 1, true)).rejects.toMatchObject({ status: 400 });
	});

	it("审计 user.password.reset / user.forbidden.update", async () => {
		const uid = mkUser("u_aud2");
		await changePasswordByAdmin(1, uid, "newpw123", bcryptDeps);
		await setForbidden(1, uid, true);
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_oplog WHERE action = 'user.password.reset'").get()).toBeDefined();
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_oplog WHERE action = 'user.forbidden.update'").get()).toBeDefined();
	});
});

describe("B7：列表（用户管理页数据源）", () => {
	it("listUsers 带角色数组，排除口令哈希", async () => {
		seedRole("editor");
		mkUser("u_l1");
		const uid = mkUser("u_l2");
		await updateUserRoles(1, uid, ["editor"]);
		const users = await listUsers();
		const u2 = users.find(u => u.username === "u_l2");
		expect(u2?.roles).toEqual(["editor"]);
		expect(JSON.stringify(users)).not.toContain("password_hash");
	});
});
