// BDD：LDAP 登录（D1/AC1-12/PRD §4.5）——esc RFC 4515 红线 + ldapLogin 服务九步流程。
// axis("ldap") 是 oj 运行时全局（search/bind 无参数绑定面），gateway 注入可测；
// session 注入假实现，断言 JIT/禁用/签发编排，不触真 token。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { esc, firstAttr } from "../src/auth/api/_shared/ldap";
import { createLdapLogin } from "../src/auth/api/_shared/ldap-login";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	dbo.exec("DELETE FROM users WHERE username LIKE 'ldap:%'");
	dbo.exec("DELETE FROM sys_setting WHERE key LIKE 'ldap%'");
});

function seedLdapSettings(overrides: Record<string, string> = {}) {
	const base = { "ldap.enabled": "1", "ldap_base_dn": "ou=people,dc=example,dc=com", "ldap_uid_attr": "uid", "ldap_email_attr": "mail" };
	for (const [k, v] of Object.entries({ ...base, ...overrides }))
		dbo.prepare("INSERT OR REPLACE INTO sys_setting (key, module, \"group\", type, value, default_value, secret, update_time) VALUES (?, 'ldap', 'ldap', 'string', ?, '', 0, 0)").run(k, v);
}

interface FakeEntry { dn: string, attrs: Record<string, string[]> }

function fakeGateway(behavior: {
	search?: (filter: string) => FakeEntry[] | Promise<FakeEntry[]>
	bind?: (dn: string, password: string) => boolean | Promise<boolean>
} = {}) {
	return {
		searches: [] as string[],
		binds: [] as Array<{ dn: string, password: string }>,
		async search(_base: string, opts: { filter: string }) {
			this.searches.push(opts.filter);
			const r = behavior.search?.(opts.filter);
			if (r instanceof Promise)
				return await r;
			return r ?? [{ dn: "uid=x,ou=people,dc=example,dc=com", attrs: { uid: ["alice"], mail: ["alice@example.com"] } }];
		},
		async bind(dn: string, password: string) {
			this.binds.push({ dn, password });
			const r = behavior.bind?.(dn, password);
			return r instanceof Promise ? await r : (r ?? true);
		},
	};
}

function fakeSession() {
	return {
		issued: [] as number[],
		async issueExternal(uid: number) {
			this.issued.push(uid);
			return { access_token: "a", refresh_token: "r", expires_in: 900, restricted: false, user: { id: uid, username: `u${uid}`, display_name: null, avatar_base64: null, must_change: false, roles: [] } };
		},
	};
}

describe("esc：RFC 4515 转义红线（filter 无参数绑定，注入即目录查询篡改）", () => {
	it.each([
		["*", "\\2a"],
		["(", "\\28"],
		[")", "\\29"],
		["\\", "\\5c"],
		["\0", "\\00"],
		["alice*", "alice\\2a"],
		["a)(uid=x", "a\\29\\28uid=x"],
		[" Plain ", " Plain "], // 空格不转义（RFC 4515 无此要求）
		["中文明文", "中文明文"],
	])("%j → %j", (input, expected) => {
		expect(esc(input)).toBe(expected);
	});
});

describe("firstAttr：多值取首 / 缺失取空串", () => {
	it("首值与缺省", () => {
		expect(firstAttr({ mail: ["a@x.com", "b@x.com"] }, "mail")).toBe("a@x.com");
		expect(firstAttr({}, "mail")).toBe("");
		expect(firstAttr(undefined, "mail")).toBe("");
	});
});

describe("AC1-12：LDAP 登录九步流程（D1）", () => {
	it("① ldap.enabled=0 → 400（未启用）", async () => {
		seedLdapSettings({ "ldap.enabled": "0" });
		const g = fakeGateway();
		const login = createLdapLogin(fakeSession(), g);
		await expect(login("alice", "pw")).rejects.toMatchObject({ status: 400 });
		expect(g.searches.length).toBe(0); // 闸住，不触上游
	});

	it("③ base_dn 空 → 400", async () => {
		seedLdapSettings({ ldap_base_dn: "" });
		const g = fakeGateway();
		const login = createLdapLogin(fakeSession(), g);
		await expect(login("alice", "pw")).rejects.toMatchObject({ status: 400 });
		expect(g.searches.length).toBe(0);
	});

	it("② username/password 空 → 400", async () => {
		seedLdapSettings();
		const login = createLdapLogin(fakeSession(), fakeGateway());
		await expect(login("", "pw")).rejects.toMatchObject({ status: 400 });
		await expect(login("alice", "")).rejects.toMatchObject({ status: 400 });
	});

	it("⑤ search 抛 → 502；0 条/多条 → 401（不猜）", async () => {
		seedLdapSettings();
		const s = fakeSession();
		const searchThrow = fakeGateway({ search: () => Promise.reject(new Error("conn reset")) });
		await expect(createLdapLogin(s, searchThrow)("alice", "pw")).rejects.toMatchObject({ status: 502 });
		await expect(createLdapLogin(s, fakeGateway({ search: () => [] }))("alice", "pw")).rejects.toMatchObject({ status: 401 });
		await expect(createLdapLogin(s, fakeGateway({ search: () => [{ dn: "a", attrs: {} }, { dn: "b", attrs: {} }] }))("alice", "pw")).rejects.toMatchObject({ status: 401 });
		expect(s.issued.length).toBe(0);
	});

	it("⑤ filter 必含转义后的用户名（esc 红线在真实调用路径上）", async () => {
		seedLdapSettings();
		const g = fakeGateway();
		await createLdapLogin(fakeSession(), g)("ali(*)", "pw").catch(() => {});
		expect(g.searches[0]).toBe("(uid=ali\\28\\2a\\29)");
	});

	it("⑥ bind false → 401；bind 抛 → 502", async () => {
		seedLdapSettings();
		const s = fakeSession();
		await expect(createLdapLogin(s, fakeGateway({ bind: () => false }))("alice", "pw")).rejects.toMatchObject({ status: 401 });
		const bindThrow = fakeGateway({ bind: () => Promise.reject(new Error("tls")) });
		await expect(createLdapLogin(s, bindThrow)("alice", "pw")).rejects.toMatchObject({ status: 502 });
		expect(s.issued.length).toBe(0);
	});

	it("⑦ JIT 建号：ldap:<uid> / !ldap / source=ldap / must_change=0 / email 映射 / 零角色", async () => {
		seedLdapSettings();
		const s = fakeSession();
		await createLdapLogin(s, fakeGateway())("alice", "pw");
		const row = dbo.prepare("SELECT username, password_hash, source, must_change, email, is_forbidden FROM users WHERE username = 'ldap:alice'").get() as Record<string, unknown>;
		expect(row.password_hash).toBe("!ldap");
		expect(row.source).toBe("ldap");
		expect(row.must_change).toBe(0); // 外来号无本地旧口令，悬挂期会 brick（设计 §9.4）
		expect(row.email).toBe("alice@example.com");
		expect(row.is_forbidden).toBe(0);
		expect(dbo.prepare("SELECT COUNT(*) n FROM sys_user_role WHERE user_id = (SELECT id FROM users WHERE username = 'ldap:alice')").get().n).toBe(0);
		expect(s.issued.length).toBe(1);
	});

	it("⑦ 撞 UNIQUE 竞态 → 回查复用，不重复建号", async () => {
		seedLdapSettings();
		dbo.prepare("INSERT INTO users (username, password_hash, source, must_change) VALUES ('ldap:alice', '!ldap', 'ldap', 0)").run();
		const s = fakeSession();
		await createLdapLogin(s, fakeGateway())("alice", "pw");
		expect(dbo.prepare("SELECT COUNT(*) n FROM users WHERE username = 'ldap:alice'").get().n).toBe(1);
		expect(s.issued.length).toBe(1);
	});

	it("⑧ is_forbidden=1 → 403 不签发（禁号闭环三处之二；bind 成功也不放行）", async () => {
		seedLdapSettings();
		dbo.prepare("INSERT INTO users (username, password_hash, source, must_change, is_forbidden) VALUES ('ldap:alice', '!ldap', 'ldap', 0, 1)").run();
		const s = fakeSession();
		await expect(createLdapLogin(s, fakeGateway())("alice", "pw")).rejects.toMatchObject({ status: 403 });
		expect(s.issued.length).toBe(0);
	});

	it("④ 映射缺省：uid_attr/mail  attr 缺省 uid/mail", async () => {
		seedLdapSettings({ ldap_uid_attr: "", ldap_email_attr: "" });
		const g = fakeGateway();
		await createLdapLogin(fakeSession(), g)("alice", "pw");
		expect(g.searches[0]).toBe("(uid=alice)");
	});
});
