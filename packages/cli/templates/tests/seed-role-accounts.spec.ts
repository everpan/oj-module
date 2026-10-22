// BDD：脚手架 seed 内置角色开发账号——每个内置角色一个账号（admin 角色账号名 sysadmin，
// 因 admin 已被 superadmin 占用），口令均 123456，must_change=0 免首登改密；
// admin(superadmin) 不在此列，保持 must_change=1 的强制改密闭环（默认凭据安全兜底）。
// 直接重放 _platform 迁移 + seed.sql 到内存 sqlite（installDb 不 replay seed，故自给自足）。
// 方言对齐：seed.mysql.sql / seed.pg.sql 与基线同构，人工对齐不受本 spec 钉守——
// 首条用例对三份文件做 INSERT 语法冒烟，防「INSERT IGNORE 错位」类事故回归。
import type { DatabaseSync } from "node:sqlite";

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const req = createRequire(import.meta.url);
const { DatabaseSync: Db } = req("node:sqlite") as { DatabaseSync: typeof DatabaseSync };

const PLATFORM_API = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "_platform", "api");

let dbo: InstanceType<typeof DatabaseSync>;

beforeAll(() => {
	dbo = new Db(":memory:");
	for (const f of readdirSync(join(PLATFORM_API, "migrations")).filter(f => f.endsWith(".sql") && !/\.(?:mysql|pg)\.sql$/.test(f)).sort())
		dbo.exec(readFileSync(join(PLATFORM_API, "migrations", f), "utf8"));
	// seed 按英文分号朴素切分（手册 §1.6 纪律），replay 同口径
	for (const stmt of readFileSync(join(PLATFORM_API, "seed.sql"), "utf8").split(";")) {
		const sql = stmt.trim();
		if (sql)
			dbo.exec(sql);
	}
});

describe("seed 内置角色开发账号", () => {
	it("方言文件 INSERT 语法冒烟：mysql 为 INSERT IGNORE 前缀、pg 为 ON CONFLICT 后缀", () => {
		const mysql = readFileSync(join(PLATFORM_API, "seed.mysql.sql"), "utf8");
		const pg = readFileSync(join(PLATFORM_API, "seed.pg.sql"), "utf8");
		expect(mysql).not.toMatch(/INSERT INTO .*INSERT IGNORE/);
		expect(mysql.match(/INSERT IGNORE INTO/g)!.length).toBeGreaterThanOrEqual(12);
		expect(pg).not.toMatch(/INSERT IGNORE/);
		expect(pg.match(/ON CONFLICT DO NOTHING/g)!.length).toBeGreaterThanOrEqual(12);
	});

	it.each([
		["sysadmin", "admin"],
		["editor", "editor"],
		["viewer", "viewer"],
	] as const)("账号 %s 存在：must_change=0 且绑定 %s 角色", (username, role) => {
		const row = dbo.prepare("SELECT must_change FROM users WHERE username = ?").get(username) as { must_change: number };
		expect(row).toBeDefined();
		expect(Number(row.must_change)).toBe(0);
		const bound = dbo.prepare("SELECT COUNT(*) n FROM sys_user_role WHERE user_id = (SELECT id FROM users WHERE username = ?) AND role_name = ?").get(username, role) as { n: number };
		expect(Number(bound.n)).toBe(1);
	});

	it("admin(superadmin) 保持 must_change=1 强制改密闭环", () => {
		const row = dbo.prepare("SELECT must_change FROM users WHERE username = 'admin'").get() as { must_change: number };
		expect(Number(row.must_change)).toBe(1);
	});

	it("角色账号口令与 admin 相同（123456 的 bcrypt，复用 seed 既有哈希）", () => {
		const hash = dbo.prepare("SELECT password_hash h FROM users WHERE username = 'admin'").get() as { h: string };
		for (const u of ["sysadmin", "editor", "viewer"]) {
			const row = dbo.prepare("SELECT password_hash h FROM users WHERE username = ?").get(u) as { h: string };
			expect(row.h).toBe(hash.h);
		}
	});
});
