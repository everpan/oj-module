import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// BDD：seed 契约——框架内置角色 + seed 超管绑定 + must_change 首登改密（D12/AC1-27）。
// 夹具重放真实 migrations + seed.sql 文件，本 spec 即「seed 与文件不漂移」的钉子。
import { beforeAll, describe, expect, it } from "vitest";

import { installDb } from "./fixture";

const SEED = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "_platform", "api", "seed.sql");
let dbo: ReturnType<typeof installDb>;

beforeAll(() => {
	dbo = installDb();
	// 清空夹具预插的 users，让 seed 成为 users 数据的唯一来源（INSERT OR IGNORE 依赖空表语义）
	dbo.prepare("DELETE FROM users").run();
	// seed 朴素按分号切分（与 oj 运行时同规则；注释内禁英文分号是 seed.sql 头的纪律）；
	// 每个语句块先剥掉整行注释再执行（注释与语句同行出现是 seed 文件自身的纪律约束）
	for (const stmt of readFileSync(SEED, "utf8").split(";")) {
		const sql = stmt.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").trim();
		if (sql)
			dbo.exec(sql);
	}
});

describe("框架内置角色（ROLES 常量单一真相，PRD §4.2）", () => {
	it.each([
		["superadmin", "超级管理员"],
		["admin", "系统管理员"],
		["editor", "编辑"],
		["viewer", "访客"],
	])("seed 出 builtin 角色 %s", (name, title) => {
		const row = dbo.prepare("SELECT * FROM sys_role WHERE name = ?").get(name) as Record<string, unknown>;
		expect(row).toBeDefined();
		expect(row.module).toBe("framework");
		expect(Number(row.builtin)).toBe(1);
		expect(row.title).toBe(title);
	});
});

describe("seed 超管（D12）", () => {
	// AUTOINCREMENT 不复用 id（sqlite_sequence 语义），统一按 username 动态解析，不钉死 id
	const adminId = () => (dbo.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: number }).id;

	it("admin 账号绑定 superadmin 角色（sys_user_role 权威源）", () => {
		const row = dbo.prepare("SELECT * FROM sys_user_role WHERE user_id = ? AND role_name = 'superadmin'").get(adminId());
		expect(row).toBeDefined();
	});

	it("must_change=1：首登强制改密（AC1-27 前提）", () => {
		const row = dbo.prepare("SELECT must_change FROM users WHERE id = ?").get(adminId()) as { must_change: number };
		expect(Number(row.must_change)).toBe(1);
	});
});
