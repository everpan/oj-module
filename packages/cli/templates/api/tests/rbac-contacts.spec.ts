// BDD：通讯录——searchContacts 目录（AC1-22/23）+ contactDetail 详情 + 接口级限速。
// 读模型红线：目录只出 id/username/display_name（无 email/avatar/roles，安全评审 P2）；
// 禁用用户不出目录（AC1-23）；keyword≥2（AC1-22）；limit 钳 200（AC1-24）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { contactDetail, searchContacts } from "../src/_platform/_shared/service/contacts";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

function mkUser(username: string, opts: { displayName?: string, email?: string, forbidden?: boolean } = {}): number {
	dbo.prepare("INSERT INTO users (username, password_hash, display_name, email, is_forbidden) VALUES (?, 'x', ?, ?, ?)")
		.run(username, opts.displayName ?? null, opts.email ?? null, opts.forbidden ? 1 : 0);
	return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	vi.useRealTimers();
	g.http = {};
	dbo.exec("DELETE FROM users WHERE username LIKE 'c%'");
});

describe("AC1-22：登录可读的字段最小集", () => {
	it("keyword 命中 username/display_name；返回仅 id/username/display_name", async () => {
		mkUser("c_zhang", { displayName: "张三" });
		mkUser("c_li", { displayName: "张三丰" });
		mkUser("c_wang", { displayName: "王五" });
		const byName = await searchContacts("c_zhang");
		expect(byName.length).toBe(1);
		expect(byName[0]).toEqual({ id: byName[0].id, username: "c_zhang", display_name: "张三" });
		const byDisplay = await searchContacts("张三");
		expect(byDisplay.map(u => u.username).sort()).toEqual(["c_li", "c_zhang"]);
	});

	it("keyword <2 字符 → 400", async () => {
		await expect(searchContacts("张")).rejects.toMatchObject({ status: 400 });
	});
});

describe("AC1-23：禁用用户不出目录", () => {
	it("is_forbidden=1 不出现在结果中", async () => {
		mkUser("c_carol", { displayName: "卡罗" });
		mkUser("c_dave", { displayName: "卡罗 dave", forbidden: true });
		const r = await searchContacts("卡罗");
		expect(r.map(u => u.username)).toEqual(["c_carol"]);
	});
});

describe("AC1-24：limit 钳制", () => {
	it("默认钳 200；传 500 静默钳 200", async () => {
		for (let i = 0; i < 210; i++)
			mkUser(`c_bulk${i}`);
		const r = await searchContacts("c_bulk", { limit: 500 });
		expect(r.length).toBe(200);
	});
});

describe("详情与限速", () => {
	it("contactDetail 含 email/avatar（目录不带的字段详情给）", async () => {
		const uid = mkUser("c_eve", { email: "eve@example.com" });
		dbo.prepare("UPDATE users SET avatar_base64 = 'aGVsbG8=' WHERE id = ?").run(uid);
		const d = await contactDetail(uid);
		expect(d.username).toBe("c_eve");
		expect(d.email).toBe("eve@example.com");
		expect(d.avatar_base64).toBe("aGVsbG8=");
	});

	it("接口级限速：同用户突发超限 → 429", async () => {
		const uid = mkUser("c_rate");
		g.http = { user: { id: uid } };
		const { rateLimit } = await import("../src/_platform/_shared/service/rate");
		// 窗口 60s / 限额 3（测试参数；生产端点各自定额）
		for (let i = 0; i < 3; i++)
			await rateLimit(`contacts:${uid}`, 3, 60_000);
		await expect(rateLimit(`contacts:${uid}`, 3, 60_000)).rejects.toMatchObject({ status: 429 });
		vi.setSystemTime(Date.now() + 61_000);
		await rateLimit(`contacts:${uid}`, 3, 60_000); // 窗口过期放行
	});
});
