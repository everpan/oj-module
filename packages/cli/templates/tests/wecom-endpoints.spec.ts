// BDD：企微代开发四个端点的**接线**（不是领域逻辑——那在 wecom-connector.spec.ts）。
//
// 这里钉的是最容易写错、且错得很安静的三件事：
//   1. 302 端点不能落进 respond（它末尾 json.ok 会把 302 覆盖成 200 信封）；
//   2. 企微事件端点必须回**纯文本** success / echostr（JSON 信封 = 企微判失败 → 重推三次）；
//   3. 回调链的租户来自服务端推导（state→profile → db.asTenant），且票据只能兑换一次。
//
// json / vars / kv / fetch / crypto 全部桩掉（oj 运行时全局同名同面）；密文用 node:crypto 现造，
// 与 wecom-crypt.spec.ts 同一对照物，不拿自实现给自己背书。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { Buffer } from "node:buffer";
import { createCipheriv, webcrypto } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bytesToB64, sha1Hex, utf8Bytes, wecomSignature } from "../src/auth/api/_shared/wecom/crypt";
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
	// 计数也是真的（有理）：重放防护靠 incr 的原子返回值判断「谁是第一个」，
	// 恒返回 1 的桩会把这条防线伪装成通过。
	const counters = new Map<string, number>();
	g.kv = {
		get: async (k: string) => store.get(k) ?? null,
		set: async (k: string, v: string) => {
			store.set(k, v);
		},
		del: async (k: string) => {
			store.delete(k);
			counters.delete(k);
		},
		expire: async () => 1,
		incr: async (k: string) => {
			const n = (counters.get(k) ?? 0) + 1;
			counters.set(k, n);
			return n;
		},
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

/**
 * 企微侧 webhook 的密文包（random|len|msg|receiveid → AES-256-CBC，PKCS#7 **补到 32 字节**）。
 *
 * 补到 32 而不是 16：企微（90968）就是这么补的，补位值会落在 1~32——用 WebCrypto 的默认补位
 * （固定 16 字节块）会永远只覆盖到 1~16，正好把线上约一半的报文排除在测试之外（真踩过）。
 * 所以这里用 node:crypto 并关掉自动补位，自己按 32 补。
 */
async function seal(plain: string, receiveId = SUITE): Promise<string> {
	const msg = utf8Bytes(plain);
	const head = webcrypto.getRandomValues(new Uint8Array(16));
	const len = new Uint8Array(4);
	new DataView(len.buffer).setUint32(0, msg.length);
	const recv = utf8Bytes(receiveId);
	const body = Buffer.concat([Buffer.from(head), Buffer.from(len), Buffer.from(msg), Buffer.from(recv)]);
	const pad = 32 - (body.length % 32);
	const cipher = createCipheriv("aes-256-cbc", Buffer.from(AES_KEY), Buffer.from(AES_KEY.subarray(0, 16)));
	cipher.setAutoPadding(false);
	return Buffer.concat([cipher.update(Buffer.concat([body, Buffer.alloc(pad, pad)])), cipher.final()]).toString("base64");
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
	for (const t of ["wecom_app_profile", "wecom_suite_ticket", "wecom_login_ticket", "sys_refresh_token", "sys_login_throttle", "sys_rate_window", "sys_oplog", "sys_dept_member", "sys_department"])
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

	// 代开发模板常只服务一家企业：corp 缺省时从已安装档案自动解析，好让「应用主页」直接填
	// `https://<域名>/login`（企微后台会因 URL 里的 `${corpid}` 占位符字符拒收）。三种情形分开钉。
	it("缺企业代码且一家都没装 → 400，指向「生成开通链接」（不猜默认企业）", async () => {
		request({ query: {} });
		await (await api()).login.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/尚未完成企业微信授权/);
	});

	it("缺企业代码但只装了一家 → 302 到该企业的授权地址（省掉手填企业代码）", async () => {
		seedCorp();
		request({ query: {}, headers: { "user-agent": "Mozilla/5.0 Chrome/120" } });
		await (await api()).login.get();
		expect(out.status).toBe(302);
		expect(out.location).toContain("appid=ww_corp_a");
	});

	it("缺企业代码且装了多家 → 400，要求链接里带 corp 参数区分", async () => {
		seedCorp("ww_corp_a");
		seedCorp("ww_corp_b");
		request({ query: {} });
		await (await api()).login.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/corp/);
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
	// 必须是「当下」：服务端按 ±5 分钟窗口挡重放，写死历史时间戳等于主动把自己判成重放
	const nowSecs = () => Math.floor(Date.now() / 1000);
	const TS = String(nowSecs());
	const NONCE = "n0nce";
	const TICKET_XML = "<xml><InfoType>suite_ticket</InfoType><SuiteId>suite_1</SuiteId><SuiteTicket>tk_9</SuiteTicket></xml>";

	function signedQuery(encrypted: string, overrides: Partial<Record<string, string>> = {}): Record<string, string> {
		const query = { timestamp: TS, nonce: NONCE, ...overrides } as Record<string, string>;
		return { ...query, msg_signature: wecomSignature(TOKEN, query.timestamp, query.nonce, encrypted) };
	}

	/** 抓这一段里所有 log.info / log.warn 的 (msg, kv)：验收看的是日志，不是只看 HTTP 200 */
	async function captureLogs(fn: () => Promise<void>): Promise<unknown[][]> {
		const lines: unknown[][] = [];
		const orig = g.log;
		const push = (msg: string, ...kv: unknown[]) => void lines.push([msg, kv]);
		g.log = { ...orig, info: push, warn: push };
		try {
			await fn();
		}
		finally {
			g.log = orig;
		}
		return lines;
	}

	/** 取某条日志的 kv 片段；没这条就当场失败，别让后面的断言在 undefined 上跑 */
	function logOf(lines: unknown[][], msg: string): unknown {
		const line = lines.find(a => a[0] === msg);
		expect(line, `没抓到日志：${msg}`).toBeDefined();
		return line![1];
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

	it("URL 验证（鸡生蛋解法）：suite_id 尚未下发时也能通过——receiveid 放宽，签名仍是唯一闸门", async () => {
		// 引导期：模版还没建、suite_id 为空，但 Tier A 凭据（token/aeskey）已配齐，服务应能响应验证。
		installVars({ wecom_suite_id: "" });
		const echo = await seal("echo_bootstrap");
		request({ query: { ...signedQuery(echo), echostr: echo } });
		await (await api()).event.get();
		expect(out.status).toBe(200);
		expect(out.contentType).toContain("text/plain");
		expect(out.text).toBe("echo_bootstrap");
	});

	it("签名不符 → 400（不给探测者任何比对材料）", async () => {
		const echo = await seal("echo_12345");
		request({ query: { timestamp: TS, nonce: NONCE, msg_signature: "bad", echostr: echo } });
		await (await api()).event.get();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/签名/);
	});

	it("指令回调（文档形态：XML）→ 落 suite_ticket → 回纯文本 success", async () => {
		// 96238 §3.2 的报文就是这个形状，也是线上真正会到的形态
		const plain = "<xml><InfoType>suite_ticket</InfoType><SuiteId>suite_1</SuiteId><SuiteTicket>tk_9</SuiteTicket></xml>";
		const encrypted = await seal(plain);
		request({ query: signedQuery(encrypted), body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>` });
		await (await api()).event.post();
		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		expect(dbo.prepare("SELECT suite_ticket FROM wecom_suite_ticket WHERE suite_id = ?").get(SUITE)).toMatchObject({ suite_ticket: "tk_9" });
	});

	it("指令回调（JSON 包体）：信封小写键 + 明文字段照常落库", async () => {
		// 回调地址不带 callback_format=json（文档没覆盖这个参数，见 config.ts::eventUrlOf），
		// 但归一化那层两种都认：万一上游改发 JSON，上下两层分别是
		// {"tousername","encrypt","agentid"}（小写）与 {"InfoType",…}（大写）。
		// 这条钉的是「大小写不敏感」这一层，别再让人回头改一次字段名。
		const plain = JSON.stringify({ InfoType: "suite_ticket", SuiteId: SUITE, SuiteTicket: "tk_json" });
		const encrypted = await seal(plain);
		request({ query: signedQuery(encrypted), body: { tousername: SUITE, encrypt: encrypted, agentid: "100001" } });
		await (await api()).event.post();
		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		expect(dbo.prepare("SELECT suite_ticket FROM wecom_suite_ticket WHERE suite_id = ?").get(SUITE)).toMatchObject({ suite_ticket: "tk_json" });
	});

	it("指令回调（JSON 字符串包体）：未经框架解析的原始串也能归一", async () => {
		const plain = JSON.stringify({ InfoType: "suite_ticket", SuiteId: SUITE, SuiteTicket: "tk_str" });
		const encrypted = await seal(plain);
		request({ query: signedQuery(encrypted), body: JSON.stringify({ tousername: SUITE, encrypt: encrypted }) });
		await (await api()).event.post();
		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		expect(dbo.prepare("SELECT suite_ticket FROM wecom_suite_ticket WHERE suite_id = ?").get(SUITE)).toMatchObject({ suite_ticket: "tk_str" });
	});

	it("数据回调 change_contact（应用侧形态：MsgType/Event，无 InfoType）→ 走轨三建档", async () => {
		// 90970「成员变更通知」的原样字段：ToUserName/FromUserName/CreateTime/MsgType=event/
		// Event=change_contact/ChangeType/UserID/Name/Department。
		// 这条钉的是整条接线：解密 → 按 Event 分流（InfoType 为空）→ 绑租户 → 落库。
		seedCorp();
		const plain = [
			"<xml>",
			"<ToUserName><![CDATA[ww_corp_a]]></ToUserName>",
			"<FromUserName><![CDATA[sys]]></FromUserName>",
			"<CreateTime>1700000000</CreateTime>",
			"<MsgType><![CDATA[event]]></MsgType>",
			"<Event><![CDATA[change_contact]]></Event>",
			"<ChangeType><![CDATA[create_user]]></ChangeType>",
			"<UserID><![CDATA[zhangsan]]></UserID>",
			"<Name><![CDATA[张三]]></Name>",
			"<Department>1</Department>",
			"</xml>",
		].join("");
		// 应用回调的 receiveid 是 **corpid**（90968 附注），不是 suiteid——信封 ToUserName 也是它
		const encrypted = await seal(plain, "ww_corp_a");
		const lines = await captureLogs(async () => {
			request({
				query: signedQuery(encrypted),
				body: `<xml><ToUserName><![CDATA[ww_corp_a]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
			});
			await (await api()).event.post();
		});

		// 无论处理成没成，都必须回 success：否则企微 5 秒后重推三次
		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		expect(logOf(lines, "wecom change_contact applied")).toEqual(["changeType", "create_user", "corpId", "ww_corp_a"]);

		// 上游在本用例里拿不到 token（user/get 取不到）→ 退回事件自带字段：
		// 姓名落库、**activated 保持 0**（建档 ≠ 用过本站，§9.1 的通讯录目录只收登录过的人）
		expect(dbo.prepare("SELECT display_name, source, activated FROM users WHERE username = ?").get("wecom:zhangsan"))
			.toMatchObject({ display_name: "张三", source: "wecom", activated: 0 });
		// 值一律不进日志（姓名、工号都在明文里）
		expect(JSON.stringify(lines)).not.toContain("张三");
		expect(JSON.stringify(lines)).not.toContain("zhangsan");
	});

	it("数据回调 change_contact（代开发形态：InfoType）→ 同样进轨三，只给 Id 也能落库", async () => {
		// 91134「成员通知事件」走的是模板指令回调，字段是 SuiteId/AuthCorpId/InfoType=change_contact，
		// 没有 MsgType/Event。它与 suite_ticket 同用 InfoType 那一列，分流必须在 switch 之前——
		// 落进 default 只会被记成「不消费的事件」，页面永远等不到部门。
		seedCorp();
		const plain = [
			"<xml>",
			"<SuiteId><![CDATA[suite_1]]></SuiteId>",
			"<AuthCorpId><![CDATA[ww_corp_a]]></AuthCorpId>",
			"<InfoType><![CDATA[change_contact]]></InfoType>",
			"<ChangeType><![CDATA[update_party]]></ChangeType>",
			"<Id>2</Id>",
			"<Name><![CDATA[研发部]]></Name>",
			"<ParentId>1</ParentId>",
			"</xml>",
		].join("");
		const encrypted = await seal(plain);
		const lines = await captureLogs(async () => {
			request({ query: signedQuery(encrypted), body: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>` });
			await (await api()).event.post();
		});

		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		expect(logOf(lines, "wecom change_contact applied")).toEqual(["changeType", "update_party", "corpId", "ww_corp_a"]);
		expect(dbo.prepare("SELECT origin, origin_id, name, deleted FROM sys_department WHERE origin = 'wecom'").get())
			.toMatchObject({ origin: "wecom", origin_id: "2", name: "研发部", deleted: 0 });
		expect(JSON.stringify(lines)).not.toContain("研发部");
	});

	it("未授权企业的通讯录事件：只记一笔，照旧回 success（事件是加速器不是权威）", async () => {
		// 没 seedCorp：企业没授权、没有永久码，什么都不该写——但也不能抛，
		// 否则企微重推三次，而重推补不回「这家企业没授权」。
		const plain = "<xml><ToUserName><![CDATA[ww_corp_z]]></ToUserName><MsgType>event</MsgType><Event>change_contact</Event><ChangeType>delete_user</ChangeType><UserID>lisi</UserID></xml>";
		const encrypted = await seal(plain, "ww_corp_z");
		const lines = await captureLogs(async () => {
			request({ query: signedQuery(encrypted), body: `<xml><ToUserName><![CDATA[ww_corp_z]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>` });
			await (await api()).event.post();
		});
		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		expect(JSON.stringify(logOf(lines, "wecom change_contact ignored"))).toContain("未授权");
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE source = 'wecom'").get()).toMatchObject({ n: 0 });
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

	// 2026-11-01 生产时序：create_auth → 上游 502 → 企微 5 秒后重推 → 被「nonce 重复」挡回。
	// 重推是瞬态故障唯一的恢复路径，让它废在重放守卫上等于把恢复路径拆了。
	it("处理失败的 nonce 会被放回：重推按真实原因重试，不被判成重放", async () => {
		const plain = "<xml><InfoType>suite_ticket</InfoType><SuiteId>other_suite</SuiteId><SuiteTicket>tk_x</SuiteTicket></xml>";
		const encrypted = await seal(plain);
		const query = signedQuery(encrypted, { nonce: "retry_once" });
		const body = `<xml><Encrypt>${encrypted}</Encrypt></xml>`;

		request({ query, body });
		await (await api()).event.post();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/SuiteId/);

		// 同一条报文重推（企微的语义）：仍按真实原因失败，而不是 400「nonce 重复」
		request({ query, body });
		await (await api()).event.post();
		expect(out.body.msg).toMatch(/SuiteId/);
		expect(out.body.msg).not.toMatch(/nonce 重复/);
	});

	// 重放闸门的本体：同 nonce 已被占用、而首推还没标「已落库」——此刻重复投递必须挡下
	// （可能是真重放，也可能是首推仍在处理中；两种都不该并发出第二份副作用）。
	it("同 nonce 已被占用且未标已落库 → 400「nonce 重复」（重放闸门本体）", async () => {
		const encrypted = await seal(TICKET_XML);
		const query = signedQuery(encrypted, { nonce: "inflight" });
		const body = `<xml><Encrypt>${encrypted}</Encrypt></xml>`;
		// 模拟「首推正在处理」：计数已到 1，但没有 applied 标记
		await g.kv.incr("wecom:nonce:inflight");

		request({ query, body });
		await (await api()).event.post();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/nonce 重复/);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_suite_ticket").get()).toMatchObject({ n: 0 });
	});

	it("EncodingAESKey 与后台不一致（签名过、解密爆 pkcs7）→ 400，日志点名是哪一侧配错", async () => {
		// 用户实报的原样症状：WARN reason=pkcs7: bad padding。签名先过说明后台 Token 与本部署一致，
		// 所以只回一句 bad padding 等于没给线索——日志必须带「外层 ToUserName / 配置套件 / 实际加载的密钥指纹」。
		const warns: unknown[][] = [];
		const orig = g.log;
		g.log = { ...orig, warn: (msg: string, ...kv: unknown[]) => warns.push([msg, kv]) };
		try {
			const encrypted = await seal(TICKET_XML);
			// 后台用真钥匙加密，本部署加载另一把 43 字符（仍解 32 字节，不会先撞长度校验）
			installVars({ wecom_encoding_aes_key: "Q".repeat(43) });
			request({
				query: signedQuery(encrypted),
				body: `<xml><ToUserName><![CDATA[${SUITE}]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
			});
			await (await api()).event.post();
		}
		finally {
			g.log = orig;
		}

		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/解密失败/);
		const hit = warns.find(w => w[0] === "wecom callback decrypt failed");
		expect(hit).toBeDefined();
		const kv = hit![1] as unknown[];
		expect(kv).toContain("pkcs7: bad padding");
		expect(kv).toContain(SUITE); // envelopeToUser 与 configuredSuite 同值 → 指向「密钥不一致」而不是「套件不对」
		expect(kv).toContain(sha1Hex("Q".repeat(43)).slice(0, 8));
	});

	it("timestamp 超出 ±5 分钟窗口 → 400（历史回调不得被无限期重放）", async () => {
		const encrypted = await seal(TICKET_XML);
		const stale = String(nowSecs() - 8 * 60);
		request({ query: signedQuery(encrypted, { timestamp: stale }), body: `<xml><Encrypt>${encrypted}</Encrypt></xml>` });
		await (await api()).event.post();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/超出允许窗口/);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_suite_ticket").get()).toMatchObject({ n: 0 });
	});

	// 处理成功后的重推：回 success 而不是 400——企微只在「拿不到 success」时重推，首推若因回包慢
	// 被判超时，重推再被挡成 400，管理员端就会看到「应用安装失败」。副作用仍然只发生一次。
	it("同一条回调连发两次（成功后的重推）→ 第二次幂等回 success，票据只落一次", async () => {
		const encrypted = await seal(TICKET_XML);
		const body = `<xml><Encrypt>${encrypted}</Encrypt></xml>`;
		request({ query: signedQuery(encrypted), body });
		await (await api()).event.post();
		expect(out.status).toBe(200);
		expect(out.text).toBe("success");

		installJson();
		request({ query: signedQuery(encrypted), body });
		await (await api()).event.post();
		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		// 幂等成功不等于重放执行：库里仍是首推那次的值
		expect(dbo.prepare("SELECT suite_ticket FROM wecom_suite_ticket WHERE suite_id = ?").get(SUITE)).toMatchObject({ suite_ticket: "tk_9" });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_suite_ticket").get()).toMatchObject({ n: 1 });
	});

	it("换一个新 nonce 的同内容回调仍能落（重放闸门没把正常重试误伤）", async () => {
		const first = await seal(TICKET_XML);
		request({ query: signedQuery(first), body: `<xml><Encrypt>${first}</Encrypt></xml>` });
		await (await api()).event.post();
		expect(out.status).toBe(200);

		installJson();
		const again = await seal(TICKET_XML.replace("tk_9", "tk_10"));
		request({ query: signedQuery(again, { nonce: `${NONCE}_2` }), body: `<xml><Encrypt>${again}</Encrypt></xml>` });
		await (await api()).event.post();
		expect(out.status).toBe(200);
		expect(dbo.prepare("SELECT suite_ticket FROM wecom_suite_ticket WHERE suite_id = ?").get(SUITE)).toMatchObject({ suite_ticket: "tk_10" });
	});
});
