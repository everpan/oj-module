// BDD 回归防护：oj v0.1.129 的 `forTenant(id)` 语句级租户覆盖。
//
// 背景：模板后端把「平台 superadmin 操作另一个企业租户」从 `db.asSystem()`（请求级、
// 全关守卫）+ 裸 `db.exec("DELETE … WHERE tenant_id = ?")` 收敛成
// `db.table(t).forTenant(id)`（语句级、防护照常，只换注入值）。两处落点：
//   · store.ts::revokeTenantSessions → forTenant(id).truncate()
//   · tenant-admin.ts 全文件 → 6 处 forTenant 语句级覆盖
//
// 这一层钉两套东西：① 改造后的业务行为不能退（跨租户动作只动目标租户、不脏写 default
// 与其它企业租户）；② 夹具垫片必须和上游构造器契约一致（空 id / 嵌套语句 / insert 手写
// tenant_id 不符 / delete 无 where / truncate 带 where 一律报错）——垫片若放宽任一条，
// 上面的行为用例就可能「越权写成假绿」，这是 L2 最容易漏的一类回归。
//
// 真构造器（oj 二进制内的 Rust 实现）由 oj exec 三方言探针另行闭环；此处是 vitest 的
// L2 语义等价层，方法论见 devkit oj-test-guide.md 与 fixture.ts 头注释。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { revokeTenantSessions, tenantOfCorp } from "../src/app/api/auth/_shared/wecom/store";
import {
	ensureTenantAdmin,
	setTenantAdminPassword,
	TENANT_ADMIN_USERNAME,
	tenantAdminState,
} from "../src/app/api/auth/_shared/wecom/tenant-admin";
import { installDb } from "./fixture";

const g = globalThis as any;
let dbo: ReturnType<typeof installDb>;

const A = "corp_a";
const B = "corp_b";
const DEFAULT = "default";
const NOW = 1_700_000_000;

/** 夹具在 installDb() 时种下的 admin@default 占着 id=1，清场时留着它 */
const SEED_ADMIN_ID = 1;

function installGlobals(): void {
	Object.defineProperty(globalThis, "crypto", {
		value: {
			randomHex: (n = 32) => `r${"a".repeat(n * 2)}`,
			sha256Hex: (s: string) => `sha(${s})`,
		},
		configurable: true,
	});
	g.bcrypt = { hash: async (s: string) => `hashed:${s}`, verify: async () => false };
	g.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function insertUser(tenant: string, username: string, passwordHash = "x", mustChange = 0): number {
	dbo.prepare("INSERT INTO users (tenant_id, username, password_hash, must_change) VALUES (?, ?, ?, ?)")
		.run(tenant, username, passwordHash, mustChange);
	return Number((dbo.prepare("SELECT id FROM users WHERE tenant_id = ? AND username = ?")
		.get(tenant, username) as { id: number }).id);
}

function insertToken(tokenHash: string, tenant: string, userId: number): void {
	dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)")
		.run(tokenHash, tenant, userId, NOW + 100, NOW);
}

function tokenTenants(): string[] {
	return (dbo.prepare("SELECT tenant_id FROM sys_refresh_token ORDER BY token_hash").all() as Array<{ tenant_id: string }>)
		.map(r => String(r.tenant_id));
}

/** 跨租户动作的标准布景：A/B/default 各有同名用户，A/B/default 各有会话 */
function seedUsers(): Record<string, number> {
	const ids = {
		[A]: insertUser(A, "same", "a-pw", 0),
		[B]: insertUser(B, "same", "b-pw", 0),
		[DEFAULT]: insertUser(DEFAULT, "same", "d-pw", 0),
	};
	return ids;
}

beforeAll(() => {
	dbo = installDb();
	installGlobals();
});

beforeEach(() => {
	dbo.exec("DELETE FROM sys_refresh_token");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec(`DELETE FROM users WHERE id <> ${SEED_ADMIN_ID}`);
	g.http = {};
});

afterEach(() => {
	g.http = {};
});

describe("forTenant 语句级覆盖：构造器契约（回归防护）", () => {
	it("跨租户读只命中覆盖租户，default 与其它企业租户不可见", async () => {
		seedUsers();
		g.http = { tenantId: B };
		const rows = await db.table("users").forTenant(A).select(["username", "tenant_id"]).where({ field: "username", op: "eq", value: "same" }).all() as Array<Record<string, unknown>>;
		expect(rows).toHaveLength(1);
		expect(String(rows[0]!.tenant_id)).toBe(A);
	});

	it("同请求两条语句身份隔离：带 forTenant 的用覆盖值，不带的仍用当前请求租户", async () => {
		seedUsers();
		g.http = { tenantId: B };
		const overridden = await db.table("users").forTenant(A).select(["tenant_id"]).where({ field: "username", op: "eq", value: "same" }).all() as Array<{ tenant_id: string }>;
		const plain = await db.table("users").select(["tenant_id"]).where({ field: "username", op: "eq", value: "same" }).all() as Array<{ tenant_id: string }>;
		expect(overridden.map(r => String(r.tenant_id))).toEqual([A]);
		expect(plain.map(r => String(r.tenant_id))).toEqual([B]);
	});

	it("insert 自动把 tenant_id 写成覆盖租户（业务代码不手写该列）", async () => {
		await db.table("users").forTenant(A).insert({ username: "fresh", password_hash: "x" }).run();
		const row = dbo.prepare("SELECT tenant_id FROM users WHERE username = 'fresh'").get() as { tenant_id: string };
		expect(String(row.tenant_id)).toBe(A);
		// 没有误写进当前请求租户（缺省 default）
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = 'default' AND username = 'fresh'").get())
			.toMatchObject({ n: 0 });
	});

	it("update / delete 只命中覆盖租户的同名行，别家同名行不动", async () => {
		const ids = seedUsers();
		await db.table("users").forTenant(A).update({ password_hash: "changed" }).where({ field: "username", op: "eq", value: "same" }).run();
		expect(dbo.prepare("SELECT password_hash FROM users WHERE id = ?").get(ids[A])).toMatchObject({ password_hash: "changed" });
		expect(dbo.prepare("SELECT password_hash FROM users WHERE id = ?").get(ids[B])).toMatchObject({ password_hash: "b-pw" });
		expect(dbo.prepare("SELECT password_hash FROM users WHERE id = ?").get(ids[DEFAULT])).toMatchObject({ password_hash: "d-pw" });

		await db.table("users").forTenant(A).delete().where({ field: "username", op: "eq", value: "same" }).run();
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(ids[A])).toMatchObject({ n: 0 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(ids[B])).toMatchObject({ n: 1 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(ids[DEFAULT])).toMatchObject({ n: 1 });
	});

	it("forTenant(id).truncate() 只清该租户（revokeTenantSessions 依赖的形态）", async () => {
		const ids = seedUsers();
		insertToken("a1", A, ids[A]);
		insertToken("a2", A, ids[A]);
		insertToken("b1", B, ids[B]);
		insertToken("d1", DEFAULT, ids[DEFAULT]);
		const n = Number(await db.table("sys_refresh_token").forTenant(A).truncate().run());
		expect(n).toBe(2);
		expect(tokenTenants()).toEqual([B, DEFAULT]);
	});

	it("请求级逃生口 db.asSystem() 已被夹具守卫封死（防重新引入全关守卫）", () => {
		expect(() => g.db.asSystem()).toThrow(/asSystem/);
	});
});

describe("revokeTenantSessions：跨租户精确吊销（store.ts 回归防护）", () => {
	function seedTokens(ids: Record<string, number>): void {
		insertToken("a1", A, ids[A]);
		insertToken("a2", A, ids[A]);
		insertToken("b1", B, ids[B]);
		insertToken("d1", DEFAULT, ids[DEFAULT]);
	}

	it("只清目标租户的会话，default 与其它企业租户不动", async () => {
		const ids = seedUsers();
		seedTokens(ids);
		const n = await revokeTenantSessions(tenantOfCorp(A));
		expect(n).toBe(2);
		expect(tokenTenants()).toEqual([B, DEFAULT]);
	});

	it("不依赖本次请求的租户态：匿名 / default 头 / 别家头 结果完全一致", async () => {
		for (const tenant of [undefined, DEFAULT, B]) {
			dbo.exec("DELETE FROM sys_refresh_token");
			dbo.exec("DELETE FROM sys_user_role");
			dbo.exec(`DELETE FROM users WHERE id <> ${SEED_ADMIN_ID}`);
			const ids = seedUsers();
			seedTokens(ids);
			g.http = tenant === undefined ? {} : { tenantId: tenant };
			expect(await revokeTenantSessions(A)).toBe(2);
			expect(tokenTenants()).toEqual([B, DEFAULT]);
		}
	});

	it("目标租户无会话时返回 0，且绝不误删别家", async () => {
		const ids = seedUsers();
		insertToken("b1", B, ids[B]);
		insertToken("d1", DEFAULT, ids[DEFAULT]);
		expect(await revokeTenantSessions(A)).toBe(0);
		expect(tokenTenants()).toEqual([B, DEFAULT]);
	});
});

describe("tenant-admin：跨租户动作不越界（tenant-admin.ts 回归防护）", () => {
	it("ensureTenantAdmin(A) 只在 A 建号 + 授权，default 的既有 admin 与 B 不受影响", async () => {
		const r = await ensureTenantAdmin(A);
		expect(r).toEqual({ created: true });

		const a = dbo.prepare("SELECT id, tenant_id, must_change FROM users WHERE tenant_id = ? AND username = ?")
			.get(A, TENANT_ADMIN_USERNAME) as { id: number, tenant_id: string, must_change: number };
		expect(String(a.tenant_id)).toBe(A);
		expect(Number(a.must_change)).toBe(1);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_user_role WHERE tenant_id = ? AND user_id = ? AND role_name = 'admin'")
			.get(A, a.id)).toMatchObject({ n: 1 });

		// 夹具种下的 admin@default 原封不动（id=1 / password_hash='x' / 无角色）
		expect(dbo.prepare("SELECT password_hash, must_change FROM users WHERE id = ?").get(SEED_ADMIN_ID))
			.toMatchObject({ password_hash: "x", must_change: 0 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_user_role WHERE user_id = ?").get(SEED_ADMIN_ID))
			.toMatchObject({ n: 0 });
		// B 没有被凭空建档
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?").get(B)).toMatchObject({ n: 0 });
	});

	it("tenantAdminState 只看目标租户：A 已开通，B 仍 exists=false", async () => {
		await ensureTenantAdmin(A);
		expect(await tenantAdminState(A)).toMatchObject({ corpId: A, exists: true, mustChange: true });
		expect(await tenantAdminState(B)).toMatchObject({ corpId: B, exists: false, mustChange: false });
	});

	it("重复 ensureTenantAdmin 幂等：第二次 created=false，不重复建号/授权", async () => {
		expect(await ensureTenantAdmin(A)).toEqual({ created: true });
		expect(await ensureTenantAdmin(A)).toEqual({ created: false });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND username = ?").get(A, TENANT_ADMIN_USERNAME))
			.toMatchObject({ n: 1 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_user_role WHERE tenant_id = ?").get(A)).toMatchObject({ n: 1 });
	});

	it("setTenantAdminPassword(A) 只改 A 的口令、只吊销 A 该用户的会话", async () => {
		await ensureTenantAdmin(A);
		const aId = Number((dbo.prepare("SELECT id FROM users WHERE tenant_id = ? AND username = ?")
			.get(A, TENANT_ADMIN_USERNAME) as { id: number }).id);
		insertUser(B, TENANT_ADMIN_USERNAME, "b-unchanged", 0);
		insertToken("a1", A, aId);
		insertToken("b1", B, aId); // 同一 user_id、别家租户：必须留下
		insertToken("d1", DEFAULT, aId); // default 也留下

		const state = await setTenantAdminPassword(A, "NewPw");
		expect(state).toMatchObject({ corpId: A, exists: true, mustChange: true });
		expect(dbo.prepare("SELECT password_hash, must_change FROM users WHERE id = ?").get(aId))
			.toMatchObject({ password_hash: "hashed:NewPw", must_change: 1 });
		expect(dbo.prepare("SELECT password_hash, must_change FROM users WHERE tenant_id = ? AND username = ?")
			.get(B, TENANT_ADMIN_USERNAME)).toMatchObject({ password_hash: "b-unchanged", must_change: 0 });
		expect(dbo.prepare("SELECT password_hash FROM users WHERE id = ?").get(SEED_ADMIN_ID))
			.toMatchObject({ password_hash: "x" });
		// 只删了 A 的那条；B / default 同 user_id 的会话仍在
		expect(tokenTenants()).toEqual([B, DEFAULT]);
	});
});

describe("构造器红线防呆（垫片与上游契约对齐，放宽即假绿）", () => {
	it("空 / 空白 id 拒绝", () => {
		expect(() => db.table("users").forTenant("")).toThrow(/must not be empty/);
		expect(() => db.table("users").forTenant("   ")).toThrow(/must not be empty/);
	});

	it("同一语句不允许两个租户身份（重复 forTenant 拒绝）", () => {
		expect(() => db.table("users").forTenant(A).forTenant(B)).toThrow(/only allowed once per statement/);
	});

	it("forTenant 只许顶层语句：union 的 other / fromSelect 的 source 带它必报错", async () => {
		const nested = db.table("users").forTenant(A).select(["id"]);
		await expect(db.table("users").select(["id"]).union(nested).all())
			.rejects
			.toThrow(/only valid on the top-level statement/);
		await expect(db.table("users").fromSelect(nested, ["user_id"]).run())
			.rejects
			.toThrow(/only valid on the top-level statement/);
	});

	it("insert 手写 tenant_id 与覆盖值不符 → mismatch（相同值只是冗余，放行）", async () => {
		await expect(db.table("users").forTenant(A)
			.insert({ tenant_id: B, username: "bad", password_hash: "x" }).run())
			.rejects
			.toThrow(/mismatch/);
		await db.table("users").forTenant(A).insert({ tenant_id: A, username: "ok", password_hash: "x" }).run();
		expect(dbo.prepare("SELECT tenant_id FROM users WHERE username = 'ok'").get()).toMatchObject({ tenant_id: A });
	});

	it("delete 必须带显式业务 where（仅靠 forTenant 注入的租户条件不算数）", async () => {
		await expect(db.table("sys_refresh_token").forTenant(A).delete().run())
			.rejects
			.toThrow(/delete requires where/);
	});

	it("truncate 不接受 where（越权收窄条件不是它的职责）", async () => {
		await expect(db.table("sys_refresh_token").forTenant(A).truncate()
			.where({ field: "user_id", op: "eq", value: 1 }).run())
			.rejects
			.toThrow(/truncate does not accept where/);
	});

	it("写动词唯一：先 update/delete/truncate/insert(values) 再 fromSelect / 换动词一律响报（防静默翻成别的动词）", () => {
		const src = () => db.table("users").select(["id"]);
		// 评审发现：旧守卫只防 insert(values)→fromSelect，先 set 其它动词会静默翻成 INSERT
		expect(() => db.table("users").update({ username: "x" }).fromSelect(src(), ["user_id"])).toThrow(/requires a fresh statement/);
		expect(() => db.table("users").where({ field: "id", op: "eq", value: 1 }).delete().fromSelect(src(), ["user_id"])).toThrow(/requires a fresh statement/);
		expect(() => db.table("users").truncate().fromSelect(src(), ["user_id"])).toThrow(/requires a fresh statement/);
		// 对称面：values / fromSelect 已占位的语句也不许再换动词
		expect(() => db.table("users").insert({ username: "x" }).fromSelect(src(), ["user_id"])).toThrow(/requires a fresh statement/);
		expect(() => db.table("users").fromSelect(src(), ["user_id"]).update({ username: "x" })).toThrow(/requires a fresh statement/);
		expect(() => db.table("users").insert({ username: "x" }).update({ username: "y" })).toThrow(/requires a fresh statement/);
	});
});
