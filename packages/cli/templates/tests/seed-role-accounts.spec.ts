// BDD：脚手架 seed 内置角色开发账号——账号名=角色名一一对应（superadmin/admin/editor/viewer），
// 口令均 123456，must_change=0 免首登改密（纯开发便利，生产部署须改密/删除）。
// 旧库收敛：历史 seed 把 admin 绑在 superadmin 且 must_change=1，seed 幂等重放即收敛
// （DELETE 旧绑定 + UPDATE must_change=0），无需手工迁移。
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

/** 重放迁移 + seed（seed 按英文分号朴素切分，同 oj 运行时口径） */
function replaySeed(): void {
	for (const stmt of readFileSync(join(PLATFORM_API, "seed.sql"), "utf8").split(";")) {
		const sql = stmt.trim();
		if (sql)
			dbo.exec(sql);
	}
}

beforeAll(() => {
	dbo = new Db(":memory:");
	for (const f of readdirSync(join(PLATFORM_API, "migrations")).filter(f => f.endsWith(".sql") && !/\.(?:mysql|pg)\.sql$/.test(f)).sort())
		dbo.exec(readFileSync(join(PLATFORM_API, "migrations", f), "utf8"));
	replaySeed();
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

	it.each(["superadmin", "admin", "editor", "viewer"])("账号 %s：must_change=0 且只绑定同名角色", (username) => {
		const row = dbo.prepare("SELECT must_change FROM users WHERE username = ?").get(username) as { must_change: number };
		expect(row).toBeDefined();
		expect(Number(row.must_change)).toBe(0);
		const roles = dbo.prepare("SELECT role_name FROM sys_user_role WHERE user_id = (SELECT id FROM users WHERE username = ?)").all(username) as Array<{ role_name: string }>;
		expect(roles.map(r => r.role_name)).toEqual([username]);
	});

	it("四个角色账号口令一致（123456 的 bcrypt，复用 seed 既有哈希）", () => {
		const hashes = dbo.prepare("SELECT username, password_hash h FROM users WHERE username IN ('superadmin','admin','editor','viewer')").all() as Array<{ username: string, h: string }>;
		expect(new Set(hashes.map(r => r.h)).size).toBe(1);
	});

	it("旧库收敛：legacy admin(superadmin 绑定 + must_change=1) 经重放收敛为账号名=角色名", () => {
		// 构造历史库状态：admin 绑 superadmin 且 must_change=1（旧 seed 口径），无 superadmin 账号
		dbo.exec("DELETE FROM sys_user_role");
		dbo.exec("DELETE FROM users");
		dbo.prepare("INSERT INTO users (username, password_hash, must_change) VALUES ('admin', 'x', 1)").run();
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'admin'").run();

		replaySeed();

		expect(Number((dbo.prepare("SELECT must_change m FROM users WHERE username = 'admin'").get() as { m: number }).m)).toBe(0);
		const adminRoles = (dbo.prepare("SELECT role_name r FROM sys_user_role WHERE user_id = (SELECT id FROM users WHERE username = 'admin')").all() as Array<{ r: string }>).map(x => x.r);
		expect(adminRoles).toEqual(["admin"]);
		const superRoles = (dbo.prepare("SELECT role_name r FROM sys_user_role WHERE user_id = (SELECT id FROM users WHERE username = 'superadmin')").all() as Array<{ r: string }>).map(x => x.r);
		expect(superRoles).toEqual(["superadmin"]);
	});

	it("幂等：重放两遍结果不变", () => {
		const snap = () => JSON.stringify([
			dbo.prepare("SELECT username, must_change FROM users ORDER BY username").all(),
			dbo.prepare("SELECT user_id, role_name FROM sys_user_role ORDER BY user_id, role_name").all(),
		]);
		const before = snap();
		replaySeed();
		expect(snap()).toBe(before);
	});
});
