// BDD：企业内部应用（自建）接入 + 「同一部署内两种来源共存」。
//
// 这套功能的价值全在**边界**上，所以这里钉的不是企微协议（协议在 wecom-connector.spec.ts），
// 而是六件容易错得很安静的事：
//   1. 判定口径是「变量填了没有」，不另设 wecom_mode；两套都填却没 allow_coexist 必须报错，
//      不能静默择一（迁移期最容易犯的就是「忘了清旧变量」）。
//   2. 回调验签要能**先于**任何身份凭据存在：引导期只有 callback token/aeskey 也要验得过，
//      否则「先有 suite 还是先有回调」的死锁又回来了。
//   3. 两种来源的回调钥匙不同源，同一条 /event 上只能逐个试签；命中哪套就按哪套分发。
//   4. 同企业双应用时，行要按 credential_kind 隔离：cancel_auth 只停 suite 行，
//      不能把同一家企业的自建应用一起停掉、更不能把人踢下线。
//   5. 「验证并接入」四步全过才落库：部门读不到 / 读不到人都必须是 400 且**不留半行**，
//      否则同步入口会带着一个空可见范围的应用一路 502。
//   6. 换 AgentId 重接时旧 corp 行要停用（旧 secret 已失效），但同企业 suite 行不受影响。
//
// 夹具即真实库（真迁移 + 真 sqlite）：0003__credential_kind 的默认值也一起被这层覆盖到。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import type { WecomStoreDeps } from "../src/auth/api/_shared/wecom/store";
import { Buffer } from "node:buffer";
import { createCipheriv, webcrypto } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectCorp } from "../src/auth/api/_shared/wecom/admin";
import { createWecomClient, runtimeCache, runtimeHttp } from "../src/auth/api/_shared/wecom/client";
import { callbackCreds, configuredKinds, corpIdentity, readBase, readCorpConfig, readSuiteConfig, wecomKinds } from "../src/auth/api/_shared/wecom/config";
import { bytesToB64, utf8Bytes, wecomSignature } from "../src/auth/api/_shared/wecom/crypt";
import { handleSuiteEvent } from "../src/auth/api/_shared/wecom/events";
import { findCorpAuth, findProfile, probeProfile, saveProfile } from "../src/auth/api/_shared/wecom/store";
import { installDb } from "./fixture";

const g = globalThis as any;
let dbo: ReturnType<typeof installDb>;

const SUITE = "suite_1";
const CORP = "ww_self";
const AGENT = "1000042";
const SUITE_TOKEN = "cb_token";
const CORP_TOKEN = "corp_cb_token";
/** 两套回调钥匙必须不同：同一条 /event 上「试签命中哪一套」才有意义 */
const SUITE_AES = webcrypto.getRandomValues(new Uint8Array(32));
const CORP_AES = webcrypto.getRandomValues(new Uint8Array(32));
const SUITE_AES_VAR = bytesToB64(SUITE_AES).replace(/=$/, "");
const CORP_AES_VAR = bytesToB64(CORP_AES).replace(/=$/, "");
const NOW = 1_700_000_000;

const deps: WecomStoreDeps = {
	encrypt: (p: string) => `gcm(${p})`,
	decrypt: (b: string) => b.replace(/^gcm\((.*)\)$/, "$1"),
	now: () => NOW,
};

interface Captured { status: number | null, body: any, text: string | null, location: string | null }

let out: Captured;

function installJson(): void {
	out = { status: null, body: null, text: null, location: null };
	const redirect = (url: string, code = 302) => {
		out.status = code;
		out.location = url;
	};
	g.json = {
		ok: (data?: unknown) => {
			out.status = 200;
			out.body = data;
		},
		fail: (code: number, msg: string) => {
			out.status = code;
			out.body = { code, msg };
		},
		header: () => {},
		raw: (data: unknown) => {
			out.status = 200;
			out.body = data;
		},
		redirect: Object.assign(redirect, { found: (url: string) => redirect(url, 302), seeOther: (url: string) => redirect(url, 303) }),
		stream: (opts?: { contentType?: string }) => {
			out.status = 200;
			return {
				contentType: opts?.contentType ?? null,
				write: (chunk: string) => {
					out.text = (out.text ?? "") + chunk;
				},
				end: () => {},
			};
		},
	};
}

/** 部署常量：**默认只配自建应用**——本文件的主角；需要代开发时由用例显式补上 */
function installVars(overrides: Record<string, string> = {}): void {
	const base: Record<string, string> = {
		wecom_corp_id: CORP,
		wecom_corp_secret: "corp_secret",
		wecom_corp_agent_id: AGENT,
		wecom_corp_callback_token: CORP_TOKEN,
		wecom_corp_encoding_aes_key: CORP_AES_VAR,
		wecom_enc_key: "0123456789abcdef0123456789abcdef",
		wecom_base_url: "https://site.example.com/api/auth/wecom",
		...overrides,
	};
	g.vars = { get: (name: string) => base[name] ?? null };
}

/** 代开发那一套（含回调钥匙），用于「两套同时存在」的用例 */
const SUITE_VARS: Record<string, string> = {
	wecom_suite_id: SUITE,
	wecom_suite_secret: "suite_secret",
	wecom_callback_token: SUITE_TOKEN,
	wecom_encoding_aes_key: SUITE_AES_VAR,
};

function installKv(): void {
	const store = new Map<string, string>();
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

function request(opts: { query?: Record<string, string>, body?: unknown, headers?: Record<string, string>, user?: { id: number } } = {}): void {
	g.http = { method: "POST", query: opts.query ?? {}, body: opts.body ?? null, headers: opts.headers ?? {}, ...(opts.user ? { user: opts.user } : {}) };
}

/**
 * 企微 webhook 密文（random|len|msg|receiveid → AES-256-CBC，PKCS#7 补到 32 字节）。
 * 与 wecom-endpoints.spec.ts 同一实现：用 node:crypto 关掉自动补位自己按 32 补，不拿自实现给自己背书。
 */
async function seal(plain: string, key: Uint8Array, receiveId: string): Promise<string> {
	const msg = utf8Bytes(plain);
	const head = webcrypto.getRandomValues(new Uint8Array(16));
	const len = new Uint8Array(4);
	new DataView(len.buffer).setUint32(0, msg.length);
	const body = Buffer.concat([Buffer.from(head), Buffer.from(len), Buffer.from(msg), Buffer.from(utf8Bytes(receiveId))]);
	const pad = 32 - (body.length % 32);
	const cipher = createCipheriv("aes-256-cbc", Buffer.from(key), Buffer.from(key.subarray(0, 16)));
	cipher.setAutoPadding(false);
	return Buffer.concat([cipher.update(Buffer.concat([body, Buffer.alloc(pad, pad)])), cipher.final()]).toString("base64");
}

/** 已落库的一行（suite 行 suite_id 有值、corp 行为空串，主键三段） */
function seedRow(kind: "suite" | "corp", opts: { corpId?: string, agentId?: string, status?: string } = {}): void {
	const corpId = opts.corpId ?? CORP;
	const agentId = opts.agentId ?? AGENT;
	dbo.prepare("INSERT INTO wecom_app_profile (suite_id, corp_id, agent_id, auth_corp_id, env, corp_name, status, credential_kind, permanent_code_enc, installed_at, update_time) VALUES (?, ?, ?, ?, 'prod', NULL, ?, ?, ?, ?, ?)")
		.run(kind === "suite" ? SUITE : "", corpId, agentId, corpId, opts.status ?? "active", kind, `gcm(secret_${kind}_${agentId})`, NOW, NOW);
}

function rowsOf(corpId = CORP): Array<{ agent_id: string, status: string, credential_kind: string, suite_id: string }> {
	return dbo.prepare("SELECT agent_id, status, credential_kind, suite_id FROM wecom_app_profile WHERE corp_id = ? ORDER BY credential_kind, agent_id").all(corpId) as any[];
}

function mkSuperAdmin(): number {
	dbo.prepare("INSERT INTO users (username, password_hash) VALUES ('u_super', 'x')").run();
	const id = (dbo.prepare("SELECT id FROM users WHERE username = 'u_super'").get() as { id: number }).id;
	dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'superadmin')").run(id);
	return id;
}

/** 上游桩：按路径返回，`calls` 供断言「打了几次 / 打了哪些」 */
function stubUpstream(opts: { depts?: Array<{ id: string, name?: string }>, membersByDept?: Record<string, Array<{ userid: string }>> } = {}): { calls: string[] } {
	const calls: string[] = [];
	const depts = opts.depts ?? [{ id: "1", name: "总部" }];
	const members = opts.membersByDept ?? { 1: [{ userid: "zhangsan" }] };
	g.fetch = async (url: string) => {
		calls.push(url);
		const json = async () => {
			if (url.includes("/cgi-bin/gettoken"))
				return { errcode: 0, access_token: "tk", expires_in: 7200 };
			if (url.includes("/cgi-bin/department/simplelist"))
				return { errcode: 0, department_id: depts.map(d => ({ id: Number(d.id), name: d.name ?? `部门${d.id}`, parentid: 0, order: 0 })) };
			if (url.includes("/cgi-bin/user/simplelist")) {
				const id = new URL(url).searchParams.get("department_id") ?? "";
				return { errcode: 0, userlist: (members[id] ?? []).map(u => ({ userid: u.userid, department: [Number(id)] })) };
			}
			if (url.includes("/cgi-bin/department/get")) {
				const id = new URL(url).searchParams.get("id") ?? "";
				// 上游详情优先于事件自带字段（contacts.ts::applyDeptEvent 有据）：桩里也照这个形状给名字
				return { errcode: 0, department: { id: Number(id), name: depts.find(d => d.id === id)?.name ?? `部门${id}`, parentid: 0, order: 0 } };
			}
			throw new Error(`stub 未预期：${url}`);
		};
		return { ok: true, json };
	};
	return { calls };
}

const wecomApi = async () => (await import("../src/auth/api/wecom/api")).default;
const adminApi = async () => (await import("../src/auth/api/wecom/admin/api")).default;

/** 回调 timestamp 必须新鲜：重放守卫拒 ±5 分钟以外的报文，用固定值会让整段用例假红 */
const nowSecs = () => String(Math.floor(Date.now() / 1000));

beforeAll(() => {
	dbo = installDb();
	g.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
	g.db.asTenant = (id: string) => {
		if (g.http?.tenantId)
			throw new Error("tenant already set");
		g.http = { ...(g.http ?? {}), tenantId: id };
	};
});

beforeEach(() => {
	installJson();
	installVars();
	installKv();
	installCrypto();
	stubUpstream();
	for (const t of ["wecom_app_profile", "wecom_suite_ticket", "sys_refresh_token", "sys_oplog", "sys_department", "sys_dept_member", "sys_user_role", "users"])
		dbo.exec(`DELETE FROM ${t}`);
});

afterEach(() => {
	g.http = {};
});

describe("C-A：来源判定（变量填了没有，不另设模式开关）", () => {
	it("只配自建三项 → kinds=[corp]；suite 流程才报缺 suite 凭据，登录/回调不受牵连", () => {
		expect(wecomKinds()).toEqual(["corp"]);
		expect(configuredKinds()).toEqual(["corp"]);
		expect(readBase()).toMatchObject({ baseUrl: "https://site.example.com/api/auth/wecom" });
		expect(readCorpConfig()).toMatchObject({ corpId: CORP, agentId: AGENT, corpSecret: "corp_secret" });
		// suite 专属流程仍要点名缺什么（readBase 只关登录/回跳，不该被 suite 凭据绑架）
		expect(() => readSuiteConfig()).toThrow(/wecom_suite_id/);
	});

	it("两套都配齐但没显式 allow_coexist → 400 点名该变量（不静默择一）", () => {
		installVars(SUITE_VARS);
		expect(() => wecomKinds()).toThrow(/wecom_allow_coexist/);
		// 回调侧同样拒绝：静默挑一套验签会让运维以为「另一套没生效」
		expect(() => callbackCreds()).toThrow(/wecom_allow_coexist/);
	});

	it("两套 + allow_coexist=true → 两种来源都启用；回调凭据代开发优先，receiver 各是自己的身份", () => {
		installVars({ ...SUITE_VARS, wecom_allow_coexist: "true" });
		expect(wecomKinds()).toEqual(["suite", "corp"]);
		expect(callbackCreds().map(c => [c.kind, c.receiver])).toEqual([["suite", SUITE], ["corp", CORP]]);
	});

	it("引导期（suite_id 未下发、身份凭据一项不齐）→ 回调凭据仍可用，receiver 留空", () => {
		// 只填回调钥匙 + 基址：这是「先建回调、后建模版」的唯一可行顺序（plan §18）
		installVars({ wecom_corp_id: "", wecom_corp_secret: "", wecom_corp_agent_id: "", wecom_corp_callback_token: "", wecom_corp_encoding_aes_key: "", ...SUITE_VARS, wecom_suite_id: "", wecom_suite_secret: "" });
		// 严格口径此时「一种来源都没启用」（没有完整 suite 也没有 corp 三项）
		expect(() => wecomKinds()).toThrow(/二选一/);
		// 但回调验签不该跟着失败，否则企微后台点「保存」当场 400
		expect(callbackCreds()).toEqual([{ kind: "suite", token: SUITE_TOKEN, encodingAesKey: SUITE_AES_VAR, receiver: "" }]);
	});

	it("半配（填了 corp_id 没填 secret）→ configuredKinds 为空，后台能显示「差什么」而不抛", () => {
		installVars({ wecom_corp_secret: "" });
		expect(configuredKinds()).toEqual([]);
		expect(corpIdentity()).toBeNull();
	});
});

describe("C-B：同企业双应用的档案隔离", () => {
	it("按来源取行：suite 行的 secret 与 corp 行的 secret 不串用", async () => {
		seedRow("suite", { agentId: "100001" });
		seedRow("corp");
		expect((await findProfile(CORP, "100001", deps, "suite")).permanentCode).toBe("secret_suite_100001");
		expect((await findProfile(CORP, AGENT, deps, "corp")).permanentCode).toBe(`secret_corp_${AGENT}`);
		expect(await findCorpAuth(CORP, deps, "corp")).toMatchObject({ credentialKind: "corp", permanentCode: `secret_corp_${AGENT}`, agentIds: [AGENT] });
		expect(await findCorpAuth(CORP, deps, "suite")).toMatchObject({ credentialKind: "suite", agentIds: ["100001"] });
	});

	it("不带 kind 时行为与单来源部署一致（同一企业两行 → 视为多应用歧义）", async () => {
		seedRow("suite", { agentId: "100001" });
		seedRow("corp");
		await expect(findProfile(CORP, null, deps)).rejects.toMatchObject({ status: 400 });
		expect(await probeProfile(CORP, AGENT)).toMatchObject({ credentialKind: "corp", authMode: 0 });
	});

	it("cancel_auth：只停 suite 行，自建应用保持启用，且不吊销会话", async () => {
		installVars({ ...SUITE_VARS, wecom_allow_coexist: "true" });
		seedRow("suite", { agentId: "100001" });
		seedRow("corp");
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h1', ?, 1, ?, 0, ?)").run(CORP, NOW + 100, NOW);
		const { calls } = stubUpstream();

		// 走事件入口的真路径：cancel_auth → disableCorp → setProfileStatus(kind=suite) → revokeOrKeep
		await handleSuiteEvent("<xml><InfoType>cancel_auth</InfoType><AuthCorpId>ww_self</AuthCorpId></xml>", {
			cfg: readSuiteConfig(),
			client: createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }),
			store: deps,
		});

		expect(rowsOf()).toEqual([
			{ agent_id: AGENT, status: "active", credential_kind: "corp", suite_id: "" },
			{ agent_id: "100001", status: "disabled", credential_kind: "suite", suite_id: SUITE },
		]);
		// 会话还在：这家企业的自建应用仍在线，不该被「取消代开发授权」连带踢下线
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token WHERE tenant_id = ?").get(CORP)).toMatchObject({ n: 1 });
		// 停用要连带清 token 缓存（旧 secret 可能被缓存在另一状态），但不该打上游
		expect(calls).toEqual([]);
	});

	it("该企业一行都不活跃时 cancel_auth 仍吊销该租户会话（安全动作不因来源而失效）", async () => {
		installVars({ ...SUITE_VARS, wecom_allow_coexist: "true" });
		seedRow("suite", { agentId: "100001" });
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h1', ?, 1, ?, 0, ?)").run(CORP, NOW + 100, NOW);

		await handleSuiteEvent("<xml><InfoType>cancel_auth</InfoType><AuthCorpId>ww_self</AuthCorpId></xml>", {
			cfg: readSuiteConfig(),
			client: createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }),
			store: deps,
		});

		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token WHERE tenant_id = ?").get(CORP)).toMatchObject({ n: 0 });
	});
});

describe("C-C：自建应用「验证并接入」（四步全过才落库）", () => {
	it("全通过 → 落一行 corp 档案（suite_id 空 / credential_kind=corp / auth_mode=0）", async () => {
		const { calls } = stubUpstream({ depts: [{ id: "1" }, { id: "2" }], membersByDept: { 2: [{ userid: "lisi" }] } });
		const cfg = readCorpConfig();

		const r = await connectCorp(cfg, createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }), deps);

		expect(r).toEqual({ corpId: CORP, agentId: AGENT, departments: 2, members: 1 });
		expect(rowsOf()).toEqual([{ agent_id: AGENT, status: "active", credential_kind: "corp", suite_id: "" }]);
		const row = dbo.prepare("SELECT permanent_code_enc, auth_mode FROM wecom_app_profile WHERE corp_id = ?").get(CORP) as any;
		// secret 只以密文落库（与代开发的 permanent_code 同一口径）
		expect(row.permanent_code_enc).toBe("gcm(corp_secret)");
		expect(row.auth_mode).toBe(0);
		// 先作废 token 缓存再换：换过 Secret 的部署命中旧缓存会让校验「假通过」
		expect(calls[0]).toContain("gettoken");
	});

	it("可见范围里没有部门 → 400 且不留半行", async () => {
		stubUpstream({ depts: [] });
		await expect(connectCorp(readCorpConfig(), createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }), deps))
			.rejects
			.toMatchObject({ status: 400 });
		expect(rowsOf()).toEqual([]);
	});

	it("顶层部门没人不算失败：往后探到有人的那层再下结论", async () => {
		// 企微的顶层部门常常只有子部门、没有直属成员，只看第一个会误判「读不到人」
		const { calls } = stubUpstream({ depts: [{ id: "1" }, { id: "2" }], membersByDept: { 2: [{ userid: "lisi" }] } });
		const r = await connectCorp(readCorpConfig(), createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }), deps);
		expect(r.members).toBe(1);
		expect(calls.filter(u => u.includes("user/simplelist"))).toHaveLength(2);
	});

	it("探满 10 个部门都没人 → 400，且不再继续打上游", async () => {
		const depts = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1) }));
		const { calls } = stubUpstream({ depts, membersByDept: {} });
		await expect(connectCorp(readCorpConfig(), createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }), deps))
			.rejects
			.toMatchObject({ status: 400, message: expect.stringContaining("读不到成员") });
		expect(calls.filter(u => u.includes("user/simplelist"))).toHaveLength(10);
		expect(rowsOf()).toEqual([]);
	});

	it("换 AgentId 重接 → 旧 corp 行停用、同企业 suite 行不动", async () => {
		const { agentId } = readCorpConfig();
		seedRow("corp", { agentId: "1000001" });
		seedRow("suite", { agentId: "100001" });
		const { calls } = stubUpstream();

		await connectCorp(readCorpConfig(), createWecomClient({ http: runtimeHttp(), cache: runtimeCache() }), deps);

		// ORDER BY credential_kind, agent_id：corp 两行按 agent 排在前，suite 行在后
		expect(rowsOf()).toEqual([
			{ agent_id: "1000001", status: "disabled", credential_kind: "corp", suite_id: "" },
			{ agent_id: agentId, status: "active", credential_kind: "corp", suite_id: "" },
			{ agent_id: "100001", status: "active", credential_kind: "suite", suite_id: SUITE },
		]);
		// 只换了新应用的 token（旧应用的作废走缓存 del，不打上游）
		expect(calls.filter(u => u.includes("gettoken"))).toHaveLength(1);
	});
});

describe("C-D：后台端点（overview / connect）", () => {
	it("overview 在配置缺项时仍返回 200 并给出 configError（页面要能显示「差什么」）", async () => {
		const uid = mkSuperAdmin();
		installVars({ wecom_corp_secret: "" });
		request({ user: { id: uid } });
		await (await adminApi()).overview.get();
		expect(out.status).toBe(200);
		expect(out.body.kinds).toEqual([]);
		expect(out.body.configError).toMatch(/wecom_corp_secret/);
	});

	it("overview 正常态：来源、回调地址（base+/event）、企业身份、回调凭据是否齐", async () => {
		const uid = mkSuperAdmin();
		request({ user: { id: uid } });
		await (await adminApi()).overview.get();
		expect(out.body).toMatchObject({
			kinds: ["corp"],
			callbackUrl: "https://site.example.com/api/auth/wecom/event",
			corpId: CORP,
			agentId: AGENT,
			corpCallbackConfigured: true,
			configError: null,
		});
	});

	it("未配 corp 三项时 connect → 400，且不落库", async () => {
		const uid = mkSuperAdmin();
		installVars({ wecom_corp_agent_id: "" });
		request({ user: { id: uid } });
		await (await adminApi()).connect.post();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/wecom_corp_agent_id/);
		expect(rowsOf()).toEqual([]);
	});
});

describe("C-E：/event 按命中凭据分发", () => {
	/** 用自建应用那套钥匙造一条通讯录部门事件（receiveid = corpid，与真实报文一致） */
	async function corpSignedDeptEvent(): Promise<{ query: Record<string, string>, body: string }> {
		const plain = `<xml><ToUserName>${CORP}</ToUserName><MsgType>event</MsgType><Event>change_contact</Event><ChangeType>update_party</ChangeType><Id>2</Id><Name>研发一组</Name></xml>`;
		const encrypted = await seal(plain, CORP_AES, CORP);
		const ts = nowSecs();
		const nonce = "n_corp_1";
		return {
			query: { msg_signature: wecomSignature(CORP_TOKEN, ts, nonce, encrypted), timestamp: ts, nonce },
			body: `<xml><ToUserName>${CORP}</ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
		};
	}

	it("corp 钥匙签的事件 → 进通讯录分支（落部门），不回 400 签名失败", async () => {
		stubUpstream({ depts: [{ id: "1" }, { id: "2", name: "研发一组" }] });
		seedRow("corp");
		const ev = await corpSignedDeptEvent();
		request({ query: ev.query, body: ev.body });

		await (await wecomApi()).event.post();

		expect(out.status).toBe(200);
		expect(out.text).toBe("success");
		// 事件路径落地：部门已按企微 id 建档（证明走的是 contacts，不是 handleSuiteEvent 的 switch）
		expect(dbo.prepare("SELECT origin_id, name FROM sys_department WHERE origin = 'wecom'").get()).toMatchObject({ origin_id: "2", name: "研发一组" });
		// 自建应用没有套件事件：不该写 suite_ticket 表
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_suite_ticket").get()).toMatchObject({ n: 0 });
	});

	it("共存部署里两套钥匙都配时，corp 事件仍能被认出来（逐个试签）", async () => {
		installVars({ ...SUITE_VARS, wecom_allow_coexist: "true" });
		seedRow("corp");
		const ev = await corpSignedDeptEvent();
		request({ query: ev.query, body: ev.body });

		await (await wecomApi()).event.post();

		expect(out.text).toBe("success");
		expect(dbo.prepare("SELECT origin_id FROM sys_department WHERE origin = 'wecom'").get()).toMatchObject({ origin_id: "2" });
	});

	it("签名换成另一套 token → 400（两套 token 不同源，不能互相顶替）", async () => {
		const ev = await corpSignedDeptEvent();
		const forged = wecomSignature(SUITE_TOKEN, ev.query.timestamp!, ev.query.nonce!, "whatever");
		request({ query: { ...ev.query, msg_signature: forged }, body: ev.body });

		await (await wecomApi()).event.post();
		expect(out.status).toBe(400);
		expect(out.body.msg).toMatch(/签名/);
	});

	it("GET /event 在只有 corp 回调钥匙时也能过 URL 验证", async () => {
		const echo = await seal("echo_corp", CORP_AES, CORP);
		const ts = nowSecs();
		const nonce = "n_verify";
		request({ query: { msg_signature: wecomSignature(CORP_TOKEN, ts, nonce, echo), timestamp: ts, nonce, echostr: echo } });

		await (await wecomApi()).event.get();
		expect(out.status).toBe(200);
		expect(out.text).toBe("echo_corp");
	});
});

describe("C-F：登录入口认自己那家企业", () => {
	it("共存部署里本站 /login 落到配置的企业，不被别家代开发档案淹掉", async () => {
		// 别家企业通过代开发装进来一行；本站自己是自建应用
		installVars({ ...SUITE_VARS, wecom_allow_coexist: "true" });
		seedRow("suite", { corpId: "ww_other", agentId: "100009" });
		await saveProfile({
			suiteId: "",
			corpId: CORP,
			authCorpId: CORP,
			agentId: AGENT,
			env: "prod",
			corpName: null,
			credentialKind: "corp",
			permanentCode: "corp_secret",
			authMode: 0,
		}, deps);

		request({ query: {}, headers: { "user-agent": "Mozilla/5.0 Chrome/120" } });
		await (await wecomApi()).login.get();

		expect(out.status).toBe(302);
		// 扫码链接必须指向本站企业 + 本站应用，否则管理员扫了会装到别家
		expect(out.location).toContain(`appid=${CORP}`);
		expect(out.location).toContain(`agentid=${AGENT}`);
	});
});
