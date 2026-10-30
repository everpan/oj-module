// BDD：企微代开发四个端点的**接线**（不是领域逻辑——那在 wecom-connector.spec.ts）。
//
// 这里钉的是最容易写错、且错得很安静的三件事：
//   1. 302 端点不能落进 respond（它末尾 json.ok 会把 302 覆盖成 200 信封）；
//   2. 企微事件端点必须回**纯文本** success / echostr（JSON 信封 = 企微判失败 → 重推三次）；
//   3. 回调链的租户来自服务端推导（state→profile → db.asTenant），且票据只能兑换一次。
//
// json / vars / kv / fetch / crypto 全部桩掉（oj 运行时全局同名同面）；密文用 WebCrypto 现造，
// 与 wecom-crypt.spec.ts 同一对照物，不拿自实现给自己背书。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bytesToB64, utf8Bytes, wecomSignature } from "../src/auth/api/_shared/wecom/crypt";
import { installDb } from "./fixture";

const g = globalThis as any;
let dbo: ReturnType<typeof installDb>;

const SUITE = "suite_1";
const TOKEN = "cb_token";
const AES_KEY = webcrypto.getRandomValues(new Uint8Array(32));
const AES_KEY_B64 = bytesToB64(AES_KEY);

interface Captured { status: number | null, body: any, location: string | null, text: string | null, contentType: string | null }

let out: Captured;

function installJson(): void {
	out = { status: null, body: null, location: null, text: null, contentType: null };
	const redirect = (url: string, code = 302) => {
		out.status = code;
		out.location = url;
	};
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
		raw: (data: unknown) => {
			out.status = 200;
			out.body = data;
		},
		redirect: Object.assign(redirect, {
			found: (url: string) => redirect(url, 302),
			seeOther: (url: string) => redirect(url, 303),
		}),
		stream: (opts?: { contentType?: string }) => {
			out.status = 200;
			out.contentType = opts?.contentType ?? null;
			return {
				write: (chunk: string) => {
					out.text = (out.text ?? "") + chunk;
				},
				end: () => {},
			};
		},
	};
}

function installVars(overrides: Record<string, string> = {}): void {
	const base: Record<string, string> = {
		wecom_suite_id: SUITE,
		wecom_suite_secret: "suite_secret",
		wecom_callback_token: TOKEN,
		wecom_encoding_aes_key: AES_KEY_B64.replace(/=$/, ""),
		// 32 字符 hex = 16 字节，是 oj aesGcmEncrypt 接受的两种尺寸之一
		wecom_enc_key: "0123456789abcdef0123456789abcdef",
		wecom_base_url: "https://site.example.com/api/auth/wecom",
		...overrides,
	};
	g.vars = { get: (name: string) => base[name] ?? null };
}

function installKv(): Map<string, string> {
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
	return store;
}

function installCrypto(): void {
	const c = {
		randomHex: (n = 32) => (n === 16 ? "state_nonce_0001" : `ticket_${"a".repeat(n * 2)}`),
		sha256Hex: (s: string) => `sha(${s})`,
		aesGcmEncrypt: (plain: string) => `gcm(${plain})`,
		aesGcmDecrypt: (blob: string) => blob.replace(/^gcm\((.*)\)$/, "$1"),
	};
	Object.defineProperty(globalThis, "crypto", { value: c, configurable: true });
}

/** 企微侧 webhook 的密文包（random|len|msg|receiveid → AES-256-CBC/PKCS#7） */
async function seal(plain: string, receiveId = SUITE): Promise<string> {
	const msg = utf8Bytes(plain);
	const head = webcrypto.getRandomValues(new Uint8Array(16));
	const len = new Uint8Array(4);
	new DataView(len.buffer).setUint32(0, msg.length);
	const recv = utf8Bytes(receiveId);
	const buf = new Uint8Array(20 + msg.length + recv.length);
	buf.set(head, 0);
	buf.set(len, 16);
	buf.set(msg, 20);
	buf.set(recv, 20 + msg.length);
	const key = await webcrypto.subtle.importKey("raw", AES_KEY, { name: "AES-CBC" }, false, ["encrypt"]);
	const cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-CBC", iv: AES_KEY.subarray(0, 16) }, key, buf));
	return bytesToB64(cipher);
}

function request(opts: { query?: Record<string, string>, body?: unknown, headers?: Record<string, string>, tenantId?: string } = {}): void {
	g.http = {
		method: "GET",
		query: opts.query ?? {},
		body: opts.body ?? null,
		headers: opts.headers ?? {},
		...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
	};
}

/** 预置一家已授权的企业（相当于 create_auth 已跑过） */
function seedCorp(corpId = "ww_corp_a", agentId = "100001"): void {
	dbo.prepare("INSERT INTO wecom_app_profile (suite_id, corp_id, agent_id, auth_corp_id, env, corp_name, status, permanent_code_enc, installed_at, update_time) VALUES (?, ?, ?, ?, 'prod', '测试企业', 'active', ?, 0, 0)")
		.run(SUITE, corpId, agentId, corpId, `gcm(perm_${corpId})`);
}

const api = async () => (await import("../src/auth/api/wecom/api")).default;

beforeAll(() => {
	dbo = installDb();
	g.db.asTenant = (id: string) => {
		if (g.http?.tenantId)
			throw new Error("tenant already set");
		g.http = { ...(g.http ?? {}), tenantId: id };
	};
	g.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
	g.jwt = { sign: (p: { sub: string }) => `jwt(${p.sub})`, accessDuration: 7200, refreshDuration: 2_592_000 };
	g.bcrypt = { hash: async (s: string) => `hashed:${s}`, verify: async () => false };
});

beforeEach(() => {
	installJson();
	installVars();
	installKv();
	installCrypto();
	g.fetch = async () => ({ ok: true, json: async () => ({}) });
	for (const t of ["wecom_app_profile", "wecom_suite_ticket", "wecom_login_ticket", "sys_refresh_token", "sys_login_throttle", "sys_rate_window", "sys_oplog"])
		dbo.exec(`DELETE FROM ${t}`);
	// JIT 建号是跨用例污染源：每个用例都从「本企业还没建过号」起步
	dbo.exec("DELETE FROM users WHERE source = 'wecom'");
});

afterEach(() => {
	g.http = {};
});

describe("P1-I：GET /auth/wecom/login（发起授权）", () => {
	it("部署常量缺失 → 400 信封并点出缺哪几个 vars（不是 500）", async () => {
		installVars({ wecom_suite_id: "", wecom_enc_key: "" });
		request({ query: { corp: "ww_corp_a" } });
		await (await api()).login.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/wecom_suite_id/);
		expect(out.location).toBeNull();
	});

	it("缺企业代码 → 400，引导去登录页填（不猜默认企业）", async () => {
		request({ query: {} });
		await (await api()).login.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/企业代码/);
	});

	it("未授权企业 → 400（文案不区分「没装」与「已停用」）", async () => {
		request({ query: { corp: "ww_unknown" } });
		await (await api()).login.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/无效或应用未开通/);
	});

	it("企微客户端内 → 302 到 oauth2 静默授权，redirect_uri 指向 <base>/callback", async () => {
		seedCorp();
		request({ query: { corp: "ww_corp_a" }, headers: { "user-agent": "Mozilla/5.0 wxwork/4.1.0" } });
		await (await api()).login.get();
		expect(out.status).toBe(302);
		expect(out.location).toContain("connect/oauth2/authorize");
		expect(out.location).toContain("agentid=100001");
		expect(out.location).toContain(encodeURIComponent("https://site.example.com/api/auth/wecom/callback"));
	});

	it("普通浏览器 → 302 到 qrConnect 扫码（appid = corpid）", async () => {
		seedCorp();
		request({ query: { corp: "ww_corp_a" }, headers: { "user-agent": "Mozilla/5.0 Chrome/120" } });
		await (await api()).login.get();
		expect(out.status).toBe(302);
		expect(out.location).toContain("wwopen/sso/qrConnect");
		expect(out.location).toContain("appid=ww_corp_a");
	});

	it("同一企业两个应用：未指定 agent → 400 提示带 agent 参数", async () => {
		seedCorp("ww_corp_a", "100001");
		seedCorp("ww_corp_a", "100002");
		request({ query: { corp: "ww_corp_a" }, headers: { "user-agent": "wxwork" } });
		await (await api()).login.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/agent/);
	});
});

describe("P1-J：GET /auth/wecom/callback（回跳换人 + 发票）", () => {
	async function startLogin(corp = "ww_corp_a"): Promise<string> {
		seedCorp(corp);
		request({ query: { corp }, headers: { "user-agent": "wxwork" } });
		await (await api()).login.get();
		const state = new URL(out.location!).searchParams.get("state")!;
		return state;
	}

	function stubUpstream(userid: string | null = "zhangsan", memberName: string | null = "张三"): void {
		g.fetch = async (url: string) => ({
			ok: true,
			json: async () => {
				if (url.includes("/cgi-bin/gettoken"))
					return { access_token: "corp_tk", expires_in: 7200 };
				if (url.includes("/cgi-bin/auth/getuserinfo"))
					return userid ? { errcode: 0, userid } : { errcode: 0, openid: "o_ext" };
				// 通讯录读权限：没有就是 60011，补名必须降级而不是失败
				if (url.includes("/cgi-bin/user/get"))
					return memberName ? { errcode: 0, name: memberName } : { errcode: 60011, errmsg: "no privilege" };
				throw new Error(`stub fetch 未预期：${url}`);
			},
		});
	}

	it("缺 code（用户取消授权）→ 400，不建号不发票", async () => {
		const state = await startLogin();
		request({ query: { state } });
		await (await api()).callback.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/code/);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_login_ticket").get()).toMatchObject({ n: 0 });
	});

	it("正常回跳 → 302 到 SPA 并只带**一次性票据**与租户；JIT 建号落 corp_id", async () => {
		const state = await startLogin();
		stubUpstream();
		request({ query: { code: "CODE_1", state } });
		await (await api()).callback.get();

		expect(out.status).toBe(302);
		const loc = new URL(out.location!);
		expect(loc.origin).toBe("https://site.example.com");
		expect(loc.pathname).toBe("/login");
		expect(loc.searchParams.get("tenant")).toBe("ww_corp_a");
		// URL 里只能是票据，不能出现 token
		expect(loc.search).not.toMatch(/access_token|refresh_token/);
		expect(loc.searchParams.get("wecom_ticket")).toBeTruthy();

		const row = dbo.prepare("SELECT username, source, corp_id, display_name FROM users WHERE source = 'wecom'").get();
		expect(row).toMatchObject({ username: "wecom:zhangsan", corp_id: "ww_corp_a", display_name: "张三" });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_login_ticket").get()).toMatchObject({ n: 1 });
	});

	it("取不到真实姓名（套件无通讯录权限）→ 用工号兜底建档，登录照常成功", async () => {
		const state = await startLogin();
		stubUpstream("zhangsan", null);
		request({ query: { code: "CODE_1", state } });
		await (await api()).callback.get();

		expect(out.status).toBe(302);
		expect(dbo.prepare("SELECT display_name FROM users WHERE username = 'wecom:zhangsan'").get()).toMatchObject({ display_name: "zhangsan" });
	});

	it("state 一次性：同一 state 重放 → 400（不重复发票）", async () => {
		const state = await startLogin();
		stubUpstream();
		request({ query: { code: "CODE_1", state } });
		await (await api()).callback.get();
		expect(out.status).toBe(302);

		installJson();
		request({ query: { code: "CODE_1", state } });
		await (await api()).callback.get();
		expect(out.status).toBe(400);
	});

	it("非本企业成员（企微只回 openid）→ 401，且不留半截账号", async () => {
		const state = await startLogin();
		stubUpstream(null);
		request({ query: { code: "CODE_1", state } });
		await (await api()).callback.get();
		expect(out.status).toBe(401);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE source = 'wecom'").get()).toMatchObject({ n: 0 });
	});
});

describe("P1-K：POST /auth/wecom/ticket（票据换会话）", () => {
	async function issueTicket(): Promise<string> {
		const state = "st_1";
		installKv();
		await g.kv.set(`wecom:state:${state}`, JSON.stringify({ corpId: "ww_corp_a", agentId: "100001", env: "prod" }));
		seedCorp();
		g.fetch = async (url: string) => ({
			ok: true,
			json: async () => (url.includes("gettoken") ? { access_token: "t", expires_in: 7200 } : { errcode: 0, userid: "zhangsan" }),
		});
		request({ query: { code: "CODE_1", state } });
		await (await api()).callback.get();
		return new URL(out.location!).searchParams.get("wecom_ticket")!;
	}

	it("换出 TokenBundle（access + refresh + user），票据随即作废", async () => {
		const ticket = await issueTicket();
		installJson();
		request({ body: { ticket }, tenantId: "ww_corp_a" });
		await (await api()).ticket.post();

		expect(out.status).toBe(200);
		expect(out.body.access_token).toMatch(/^jwt\(/);
		expect(out.body.refresh_token).toMatch(/^ticket_/);
		expect(out.body.user.username).toBe("wecom:zhangsan");
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token").get()).toMatchObject({ n: 1 });

		installJson();
		request({ body: { ticket }, tenantId: "ww_corp_a" });
		await (await api()).ticket.post();
		expect(out.status).toBe(401);
	});

	it("租户头与票据不一致 → 403（前端忘了带 ?tenant= 必须当场炸，不能悄悄落默认租户）", async () => {
		const ticket = await issueTicket();
		installJson();
		request({ body: { ticket }, tenantId: "default" });
		await (await api()).ticket.post();
		expect(out.status).toBe(403);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token").get()).toMatchObject({ n: 0 });
	});

	it("缺 ticket → 400", async () => {
		request({ body: {} });
		await (await api()).ticket.post();
		expect(out.status).toBe(400);
	});
});

describe("P1-L：GET/POST /auth/wecom/event（企微指令回调）", () => {
	const TS = "1700000000";
	const NONCE = "n0nce";

	function signedQuery(encrypted: string): Record<string, string> {
		return { timestamp: TS, nonce: NONCE, msg_signature: wecomSignature(TOKEN, TS, NONCE, encrypted) };
	}

	it("URL 验证：验签通过 → 以 text/plain 原样回解出的 echostr（不套信封）", async () => {
		const echo = await seal("echo_12345");
		request({ query: { ...signedQuery(echo), echostr: echo } });
		await (await api()).event.get();
		expect(out.status).toBe(200);
		expect(out.contentType).toContain("text/plain");
		expect(out.text).toBe("echo_12345");
		expect(out.body).toBeNull();
	});

	it("签名不符 → 400（不给探测者任何比对材料）", async () => {
		const echo = await seal("echo_12345");
		request({ query: { timestamp: TS, nonce: NONCE, msg_signature: "bad", echostr: echo } });
		await (await api()).event.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/签名/);
	});

	it("指令回调：验签+解密 → 落 suite_ticket → 回纯文本 success", async () => {
		const plain = "<xml><InfoType>suite_ticket</InfoType><SuiteId>suite_1</SuiteId><SuiteTicket>tk_9</SuiteTicket></xml>";
		const encrypted = await seal(plain);
		request({ query: signedQuery(encrypted), body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>` });
		await (await api()).event.post();
		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		expect(dbo.prepare("SELECT suite_ticket FROM wecom_suite_ticket WHERE suite_id = ?").get(SUITE)).toMatchObject({ suite_ticket: "tk_9" });
	});

	it("报文缺 Encrypt → 400", async () => {
		request({ query: signedQuery("x"), body: "<xml></xml>" });
		await (await api()).event.post();
		expect(out.status).toBe(400);
	});

	it("密文属于别的套件（receiveid 不符）→ 400，不落任何状态", async () => {
		const encrypted = await seal("<xml><InfoType>suite_ticket</InfoType><SuiteTicket>tk_x</SuiteTicket></xml>", "other_suite");
		request({ query: signedQuery(encrypted), body: `<xml><Encrypt>${encrypted}</Encrypt></xml>` });
		await (await api()).event.post();
		expect(out.status).toBe(400);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_suite_ticket").get()).toMatchObject({ n: 0 });
	});
});
