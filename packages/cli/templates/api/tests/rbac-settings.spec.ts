// BDD：后端 C 期补口——操作日志查询（AC1-29/D13 admin 可查）、系统设置（PRD §4.3）、登录方式发现（C5/D2 匿名）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { searchOplog } from "../src/_platform/_shared/service/oplog";
import { listLoginMethods, listSettings, updateSetting } from "../src/_platform/_shared/service/settings";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

function mkOplog(username: string, action: string, module: string, level = 6) {
	dbo.prepare("INSERT INTO sys_oplog (create_time, user_id, username, action, module, level) VALUES (?, 1, ?, ?, ?, ?)")
		.run(1000, username, action, module, level);
}

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM sys_oplog");
	dbo.exec("DELETE FROM sys_setting");
});

describe("AC1-29/D13：操作日志查询（admin 可查）", () => {
	it("按 action/username/module 过滤 + 分页截断标记", async () => {
		mkOplog("alice", "role.create", "framework");
		mkOplog("alice", "user.create", "framework");
		mkOplog("bob", "role.create", "framework");
		const all = await searchOplog({});
		expect(all.total).toBe(3);
		const byAction = await searchOplog({ action: "user.create" });
		expect(byAction.list.map(r => r.username)).toEqual(["alice"]);
		const byUser = await searchOplog({ username: "bob" });
		expect(byUser.total).toBe(1);
	});

	it("403 拒绝类（auth.deny）可在日志中检索", async () => {
		mkOplog("mallory", "auth.deny", "wiki", 4);
		const r = await searchOplog({ action: "auth.deny" });
		expect(r.total).toBe(1);
	});
});

describe("PRD §4.3：系统设置", () => {
	it("按 group 返回设置项（secret 项掩码）", async () => {
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time) VALUES ('framework.site_title', 'framework', 'general', 'string', 'ACME', 0, 0)").run();
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time) VALUES ('market.cdn_url', 'market', 'security', 'string', 'https://cdn.example.com', 1, 0)").run();
		const groups = await listSettings();
		const general = groups.find(x => x.group === "general");
		expect(general?.items.find(i => i.key === "framework.site_title")?.value).toBe("ACME");
		const security = groups.find(x => x.group === "security");
		expect(security?.items.find(i => i.key === "market.cdn_url")?.value).toBe("***");
	});

	it("更新写值 + update_time + 审计（market 安全项须 superadmin 操作者）", async () => {
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time) VALUES ('framework.site_title', 'framework', 'general', 'string', 'ACME', 0, 0)").run();
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time) VALUES ('market.cdn_url', 'market', 'security', 'string', 'x', 1, 0)").run();
		await updateSetting(1, "framework.site_title", "NEW");
		expect(String((dbo.prepare("SELECT value FROM sys_setting WHERE key = 'framework.site_title'").get() as { value: string }).value)).toBe("NEW");
		expect(dbo.prepare("SELECT * FROM sys_oplog WHERE action = 'setting.update'").get()).toBeDefined();
		// 非 superadmin 操作 market 安全项 → 403
		await expect(updateSetting(1, "market.cdn_url", "https://evil.example.com")).rejects.toMatchObject({ status: 403 });
	});

	it("未知 key → 404", async () => {
		await expect(updateSetting(1, "ghost.key", "v")).rejects.toMatchObject({ status: 404 });
	});
});

describe("C5/D2：登录方式发现（匿名端点数据源）", () => {
	it("默认仅 local；LDAP/SSO 开关来自设置项", async () => {
		expect((await listLoginMethods()).methods).toEqual(["local"]);
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, update_time) VALUES ('ldap.enabled', 'ldap', 'login', 'bool', '1', 0)").run();
		expect((await listLoginMethods()).methods).toEqual(["local", "ldap"]);
	});
});
