// 批量用户信息读面（usersInfoByIds）：一次 IN 批量取回多行所需的人名/头像/邮箱等，无 N+1。
// 纪律：定序按入参 ids、缺失 id 不占位、去重与非法 id 静默丢弃、超 200 → 400、直查不过滤禁用态。

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { MAX_BATCH_IDS, usersInfoByIds } from "../src/app/api/_platform/_shared/service/domain/user-info";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

function mkUser(username: string, opts: { displayName?: string, email?: string, phone?: string, description?: string, forbidden?: boolean, activated?: boolean } = {}): number {
	dbo.prepare("INSERT INTO users (username, password_hash, display_name, email, phone_number, description, is_forbidden, activated, must_change) VALUES (?, 'x', ?, ?, ?, ?, ?, ?, 0)")
		.run(username, opts.displayName ?? null, opts.email ?? null, opts.phone ?? null, opts.description ?? null, opts.forbidden ? 1 : 0, opts.activated === false ? 0 : 1);
	return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

function grantRole(uid: number, role: string): void {
	dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(uid, role);
}

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM users WHERE username LIKE 'ui_%'");
});

describe("批量取数", () => {
	it("多 id 一次取回完整字段，按入参顺序返回", async () => {
		const a = mkUser("ui_a", { displayName: "张三", email: "a@x.com", phone: "138", description: "职务A" });
		const b = mkUser("ui_b", { displayName: "李四", email: "b@x.com" });
		grantRole(a, "editor");
		const rows = await usersInfoByIds([b, a]);
		expect(rows.map(r => r.id)).toEqual([b, a]);
		expect(rows[1]).toMatchObject({
			username: "ui_a",
			displayName: "张三",
			email: "a@x.com",
			phoneNumber: "138",
			description: "职务A",
			roles: ["editor"],
			mustChange: false,
		});
		expect(rows[0]).toMatchObject({ username: "ui_b", displayName: "李四", avatar: "", roles: [] });
	});

	it("缺失 id 不占位；去重；非正整数静默丢弃", async () => {
		const a = mkUser("ui_a", { displayName: "张三" });
		const rows = await usersInfoByIds([a, 999999, a, 0, -1, "abc", null]);
		expect(rows.map(r => r.id)).toEqual([a]);
	});

	it("空入参 → 空数组，不触发查询", async () => {
		expect(await usersInfoByIds([])).toEqual([]);
		expect(await usersInfoByIds([0, -3, "x"])).toEqual([]);
	});

	it("直查按 id 精确取，禁用/未激活号也返回（区别于可搜索通讯录）", async () => {
		const off = mkUser("ui_off", { displayName: "离职", forbidden: true, activated: false });
		const rows = await usersInfoByIds([off]);
		expect(rows.map(r => r.id)).toEqual([off]);
		expect(rows[0].displayName).toBe("离职");
	});
});

describe("上限", () => {
	it(`ids 超过 ${MAX_BATCH_IDS} → 400`, async () => {
		const ids = Array.from({ length: MAX_BATCH_IDS + 1 }, (_, i) => i + 1);
		await expect(usersInfoByIds(ids)).rejects.toMatchObject({ status: 400 });
	});
});
