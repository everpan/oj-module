// BDD：角色管理应用服务——CRUD 契约、命名空间红线、binding 编辑（含紧急吊销=写时失效）、占用禁删、写审计。
// AC 锚点：AC1-16/17（建角色）、AC1-18（声明角色绑定可调整）、AC1-19（builtin 无编辑入口）、
//          AC1-20（占用禁删）、AC1-28（写审计三动作）、AC1-30（摘绑定下一次请求即 403）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { assertPermission } from "../src/_platform/_shared/service/access";
import { createRole, deleteRole, listPermissions, listRoles, updateBindings } from "../src/_platform/_shared/service/roles";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

function mkUser(username: string): number {
	dbo.prepare("INSERT INTO users (username, password_hash) VALUES (?, 'x')").run(username);
	return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

function bindRole(userId: number, role: string) {
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(userId, role);
}

function seedPerm(code: string, deprecated = 0) {
	dbo.prepare("INSERT OR IGNORE INTO sys_permission (code, module, deprecated) VALUES (?, ?, ?)")
		.run(code, code.split(".")[0], deprecated);
}

function oplog(action: string) {
	return dbo.prepare("SELECT * FROM sys_oplog WHERE action = ? ORDER BY id").all(action) as Record<string, unknown>[];
}

beforeAll(() => {
	dbo = installDb();
	g.http = { user: { id: 1 } }; // admin 操作者（审计 username 解析用）
});

afterEach(() => {
	dbo.exec("DELETE FROM sys_role_permission");
	dbo.exec("DELETE FROM sys_role");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM sys_permission");
	dbo.exec("DELETE FROM sys_oplog");
	dbo.exec("DELETE FROM users WHERE username LIKE 'u%'");
});

describe("AC1-16/17：建角色（custom 命名空间强制 + 绑定写入）", () => {
	it("建 custom.reviewer 并勾选绑定：sys_role + sys_role_permission 双写，module=custom", async () => {
		seedPerm("wiki.doc.create");
		seedPerm("crm.contact.create");
		const role = await createRole({
			name: "custom.reviewer",
			title: "内容审核员",
			permissions: ["wiki.doc.create", "crm.contact.create"],
		});
		expect(role.name).toBe("custom.reviewer");
		expect(role.module).toBe("custom");
		const row = dbo.prepare("SELECT builtin FROM sys_role WHERE name = 'custom.reviewer'").get() as { builtin: number };
		expect(Number(row.builtin)).toBe(0);
		const binds = dbo.prepare("SELECT permission_code FROM sys_role_permission WHERE role_name = 'custom.reviewer' ORDER BY permission_code").all();
		expect(binds.map((b: any) => b.permission_code)).toEqual(["crm.contact.create", "wiki.doc.create"]);
	});

	it("AC1-17 保留名/ solutions 命名空间/裸名一律 400", async () => {
		await expect(createRole({ name: "admin", title: "x" })).rejects.toMatchObject({ status: 400 });
		await expect(createRole({ name: "wiki.admin", title: "x" })).rejects.toMatchObject({ status: 400 });
		await expect(createRole({ name: "reviewer", title: "x" })).rejects.toMatchObject({ status: 400 });
	});

	it("不存在的权限点拒绝（绑定必须落真实权限点）", async () => {
		await expect(createRole({ name: "custom.ops", title: "x", permissions: ["ghost.act"] }))
			.rejects
			.toMatchObject({ status: 400 });
	});

	it("AC1-28 role.create 写审计（module=framework）", async () => {
		await createRole({ name: "custom.audited", title: "审计钉" });
		const [r] = oplog("role.create");
		expect(r).toBeDefined();
		expect(r.module).toBe("framework");
		expect(r.target).toBe("custom.audited");
	});
});

describe("AC1-18/19/30：绑定编辑", () => {
	it("AC1-18 声明角色绑定可调整：替换写 sys_role_permission", async () => {
		dbo.prepare("INSERT INTO sys_role (name, module, builtin) VALUES ('wiki.editor', 'wiki', 0)").run();
		seedPerm("wiki.doc.create");
		seedPerm("wiki.doc.delete");
		await updateBindings("wiki.editor", ["wiki.doc.delete"]);
		const codes = dbo.prepare("SELECT permission_code FROM sys_role_permission WHERE role_name = 'wiki.editor'").all();
		expect(codes.map((c: any) => c.permission_code)).toEqual(["wiki.doc.delete"]);
	});

	it("AC1-19 builtin 角色（superadmin/admin/editor/viewer）绑定编辑 403 硬拒", async () => {
		dbo.prepare("INSERT INTO sys_role (name, module, builtin) VALUES ('editor', 'framework', 1)").run();
		await expect(updateBindings("editor", ["wiki.doc.create"])).rejects.toMatchObject({ status: 403 });
	});

	it("AC1-30 紧急吊销：superadmin 摘绑定 → 持有者下一次判权即 403（写时失效）", async () => {
		seedPerm("wiki.doc.create");
		await createRole({ name: "custom.dave", title: "dave", permissions: ["wiki.doc.create"] });
		const uid = mkUser("udave");
		bindRole(uid, "custom.dave");
		g.http = { user: { id: uid } };
		await expect(assertPermission("wiki.doc.create")).resolves.toBeUndefined();
		g.http = { user: { id: 1 } };
		await updateBindings("custom.dave", []);
		g.http = { user: { id: uid } };
		await expect(assertPermission("wiki.doc.create")).rejects.toMatchObject({ status: 403 });
	});

	it("AC1-28 role.bindings.update 审计带增删明细", async () => {
		seedPerm("wiki.a");
		seedPerm("wiki.b");
		await createRole({ name: "custom.diff", title: "x", permissions: ["wiki.a"] });
		await updateBindings("custom.diff", ["wiki.b"]);
		const [r] = oplog("role.bindings.update");
		expect(JSON.parse(String(r.detail))).toEqual({ added: ["wiki.b"], removed: ["wiki.a"] });
	});
});

describe("AC1-20：占用禁删", () => {
	it("有持有者的角色删除被拒并给出人数；清空后可删", async () => {
		await createRole({ name: "custom.held", title: "x" });
		const u1 = mkUser("u1");
		const u2 = mkUser("u2");
		bindRole(u1, "custom.held");
		bindRole(u2, "custom.held");
		await expect(deleteRole("custom.held")).rejects.toMatchObject({ status: 409, holders: 2 });
		dbo.exec("DELETE FROM sys_user_role WHERE role_name = 'custom.held'");
		await expect(deleteRole("custom.held")).resolves.toBeUndefined();
		expect(dbo.prepare("SELECT * FROM sys_role WHERE name = 'custom.held'").get()).toBeUndefined();
	});

	it("builtin 角色删除 403；AC1-28 role.delete 审计落表", async () => {
		dbo.prepare("INSERT INTO sys_role (name, module, builtin) VALUES ('viewer', 'framework', 1)").run();
		await expect(deleteRole("viewer")).rejects.toMatchObject({ status: 403 });
		await createRole({ name: "custom.todel", title: "x" });
		await deleteRole("custom.todel");
		expect(oplog("role.delete").length).toBe(1);
	});
});

describe("列表支撑（C2 页面数据源）", () => {
	it("listRoles 带持有计数与绑定数；listPermissions 带 deprecated 标灰标记", async () => {
		seedPerm("wiki.old", 1);
		seedPerm("wiki.new");
		await createRole({ name: "custom.ls", title: "列表", permissions: ["wiki.old"] });
		const uid = mkUser("uls");
		bindRole(uid, "custom.ls");
		const roles = await listRoles();
		const r = roles.find(x => x.name === "custom.ls");
		expect(r?.holders).toBe(1);
		expect(r?.permissions).toEqual(["wiki.old"]);
		const perms = await listPermissions();
		expect(perms.find(p => p.code === "wiki.old")?.deprecated).toBe(true);
		expect(perms.find(p => p.code === "wiki.new")?.deprecated).toBe(false);
	});
});
