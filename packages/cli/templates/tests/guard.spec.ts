/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
// BDD：判权四级链（设计文档 §4，验收锚点 AC1-1~6）+ spike 夹具冒烟
// （真实迁移建表 / 运行时全局 db 同面 / 事务往返）——S0 spike 的「一条真实判权 AC + 形态证明」。
import { beforeAll, describe, expect, it } from "vitest";

import { decideAccess, moduleOf } from "../src/_platform/api/_shared/service/infra/guard";
import { ADMIN, installDb } from "./fixture";

const as = (roles: string[], bindings: Record<string, string[]> = {}) => ({ roles, bindings });

describe("判权四级链（AC1-1~6 判定矩阵）", () => {
	it("AC1-1 平台超集：superadmin 未绑定任何权限点 → 通过", () => {
		expect(decideAccess(as(["superadmin"]), "wiki.doc.create")).toBe(true);
	});
	it("AC1-2 系统超集：admin 未绑定任何权限点 → 通过", () => {
		expect(decideAccess(as(["admin"]), "wiki.doc.create")).toBe(true);
	});
	it("AC1-3 模块超集（零配置推导）：wiki.admin 过 wiki.*", () => {
		expect(decideAccess(as(["wiki.admin"]), "wiki.doc.create")).toBe(true);
	});
	it("AC1-4 模块超集不外溢：wiki.admin 不过 crm.*", () => {
		expect(decideAccess(as(["wiki.admin"]), "crm.contact.create")).toBe(false);
	});
	it("AC1-5 精确命中：wiki.editor 经绑定过 wiki.doc.create", () => {
		expect(decideAccess(as(["wiki.editor"], { "wiki.editor": ["wiki.doc.create"] }), "wiki.doc.create")).toBe(true);
	});
	it("AC1-6 无权限：viewer 无绑定 → false（handler 层转 403）", () => {
		expect(decideAccess(as(["viewer"]), "wiki.doc.create")).toBe(false);
	});
	it("code 首段推导：无点 code 整体即模块名", () => {
		expect(moduleOf("wiki")).toBe("wiki");
		expect(moduleOf("wiki.doc.create")).toBe("wiki");
	});
});

describe("spike 夹具冒烟：真实迁移 + 运行时全局面 + 事务", () => {
	let dbo: ReturnType<typeof installDb>;
	beforeAll(() => {
		dbo = installDb();
	});
	it("真实迁移建 users 表（夹具与迁移不漂移）", () => {
		const row = dbo.prepare("SELECT username FROM users WHERE id = ?").get(ADMIN) as { username: string };
		expect(row.username).toBe("admin");
	});
	it("全局 db.query/exec 与运行时同面可用", async () => {
		const rows = await db.query("SELECT id, username FROM users WHERE tenant_id = ?", ["default"]);
		expect(rows.length).toBeGreaterThan(0);
	});
	it("裸 SQL 漏写 tenant_id 一律拒（sql_guard: deny 的夹具替身）", async () => {
		await expect(db.query("SELECT id FROM users")).rejects.toThrow(/未写 tenant_id/);
		await expect(db.exec("DELETE FROM users")).rejects.toThrow(/未写 tenant_id/);
		// B 组共享表无 tenant_id，照旧放行
		await expect(db.query("SELECT key FROM sys_setting")).resolves.toBeDefined();
	});
	it("db.tx 事务往返：提交持久化 / 回滚不留痕", async () => {
		await db.tx(async (t) => {
			await t.exec("INSERT INTO users (tenant_id, username, password_hash) VALUES ('default', 'tx-ok', 'x')");
		});
		const ok = dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'tx-ok'").get() as { n: number };
		expect(Number(ok.n)).toBe(1);
		await expect(db.tx(async (t) => {
			await t.exec("INSERT INTO users (tenant_id, username, password_hash) VALUES ('default', 'tx-bad', 'x')");
			throw new Error("rollback");
		})).rejects.toThrow("rollback");
		const bad = dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'tx-bad'").get() as { n: number };
		expect(Number(bad.n)).toBe(0);
	});
});
