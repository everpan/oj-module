// BDD：代开发后台（服务商运营面）——清单 / 启停 / 开通入口 + 三个端点的接线。
//
// 这里钉的是「运营动作的正确边界」，不是企微协议（协议在 wecom-connector.spec.ts）：
//   1. 清单**不带** permanent_code（secret 不出库：连 superadmin 也不给看）；
//   2. 停用**一个应用 ≠ 停用一家企业**（同企业测试/正式两应用，停测试不得把正式用户踢下线）；
//   3. 停用到该企业最后一个启用应用时才吊销会话，且只吊销**该租户**的；
//   4. 判权缓存随吊销立即失效（撤销即强退，D10）——用「删角色后 stale 仍放行 → 停用后立刻 403」反证；
//   5. 端点仅 superadmin（admin 属于某个租户，不该看别家 corp_id）。
//
// 夹具即真实库（真迁移 + 真 sqlite），全局 json/http/vars/kv/crypto/fetch 按 oj 同名同面桩掉。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertSuperAdmin, invalidateAllUsers } from "../src/_platform/api/_shared/service/infra/access";
import { listApps, setAppStatus } from "../src/auth/api/_shared/wecom/admin";
import { createWecomClient, runtimeCache, runtimeHttp } from "../src/auth/api/_shared/wecom/client";
import { installUrlOf, readWecomConfig, siteRootOf } from "../src/auth/api/_shared/wecom/config";
import { installDb } from "./fixture";

const g = globalThis as any;
let dbo: ReturnType<typeof installDb>;

const SUITE = "suite_1";
const AES_KEY_B64 = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64");
const NOW = 1_700_000_000;

interface Captured { status: number | null, body: any }

let out: Captured;

function installJson(): void {
	out = { status: null, body: null };
	g.json = {
		ok: (data?: unknown) => {
			out.status = 200;
			out.body = data;
		},
		fail: (code: number, msg: string, data?: unknown) => {
			out.status = code;
			out.body = data === undefined ? { code, msg } : { code, msg, data };
		},
		header: () => {},
		raw: () => {},
		redirect: Object.assign(() => {}, { found: () => {}, seeOther: () => {} }),
		stream: () => ({ write: () => {}, end: () => {} }),
	};
}

function installVars(overrides: Record<string, string> = {}): void {
	const base: Record<string, string> = {
		wecom_suite_id: SUITE,
		wecom_suite_secret: "suite_secret",
		wecom_callback_token: "cb_token",
		wecom_encoding_aes_key: AES_KEY_B64.replace(/=$/, ""),
		wecom_enc_key: "0123456789abcdef0123456789abcdef",
		wecom_base_url: "https://site.example.com/api/auth/wecom",
		...overrides,
	};
	g.vars = { get: (name: string) => base[name] ?? null };
}

/** 每次换新 Map：suite_token 有 kv 缓存，跨用例复用会把「该打的上游」吞掉 */
function installKv(): void {
	const store = new Map<string, string>();
	g.kv = {
		get: async (k: string) => store.get(k) ?? null,
		set: async (k: string, v: string) => {
			store.set(k, v);
		},
		del: async (k: string) => {
			store.delete(k);
		},
		expire: async () => 1,
		incr: async () => 1,
	};
}

function installCrypto(): void {
	Object.defineProperty(globalThis, "crypto", {
		value: {
			randomHex: (n = 32) => `r${"a".repeat(n * 2)}`,
			sha256Hex: (s: string) => `sha(${s})`,
			aesGcmEncrypt: (plain: string) => `gcm(${plain})`,
			aesGcmDecrypt: (blob: string) => blob.replace(/^gcm\((.*)\)$/, "$1"),
		},
		configurable: true,
	});
}

function request(opts: { query?: Record<string, string>, body?: unknown, user?: { id: number } } = {}): void {
	g.http = { method: "GET", query: opts.query ?? {}, body: opts.body ?? null, headers: {}, ...(opts.user ? { user: opts.user } : {}) };
}

function seedCorp(corpId = "ww_corp_a", agentId = "100001", env = "prod", status = "active", authCorpId = corpId): void {
	dbo.prepare("INSERT INTO wecom_app_profile (suite_id, corp_id, agent_id, auth_corp_id, env, corp_name, status, permanent_code_enc, installed_at, update_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
		.run(SUITE, corpId, agentId, authCorpId, env, `企业 ${corpId}`, status, `gcm(perm_${corpId}_${agentId})`, NOW, NOW);
}

function seedTicket(ticket = "tk_9", expiresAt = NOW + 1800): void {
	dbo.prepare("INSERT INTO wecom_suite_ticket (suite_id, suite_ticket, expires_at, update_time) VALUES (?, ?, ?, ?)").run(SUITE, ticket, expiresAt, NOW);
}

function mkUser(username: string, roles: string[] = []): number {
	dbo.prepare("INSERT INTO users (username, password_hash) VALUES (?, 'x')").run(username);
	const id = (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
	for (const r of roles)
		dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(id, r);
	return id;
}

/** 只关心 invalidateCorpToken 是否被调（其余成员由类型收窄成 unknown） */
function fakeClient(): { client: any, invalidated: string[] } {
	const invalidated: string[] = [];
	return {
		client: {
			invalidateCorpToken: async (corpId: string, agentId: string) => {
				invalidated.push(`${corpId}:${agentId}`);
			},
		},
		invalidated,
	};
}

const deps = { store: { encrypt: (p: string) => `gcm(${p})`, decrypt: (b: string) => b, now: () => NOW } };

/** createInstall 的薄包装：store.now 固定，避免用例依赖真实时钟 */
async function createInstallForTest(cfg: ReturnType<typeof readWecomConfig>, client: ReturnType<typeof createWecomClient>, state: string) {
	const { createInstall } = await import("../src/auth/api/_shared/wecom/admin");
	return createInstall(cfg, client, deps.store, state);
}

const api = async () => (await import("../src/auth/api/wecom/admin/api")).default;

beforeAll(() => {
	dbo = installDb();
	g.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
	g.db.asTenant = () => {
		throw new Error("管理面不应调用 asTenant（请求已带租户头）");
	};
});

beforeEach(() => {
	installJson();
	installVars();
	installKv();
	installCrypto();
	g.fetch = async () => ({ ok: true, json: async () => ({}) });
	for (const t of ["wecom_app_profile", "wecom_suite_ticket", "sys_refresh_token", "sys_oplog", "sys_user_role"])
		dbo.exec(`DELETE FROM ${t}`);
	invalidateAllUsers();
});

afterEach(() => {
	g.http = {};
	invalidateAllUsers();
});

describe("P3-A：清单（listApps）", () => {
	it("不返回 permanent_code（secret 不出库，superadmin 也不给看）", async () => {
		seedCorp();
		const rows = await listApps();
		expect(rows).toHaveLength(1);
		expect(Object.keys(rows[0]!)).not.toContain("permanent_code_enc");
		expect(JSON.stringify(rows)).not.toContain("perm_ww_corp_a");
	});

	it("稳定序：先企业再应用，同企业测试/正式两行相邻", async () => {
		seedCorp("ww_b", "100002");
		seedCorp("ww_a", "100009", "prod");
		seedCorp("ww_a", "100001", "test");
		const rows = await listApps();
		expect(rows.map(r => `${r.corp_id}:${r.agent_id}`)).toEqual(["ww_a:100001", "ww_a:100009", "ww_b:100002"]);
	});

	it("空表 → []（不是报错）", async () => {
		await expect(listApps()).resolves.toEqual([]);
	});
});

describe("P3-B：启停（setAppStatus）", () => {
	it("企业代码/应用不匹配 → 404，且不改任何行", async () => {
		seedCorp("ww_a", "100001");
		const { client } = fakeClient();
		await expect(setAppStatus("ww_a", "999999", "disabled", { client, ...deps }))
			.rejects
			.toMatchObject({ status: 404 });
		expect(dbo.prepare("SELECT status FROM wecom_app_profile").get()).toMatchObject({ status: "active" });
	});

	it("停用同企业两个应用中的一个 → 不吊销会话（否则停测试应用会把正式用户踢下线）", async () => {
		seedCorp("ww_a", "100001", "test");
		seedCorp("ww_a", "100002", "prod");
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h1', 'ww_a', 1, ?, 0, ?)").run(NOW + 100, NOW);
		const { client, invalidated } = fakeClient();

		const r = await setAppStatus("ww_a", "100001", "disabled", { client, ...deps });
		expect(r).toEqual({ updated: 1, revokedSessions: 0 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token WHERE tenant_id = 'ww_a'").get()).toMatchObject({ n: 1 });
		// secret 仍可能在另一状态被缓存：无论启停都先让企业 token 失效
		expect(invalidated).toEqual(["ww_a:100001"]);
	});

	it("停用该企业最后一个启用应用 → 只吊销该租户的会话", async () => {
		seedCorp("ww_a", "100001");
		seedCorp("ww_b", "100002");
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h1', 'ww_a', 1, ?, 0, ?)").run(NOW + 100, NOW);
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h2', 'ww_a', 2, ?, 0, ?)").run(NOW + 100, NOW);
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h3', 'ww_b', 3, ?, 0, ?)").run(NOW + 100, NOW);
		const { client } = fakeClient();

		const r = await setAppStatus("ww_a", "100001", "disabled", { client, ...deps });
		expect(r).toEqual({ updated: 1, revokedSessions: 2 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token").get()).toMatchObject({ n: 1 });
		expect(dbo.prepare("SELECT tenant_id FROM sys_refresh_token").get()).toMatchObject({ tenant_id: "ww_b" });
	});

	it("吊销会同时清判权缓存（撤销即强退）：stale 快照在停用后立刻失效", async () => {
		const uid = mkUser("u_super", ["superadmin"]);
		request({ user: { id: uid } });
		await expect(assertSuperAdmin()).resolves.toBeUndefined();

		// 直接删角色绕过写路径 → 判权缓存此时仍是 stale（10s TTL 内的正常残留）
		dbo.exec("DELETE FROM sys_user_role");
		await expect(assertSuperAdmin()).resolves.toBeUndefined();

		seedCorp("ww_a", "100001");
		const { client } = fakeClient();
		await setAppStatus("ww_a", "100001", "disabled", { client, ...deps });

		await expect(assertSuperAdmin()).rejects.toMatchObject({ status: 403 });
	});

	it("启用不动会话，但仍让企业 token 缓存失效", async () => {
		seedCorp("ww_a", "100001", "prod", "disabled");
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h1', 'ww_a', 1, ?, 0, ?)").run(NOW + 100, NOW);
		const { client, invalidated } = fakeClient();

		const r = await setAppStatus("ww_a", "100001", "active", { client, ...deps });
		expect(r).toEqual({ updated: 1, revokedSessions: 0 });
		expect(invalidated).toEqual(["ww_a:100001"]);
		expect(dbo.prepare("SELECT status FROM wecom_app_profile").get()).toMatchObject({ status: "active" });
	});

	it("按 auth_corp_id（open_corpid）也能定位同一个应用", async () => {
		seedCorp("ww_real", "100001", "prod", "active", "open_corp_x");
		const { client } = fakeClient();
		await expect(setAppStatus("open_corp_x", "100001", "disabled", { client, ...deps }))
			.resolves
			.toMatchObject({ updated: 1 });
	});
});

describe("P3-C：开通入口（createInstall）", () => {
	function stubUpstream(preAuth = "PRE_1", expiresIn = 600): string[] {
		const calls: string[] = [];
		g.fetch = async (url: string) => {
			calls.push(url);
			return {
				ok: true,
				json: async () => {
					if (url.includes("get_suite_token"))
						return { suite_access_token: "suite_tk", expires_in: 7200 };
					if (url.includes("get_pre_auth_code"))
						return { pre_auth_code: preAuth, expires_in: expiresIn };
					throw new Error(`stub fetch 未预期：${url}`);
				},
			};
		};
		return calls;
	}

	it("suite_ticket → suite_token → 预授权码 → install URL（redirect_uri 落站点根登录页）", async () => {
		seedTicket();
		const calls = stubUpstream();
		const cfg = readWecomConfig();
		const client = createWecomClient({ http: runtimeHttp(), cache: runtimeCache() });

		const r = await createInstallForTest(cfg, client, "st_1");
		expect(calls.some(u => u.includes("get_suite_token"))).toBe(true);
		expect(calls.some(u => u.includes("get_pre_auth_code"))).toBe(true);
		expect(r.callbackUrl).toBe("https://site.example.com/api/auth/wecom/event");
		expect(r.expiresIn).toBe(600);

		const url = new URL(r.installUrl);
		expect(`${url.origin}${url.pathname}`).toBe("https://open.work.weixin.qq.com/3rdapp/install");
		expect(url.searchParams.get("suite_id")).toBe(SUITE);
		expect(url.searchParams.get("pre_auth_code")).toBe("PRE_1");
		expect(url.searchParams.get("redirect_uri")).toBe("https://site.example.com/login?wecom_installed=1");
		expect(url.searchParams.get("state")).toBe("st_1");
	});

	it("子路径部署：redirect_uri 保留 /oj（回跳不落到宿主机根）", () => {
		installVars({ wecom_base_url: "https://site.example.com/oj/api/auth/wecom" });
		const cfg = readWecomConfig();
		expect(siteRootOf(cfg)).toBe("https://site.example.com/oj");
		const url = new URL(installUrlOf(cfg, "PRE_1", ""));
		expect(url.searchParams.get("redirect_uri")).toBe("https://site.example.com/oj/login?wecom_installed=1");
		// state 为空时不出现在 URL 里（不塞空串进去骗企微后台）
		expect(url.searchParams.has("state")).toBe(false);
	});

	it("缺 suite_ticket（回调未打通/已过期）→ 503，不白跑一趟上游", async () => {
		const calls = stubUpstream();
		const cfg = readWecomConfig();
		const client = createWecomClient({ http: runtimeHttp(), cache: runtimeCache() });
		await expect(createInstallForTest(cfg, client, "")).rejects.toMatchObject({ status: 503 });
		expect(calls).toEqual([]);
	});

	it("上游 errcode → 502（可重试语义，不是 500）", async () => {
		seedTicket();
		g.fetch = async () => ({ ok: true, json: async () => ({ errcode: 40001, errmsg: "invalid credential" }) });
		const cfg = readWecomConfig();
		const client = createWecomClient({ http: runtimeHttp(), cache: runtimeCache() });
		await expect(createInstallForTest(cfg, client, "")).rejects.toMatchObject({ status: 502 });
	});
});

describe("P3-D：端点接线（/auth/wecom/admin/*）", () => {
	it("superadmin 才能进：admin 与未登录都 403", async () => {
		const adminId = mkUser("u_admin", ["admin"]);
		request({ user: { id: adminId } });
		await (await api()).apps.get();
		expect(out.status).toBe(403);

		installJson();
		request({});
		await (await api()).apps.get();
		expect(out.status).toBe(403);
	});

	it("apps.get → 200 + 数组（不含 permanent_code）", async () => {
		seedCorp();
		const uid = mkUser("u_super2", ["superadmin"]);
		request({ user: { id: uid } });
		await (await api()).apps.get();
		expect(out.status).toBe(200);
		expect(out.body).toHaveLength(1);
		expect(JSON.stringify(out.body)).not.toContain("perm_");
	});

	it("status.post 缺字段 / status 非法 → 400（不猜默认值）", async () => {
		const uid = mkUser("u_super3", ["superadmin"]);
		request({ user: { id: uid }, body: { corpId: "ww_a" } });
		await (await api()).status.post();
		expect(out.status).toBe(400);

		installJson();
		request({ user: { id: uid }, body: { corpId: "ww_a", agentId: "1", status: "paused" } });
		await (await api()).status.post();
		expect(out.status).toBe(400);
	});

	it("status.post 停用 → 200 并记安全级审计（level 4）", async () => {
		seedCorp("ww_a", "100001");
		const uid = mkUser("u_super4", ["superadmin"]);
		request({ user: { id: uid }, body: { corpId: "ww_a", agentId: "100001", status: "disabled" } });
		await (await api()).status.post();

		expect(out.status).toBe(200);
		expect(out.body).toEqual({ updated: 1, revokedSessions: 0 });
		const op = dbo.prepare("SELECT action, module, target, level, detail FROM sys_oplog ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
		expect(op).toMatchObject({ action: "wecom.admin.disable", module: "auth", target: "ww_a", level: 4 });
		expect(String(op.detail)).toContain("100001");
	});

	it("status.post 未开通的企业 → 404（不是 500）", async () => {
		const uid = mkUser("u_super5", ["superadmin"]);
		request({ user: { id: uid }, body: { corpId: "ww_none", agentId: "1", status: "disabled" } });
		await (await api()).status.post();
		expect(out.status).toBe(404);
		// 404 不该留审计（动作没发生）
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_oplog").get()).toMatchObject({ n: 0 });
	});

	it("install.get 未配置部署常量 → 400 并点名缺哪几个 vars", async () => {
		installVars({ wecom_suite_id: "", wecom_base_url: "" });
		const uid = mkUser("u_super6", ["superadmin"]);
		request({ user: { id: uid } });
		await (await api()).install.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/wecom_suite_id/);
		expect(out.body.msg).toMatch(/wecom_base_url/);
	});
});
