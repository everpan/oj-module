// BDD：多租户地基的运行时语义（计划 §5.7 第 2/3/4/6 项）。
//
// 这一层此前只能在真 oj 上验证：夹具的构造器垫片不模拟租户注入。夹具补上之后（见
// tests/fixture.ts 头注释），四件事才能在 L2 钉住：
//   3 构造器 insert 自动落当前租户（业务代码不该自己写 tenant_id）
//   6 读写自动按当前租户过滤（跨租户 update/delete 落 0 行，refresh 查不到别家行）
//   4 同一 username 在不同租户各一行（UNIQUE(tenant_id, username)）
//   2 裸 SQL 触碰租户表却不写 tenant_id → 拒（`sql_guard: deny` 的近似；样例在 guard.spec.ts）
//
// 为什么不测业务 handler：那在 tenant-forgery.spec.ts（伪造头的端点级拦截）。本文件只钉地基——
// 地基错了，上层所有「读不到别家数据」的断言都可能是假绿。
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_TENANT, installDb } from "./fixture";

const g = globalThis as any;
let dbo: ReturnType<typeof installDb>;

/** 模拟一次请求带 `X-TENANT-ID`（oj 侧由构造器读同一个值） */
function asTenant(tenant?: string): void {
	g.http = tenant ? { tenantId: tenant } : {};
}

function rows(sql: string, params: unknown[] = []): Array<Record<string, any>> {
	return dbo.prepare(sql).all(...params) as Array<Record<string, any>>;
}

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	asTenant();
});

describe("§5.7-3 insert 自动落当前租户", () => {
	it("构造器不写 tenant_id 也落到当前租户", async () => {
		asTenant("acme");
		await db.table("users").insert({ username: "iso-alice", password_hash: "x" }).run();
		expect(rows("SELECT tenant_id FROM users WHERE username = 'iso-alice'")[0]!.tenant_id).toBe("acme");
	});

	it("无请求上下文时落部署默认租户（运维脚本/迁移的形态）", async () => {
		asTenant();
		await db.table("users").insert({ username: "iso-bob", password_hash: "x" }).run();
		expect(rows("SELECT tenant_id FROM users WHERE username = 'iso-bob'")[0]!.tenant_id).toBe(DEFAULT_TENANT);
	});

	it("显式给了 tenant_id 就按给的落，不被当前租户覆盖", async () => {
		asTenant("acme");
		await db.table("users").insert({ username: "iso-carol", password_hash: "x", tenant_id: "globex" }).run();
		expect(rows("SELECT tenant_id FROM users WHERE username = 'iso-carol'")[0]!.tenant_id).toBe("globex");
	});
});

describe("§5.7-6 读写自动按当前租户过滤", () => {
	it("select 只看得到本租户的行", async () => {
		asTenant("globex");
		const names = (await db.table("users").all() as Array<Record<string, unknown>>).map(u => String(u.username));
		expect(names).not.toContain("iso-alice");
		expect(names).toContain("iso-carol"); // 前一个用例显式落在 globex 的那行
	});

	it("update 跨租户落 0 行，目标行不被改", async () => {
		const changed = await db.table("users")
			.where({ field: "username", op: "eq", value: "iso-alice" })
			.update({ email: "hijacked@evil" })
			.run();
		expect(changed).toBe(0);
		expect(rows("SELECT email FROM users WHERE username = 'iso-alice'")[0]!.email).toBeNull();
	});

	it("delete 跨租户落 0 行，目标行仍在", async () => {
		const deleted = await db.table("users")
			.where({ field: "username", op: "eq", value: "iso-alice" })
			.delete()
			.run();
		expect(deleted).toBe(0);
		expect(rows("SELECT id FROM users WHERE username = 'iso-alice'")).toHaveLength(1);
	});

	it("truncate 只清本租户（A 组表）", async () => {
		asTenant("acme");
		await db.table("todos").insert({ title: "acme-todo" }).run();
		asTenant("globex");
		await db.table("todos").insert({ title: "globex-todo" }).run();

		asTenant("acme");
		await db.table("todos").truncate().run();
		expect(rows("SELECT title FROM todos")).toEqual([{ title: "globex-todo" }]);
	});

	it("refresh token 换票：别家的 token_hash 在本租户查不到", async () => {
		asTenant("acme");
		await db.table("sys_refresh_token").insert({
			token_hash: "iso-h1",
			user_id: 1,
			expires_at: 9_999_999_999,
			created_at: 0,
		}).run();

		asTenant("globex");
		const other = await db.table("sys_refresh_token")
			.where({ field: "token_hash", op: "eq", value: "iso-h1" })
			.all();
		expect(other).toHaveLength(0);

		asTenant("acme");
		const own = await db.table("sys_refresh_token")
			.where({ field: "token_hash", op: "eq", value: "iso-h1" })
			.all();
		expect(own).toHaveLength(1);
	});
});

describe("§5.7-4 同一 username 在不同租户各一行", () => {
	it("唯一约束收敛为 (tenant_id, username)：同工号两家企业互不冲突", async () => {
		asTenant("acme");
		await db.table("users").insert({ username: "wecom:zhangsan", password_hash: "x" }).run();
		asTenant("globex");
		await db.table("users").insert({ username: "wecom:zhangsan", password_hash: "x" }).run();

		expect(rows("SELECT tenant_id FROM users WHERE username = 'wecom:zhangsan' ORDER BY tenant_id"))
			.toEqual([{ tenant_id: "acme" }, { tenant_id: "globex" }]);
	});

	it("同租户内重复用户名仍被唯一约束挡住", async () => {
		asTenant("acme");
		await expect(
			db.table("users").insert({ username: "wecom:zhangsan", password_hash: "x" }).run(),
		).rejects.toThrow(/UNIQUE/i);
	});
});
