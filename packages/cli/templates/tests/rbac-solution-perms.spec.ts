// BDD：权限数据升级稳定性（设计 §5 / AC2-1~6）——「模拟安装器 upsert 逻辑」单元层钉死规则。
// 安装器本体属 PRD M5；本文件钉死的是安装器必须调用的框架规则出口（upsert/uninstall），
// 端到端（真 manifest 走真安装器）延后至 M5 验收。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { uninstallSolution, upsertSolutionPerms } from "../src/_platform/api/_shared/service/domain/solution-perms";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	dbo.exec("DELETE FROM sys_role_permission");
	dbo.exec("DELETE FROM sys_user_role WHERE role_name != 'superadmin'"); // 夹具超管绑定常驻
	dbo.exec("DELETE FROM users WHERE username LIKE 'u_%'");
	dbo.exec("DELETE FROM sys_permission");
	dbo.exec("DELETE FROM sys_role WHERE builtin = 0");
	dbo.exec("UPDATE sys_role SET deprecated = 0");
	dbo.exec("UPDATE sys_permission SET deprecated = 0");
});

/** 模拟 wiki 0.1.9 首次安装：声明 editor/admin 两角色与两个权限点。 */
async function installWikiV019() {
	await upsertSolutionPerms({
		module: "wiki",
		roles: [
			{ name: "wiki.admin", title: "管理员", permissions: ["wiki.doc.create", "wiki.space.create"] },
			{ name: "wiki.editor", title: "编辑", permissions: ["wiki.doc.create"] },
		],
	});
}

function rows(sql: string) {
	return dbo.prepare(sql).all() as Record<string, unknown>[];
}

describe("AC2-1/2/5：升级只做加法与元数据覆盖", () => {
	it("AC2-1 新增声明 → upsert 插入新行；既有绑定与判决不变", async () => {
		await installWikiV019();
		// 管理员手动撤掉 wiki.editor 的 wiki.doc.create（AC1-15 前态）
		dbo.exec("DELETE FROM sys_role_permission WHERE role_name = 'wiki.editor' AND permission_code = 'wiki.doc.create'");
		const before = rows("SELECT * FROM sys_role_permission ORDER BY role_name, permission_code");
		const r = await upsertSolutionPerms({
			module: "wiki",
			roles: [
				{ name: "wiki.admin", title: "管理员", permissions: ["wiki.doc.create", "wiki.space.create"] },
				{ name: "wiki.editor", title: "编辑", permissions: ["wiki.doc.create"] },
				{ name: "wiki.guest", title: "访客", permissions: ["wiki.doc.read"] },
			],
		});
		// 新角色/权限点插入
		expect(rows("SELECT * FROM sys_role WHERE name = 'wiki.guest'").length).toBe(1);
		expect(rows("SELECT * FROM sys_permission WHERE code = 'wiki.doc.read'").length).toBe(1);
		// 既有绑定零变动（AC2-5 零减法的一部分：升级不删 sys_role_permission 行）；
		// after = before + guest 新声明绑定恰好 1 行
		const after = rows("SELECT * FROM sys_role_permission ORDER BY role_name, permission_code");
		expect(after.length).toBe(before.length + 1);
		for (const b of before)
			expect(after).toContainEqual(b);
		// guest 的声明绑定 insert-if-absent 写入
		expect(rows("SELECT * FROM sys_role_permission WHERE role_name = 'wiki.guest' AND permission_code = 'wiki.doc.read'").length).toBe(1);
		expect(r.deprecated).toEqual([]);
	});

	it("AC2-2 title 元数据覆盖；判决依据 name/code 不变", async () => {
		await installWikiV019();
		await upsertSolutionPerms({
			module: "wiki",
			roles: [
				{ name: "wiki.admin", title: "管理员（新版）", permissions: ["wiki.doc.create", "wiki.space.create"] },
				{ name: "wiki.editor", title: "编辑者（新版）", permissions: ["wiki.doc.create"] },
			],
		});
		expect((rows("SELECT title FROM sys_role WHERE name = 'wiki.editor'")[0]).title).toBe("编辑者（新版）");
		expect(rows("SELECT * FROM sys_role_permission WHERE role_name = 'wiki.editor'").length).toBe(1);
	});

	it("AC1-15 重复安装同一版本：管理员调整永不被声明覆写（insert-if-absent）", async () => {
		await installWikiV019();
		dbo.exec("DELETE FROM sys_role_permission WHERE role_name = 'wiki.editor' AND permission_code = 'wiki.doc.create'");
		await installWikiV019(); // 同版本重装/重启重放
		expect(rows("SELECT * FROM sys_role_permission WHERE role_name = 'wiki.editor'").length).toBe(0);
	});
});

describe("AC2-3/4：声明消失与重命名 → deprecated 保留（判决不突变）", () => {
	it("AC2-3 声明消失 → 行保留标 deprecated；持有者绑定继续生效（判权不过滤 deprecated）", async () => {
		await installWikiV019();
		const r = await upsertSolutionPerms({
			module: "wiki",
			roles: [
				{ name: "wiki.admin", title: "管理员", permissions: ["wiki.doc.create"] }, // wiki.space.create 消失
				{ name: "wiki.editor", title: "编辑", permissions: ["wiki.doc.create"] },
			],
		});
		const p = rows("SELECT deprecated FROM sys_permission WHERE code = 'wiki.space.create'");
		expect(p.length).toBe(1); // 行保留
		expect(Number(p[0].deprecated)).toBe(1); // 标 deprecated
		// 既有绑定保留（判权链不过滤 deprecated——§5 双向过滤的方向红线）
		expect(rows("SELECT * FROM sys_role_permission WHERE permission_code = 'wiki.space.create'").length).toBe(1);
		expect(r.deprecated).toContain("wiki.space.create");
	});

	it("AC2-4 重命名 = 旧 code 标 deprecated + 新 code 插入；安装器据 deprecated 清单强告警", async () => {
		await installWikiV019();
		const r = await upsertSolutionPerms({
			module: "wiki",
			roles: [
				{ name: "wiki.admin", title: "管理员", permissions: ["wiki.doc.write", "wiki.space.create"] }, // doc.create → doc.write
				{ name: "wiki.editor", title: "编辑", permissions: ["wiki.doc.write"] },
			],
		});
		expect(Number(rows("SELECT deprecated FROM sys_permission WHERE code = 'wiki.doc.create'")[0].deprecated)).toBe(1);
		expect(rows("SELECT * FROM sys_permission WHERE code = 'wiki.doc.write'").length).toBe(1);
		// 旧绑定继续生效（不静默变），安装器拿到清单提示「需重新分配」
		expect(rows("SELECT * FROM sys_role_permission WHERE permission_code = 'wiki.doc.create'").length).toBe(2);
		expect(r.deprecated).toContain("wiki.doc.create");
	});

	it("deprecated 角色同样保留标灰：角色行不删、绑定不删", async () => {
		await installWikiV019();
		await upsertSolutionPerms({
			module: "wiki",
			roles: [{ name: "wiki.admin", title: "管理员", permissions: ["wiki.doc.create", "wiki.space.create"] }], // editor 消失
		});
		expect(Number(rows("SELECT deprecated FROM sys_role WHERE name = 'wiki.editor'")[0].deprecated)).toBe(1);
		expect(rows("SELECT * FROM sys_role_permission WHERE role_name = 'wiki.editor'").length).toBe(1);
	});
});

describe("AC2-6：卸载级联清理（唯一减法出口）", () => {
	it("双维度删除：wiki 角色及其绑定 + 属 wiki 的权限点绑定（含 custom 角色上的）；custom 角色本体保留", async () => {
		await installWikiV019();
		// custom 角色跨模块绑了 wiki 权限点
		dbo.exec("INSERT INTO sys_role (name, module, title) VALUES ('custom.reviewer', 'custom', '审核')");
		dbo.exec("INSERT INTO sys_role_permission (role_name, permission_code) VALUES ('custom.reviewer', 'wiki.doc.create')");
		// 两个用户持 wiki 角色
		dbo.exec("INSERT INTO users (username, password_hash) VALUES ('u_carol', 'x'), ('u_dave', 'x')");
		dbo.exec("INSERT INTO sys_user_role (user_id, role_name) SELECT id, 'wiki.editor' FROM users WHERE username = 'u_dave'");
		dbo.exec("INSERT INTO sys_user_role (user_id, role_name) SELECT id, 'wiki.admin' FROM users WHERE username = 'u_carol'");

		await uninstallSolution("wiki");

		// 维度①：wiki 角色行 + 其绑定 + 用户成员资格全清
		expect(rows("SELECT * FROM sys_role WHERE module = 'wiki'").length).toBe(0);
		expect(rows("SELECT * FROM sys_role_permission WHERE role_name IN ('wiki.admin','wiki.editor')").length).toBe(0);
		expect(rows("SELECT * FROM sys_user_role WHERE role_name IN ('wiki.admin','wiki.editor')").length).toBe(0);
		// 维度②：permission_code 属 wiki 的绑定（custom 角色上的）也清——防重装复活旧授权
		expect(rows("SELECT * FROM sys_role_permission WHERE permission_code LIKE 'wiki.%'").length).toBe(0);
		expect(rows("SELECT * FROM sys_permission WHERE module = 'wiki'").length).toBe(0);
		// custom 角色本体保留（空绑定）
		expect(rows("SELECT * FROM sys_role WHERE name = 'custom.reviewer'").length).toBe(1);
	});

	it("AC2-5 卸载也不动其他模块：framework builtin 角色与绑定原样", async () => {
		await installWikiV019();
		// 夹具只重放迁移不落 seed——显式补超管绑定作对照组
		dbo.exec("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'admin'");
		const before = rows("SELECT * FROM sys_role WHERE module = 'framework'");
		await uninstallSolution("wiki");
		expect(rows("SELECT * FROM sys_role WHERE module = 'framework'")).toEqual(before);
		expect(rows("SELECT * FROM sys_user_role WHERE role_name = 'superadmin'").length).toBe(1);
	});
});
