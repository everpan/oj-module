// BDD：企微代开发 connector（Phase 1）——映射表/凭证/一次性票据/凭证链/事件分发的行为契约。
//
// 覆盖的是**会静默出错的那几处**，不是「函数能跑」：
//   · profile 的三种拒绝（未知企业 / 已停用 / 多应用未指定 agent）必须同码同文案（§5.3 枚举风险）；
//   · suite_ticket 过期不得发起 API（拒在本地，不拿过期票打企微）；
//   · 登录票据只能兑换一次，且兑换与过期判定之间有原子性（并发双花只可能成功一次）；
//   · JIT 建档幂等（同 corp 同 userid 恒同一 uid，唯一约束撞车要回查复用）；
//   · 凭证链的缓存与失效重试（40001 用一次重取机会，不能把用户打成 502）。
//
// deps 全注入：store 用 `enc:` 前后缀假加密（Node 侧 crypto 只读，设计 §9.1），
// client 的 http/kv 用内存桩——真实网络与 AES 已由 wecom-crypt.spec / 运行时保证。
/* eslint-disable test/prefer-lowercase-title -- D/AC 编号是验收锚点，保留大写 */
import type { WecomCache, WecomHttp } from "../src/app/api/auth/_shared/wecom/client";
import type { WecomConfig } from "../src/app/api/auth/_shared/wecom/config";
import type { WecomStoreDeps } from "../src/app/api/auth/_shared/wecom/store";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createWecomClient, runtimeCache } from "../src/app/api/auth/_shared/wecom/client";
import {
	assertEncKey,
	eventUrlOf,
	loginRedirectOf,
	readCallbackConfig,
	readSuiteConfig,
	siteRootOf,
} from "../src/app/api/auth/_shared/wecom/config";
import { envOfState, handleSuiteEvent } from "../src/app/api/auth/_shared/wecom/events";
import {
	assertUserActive,
	buildAuthorizeUrl,
	ensureWecomUser,
	externalUsername,
	isWecomUa,
	LOGIN_STATE_TTL_SECS,
	LOGIN_TICKET_TTL_SECS,
	loginLandingUrl,
	putLoginState,
	takeLoginState,
} from "../src/app/api/auth/_shared/wecom/login";
import { callbackFields, field } from "../src/app/api/auth/_shared/wecom/payload";
import {
	claimLoginTicket,
	ensureTenant,
	findProfile,
	getSuiteTicket,
	issueLoginTicket,
	putSuiteTicket,
	saveProfile,
	setProfileStatus,
	tenantOfCorp,
} from "../src/app/api/auth/_shared/wecom/store";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

let clock = 1_000_000;

function storeDeps(): WecomStoreDeps {
	return {
		// 只验证「落库是密文、读回是明文」，真实 AES-GCM 由运行时提供（Node 侧不可注入）
		encrypt: (p: string) => `enc:${p}`,
		decrypt: (b: string) => b.replace(/^enc:/, ""),
		now: () => clock,
	};
}

function fakeCache(): WecomCache & { size: () => number, ttlOf: (k: string) => number | null } {
	const map = new Map<string, { value: string, exp: number }>();
	return {
		async get(key) {
			const hit = map.get(key);
			if (!hit || hit.exp <= clock)
				return null;
			return hit.value;
		},
		async set(key, value, ttl) {
			map.set(key, { value, exp: clock + ttl });
		},
		async del(key) {
			map.delete(key);
		},
		size: () => map.size,
		ttlOf: (key) => {
			const hit = map.get(key);
			return hit ? hit.exp - clock : null;
		},
	};
}

const CFG: WecomConfig = {
	suiteId: "suite_1",
	suiteSecret: "secret_1",
	token: "tok",
	encodingAesKey: "a".repeat(43),
	encKey: "k",
	baseUrl: "https://site.example.com/api/auth/wecom",
};

function profile(suiteCorpAgent: { corp?: string, agent?: string, env?: string, code?: string } = {}) {
	return {
		suiteId: CFG.suiteId,
		corpId: suiteCorpAgent.corp ?? "ww_corp_a",
		authCorpId: suiteCorpAgent.corp ?? "ww_corp_a",
		agentId: suiteCorpAgent.agent ?? "100001",
		env: suiteCorpAgent.env ?? "prod",
		corpName: "测试企业",
		credentialKind: "suite" as const,
		permanentCode: suiteCorpAgent.code ?? "perm_a",
	};
}

beforeAll(() => {
	dbo = installDb();
	// 夹具没有租户守卫（见 fixture.ts 头注释的已知边界），这里补 asTenant 的**可观测**替身：
	// 已带头再设 → 抛错（与 oj 契约一致），否则把头补上。ensureTenant 的两种分支都靠它验证。
	g.db.asTenant = (id: string) => {
		if (g.http?.tenantId)
			throw new Error("tenant already set");
		g.http = { ...(g.http ?? {}), tenantId: id };
	};
	// 不再给 db.asSystem 打空桩：fixture 默认让它抛错（模板生产代码已消除请求级逃生口），
	// 这样任何路径重新调它都会当场失败，而不是被空实现吞掉。
	g.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
});

afterEach(() => {
	g.http = {};
	clock = 1_000_000;
	for (const t of ["wecom_app_profile", "wecom_suite_ticket", "wecom_login_ticket", "sys_refresh_token", "sys_oplog"])
		dbo.exec(`DELETE FROM ${t}`);
});

describe("P1-A：corp→租户映射表（wecom_app_profile）", () => {
	it("单应用企业：不带 agent 也能解析，读回的是解密后的 permanent_code", async () => {
		await saveProfile(profile({ env: "test" }), storeDeps());
		const p = await findProfile("ww_corp_a", null, storeDeps());
		expect(p).toMatchObject({ corpId: "ww_corp_a", agentId: "100001", env: "test", permanentCode: "perm_a" });
		// 落库必须是密文（permanent_code 具备全 corp 数据权限，§7.5）
		const raw = dbo.prepare("SELECT permanent_code_enc FROM wecom_app_profile").get() as { permanent_code_enc: string };
		expect(raw.permanent_code_enc).toBe("enc:perm_a");
	});

	it("同企业两个应用（测试/正式）：不带 agent 拒绝，带 agent 各自命中", async () => {
		await saveProfile(profile({ agent: "100001", env: "prod" }), storeDeps());
		await saveProfile(profile({ agent: "100002", env: "test", code: "perm_b" }), storeDeps());
		expect((await findProfile("ww_corp_a", "100002", storeDeps())).permanentCode).toBe("perm_b");
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_app_profile").get()).toMatchObject({ n: 2 });
		await expect(findProfile("ww_corp_a", null, storeDeps())).rejects.toThrow(/多个应用/);
	});

	it("upsert 幂等：同 (suite,corp,agent) 再授权只更新、不新增行（secret 轮换场景）", async () => {
		await saveProfile(profile({ code: "perm_old" }), storeDeps());
		clock += 60;
		await saveProfile(profile({ code: "perm_new" }), storeDeps());
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_app_profile").get()).toMatchObject({ n: 1 });
		expect((await findProfile("ww_corp_a", null, storeDeps())).permanentCode).toBe("perm_new");
	});

	it("未授权企业与已停用企业返回同一文案（不泄露哪些企业装过）", async () => {
		await saveProfile(profile(), storeDeps());
		await setProfileStatus("ww_corp_a", "disabled", storeDeps());
		const disabled = await findProfile("ww_corp_a", null, storeDeps()).catch(e => (e as Error).message);
		const unknown = await findProfile("ww_corp_z", null, storeDeps()).catch(e => (e as Error).message);
		expect(disabled).toBe(unknown);
		expect(disabled).toMatch(/无效或应用未开通/);
	});

	it("AuthCorpId（可能是 open_corpid）也能反查到同一行", async () => {
		await saveProfile({ ...profile(), authCorpId: "open_corp_a" }, storeDeps());
		expect((await findProfile("open_corp_a", null, storeDeps())).corpId).toBe("ww_corp_a");
	});

	it("并发首次授权（企微重推）：撞车的一方转为更新，不抛错也不双写", async () => {
		// 企微 5 秒拿不到 success 就重推，两条 create_auth 同时进 handleSuiteEvent 是常态；
		// 两条都先看不到行 → 都走 insert → 后到的必须吞掉唯一约束冲突改写为更新，
		// 否则整条事件以 500 收场，这个企业的授权可能就停在「重推次数用完」那一刻。
		await Promise.all([saveProfile(profile(), storeDeps()), saveProfile(profile(), storeDeps())]);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_app_profile").get()).toMatchObject({ n: 1 });
		expect((await findProfile("ww_corp_a", null, storeDeps())).permanentCode).toBe("perm_a");
	});
});

describe("P1-A2：token 缓存必须带上有效期（kv 两步写的兜底）", () => {
	// 本段接管全局 kv/log（runtimeCache 直接读全局），退出时必须还原——同文件后续用例依赖它们
	let prevKv: unknown;
	let prevLog: unknown;

	beforeEach(() => {
		prevKv = g.kv;
		prevLog = g.log;
	});

	afterEach(() => {
		g.kv = prevKv;
		g.log = prevLog;
	});

	it("expire 生效：写进去的值带 TTL（expires_in - 300）", async () => {
		const store = new Map<string, { value: string, exp: number }>();
		const ttlClock = 1_000_000;
		g.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
		g.kv = {
			get: async (k: string) => {
				const hit = store.get(k);
				return hit && hit.exp > ttlClock ? hit.value : null;
			},
			set: async (k: string, v: string) => {
				store.set(k, { value: v, exp: Number.POSITIVE_INFINITY });
			},
			expire: async (k: string, ttl: number) => {
				const hit = store.get(k);
				if (!hit)
					return false;
				hit.exp = ttlClock + ttl;
				return true;
			},
			del: async (k: string) => {
				store.delete(k);
			},
		};
		const cache = runtimeCache();
		await cache.set("wecom:suite_token:s", "sat_1", 6900);
		expect(await cache.get("wecom:suite_token:s")).toBe("sat_1");
	});

	it("expire 没设上（false/0）→ 宁可不缓存也不留永不过期的 token", async () => {
		const store = new Map<string, string>();
		const seen: string[] = [];
		g.log = { debug: () => {}, info: () => {}, warn: (m: string) => seen.push(m), error: () => {} };
		g.kv = {
			get: async (k: string) => store.get(k) ?? null,
			set: async (k: string, v: string) => {
				store.set(k, v);
			},
			expire: async () => 0,
			del: async (k: string) => {
				store.delete(k);
				seen.push(`del:${k}`);
			},
		};
		const cache = runtimeCache();
		await cache.set("wecom:corp_token:c:1", "corp_tk", 6900);
		// 没有 TTL 的值必须被撤回：留着它，corp secret 轮换后登录会长期停在 502
		expect(await cache.get("wecom:corp_token:c:1")).toBeNull();
		expect(seen.join("|")).toMatch(/del:wecom:corp_token:c:1/);
	});
});

describe("P1-B：套件票据（wecom_suite_ticket）", () => {
	it("未收到 → 503；收到可读；过期即 503（宁可拒一次也不拿过期票打企微）", async () => {
		await expect(getSuiteTicket(CFG.suiteId, storeDeps())).rejects.toThrow(/尚未收到/);
		await putSuiteTicket(CFG.suiteId, "ticket_v1", clock + 1800, storeDeps());
		expect((await getSuiteTicket(CFG.suiteId, storeDeps())).ticket).toBe("ticket_v1");
		clock += 1801;
		await expect(getSuiteTicket(CFG.suiteId, storeDeps())).rejects.toThrow(/已过期/);
	});

	it("覆盖写：新票据替换旧票据且只保留一行", async () => {
		await putSuiteTicket(CFG.suiteId, "ticket_v1", clock + 1800, storeDeps());
		await putSuiteTicket(CFG.suiteId, "ticket_v2", clock + 1800, storeDeps());
		expect((await getSuiteTicket(CFG.suiteId, storeDeps())).ticket).toBe("ticket_v2");
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_suite_ticket").get()).toMatchObject({ n: 1 });
	});
});

describe("P1-C：一次性登录票据（wecom_login_ticket）", () => {
	it("只能兑换一次：第二次 401（重放防线）", async () => {
		await issueLoginTicket("h1", 7, "ww_corp_a", LOGIN_TICKET_TTL_SECS, storeDeps());
		expect(await claimLoginTicket("h1", storeDeps())).toEqual({ uid: 7, ownerTenant: "ww_corp_a" });
		await expect(claimLoginTicket("h1", storeDeps())).rejects.toThrow(/无效或已使用/);
	});

	it("过期票据 401（且票面已标记 used，不可复活）", async () => {
		await issueLoginTicket("h2", 7, "ww_corp_a", 10, storeDeps());
		clock += 11;
		await expect(claimLoginTicket("h2", storeDeps())).rejects.toThrow(/已过期/);
	});

	it("签发时顺手清掉过期票（长期运行不堆垃圾）", async () => {
		await issueLoginTicket("old", 1, "t", 10, storeDeps());
		clock += 20;
		await issueLoginTicket("new", 1, "t", 10, storeDeps());
		expect(dbo.prepare("SELECT ticket_hash FROM wecom_login_ticket").all()).toEqual([{ ticket_hash: "new" }]);
	});

	it("伪造票据 401（不存在的 hash）", async () => {
		await expect(claimLoginTicket("nope", storeDeps())).rejects.toThrow(/无效或已使用/);
	});
});

describe("P1-D：租户绑定（ensureTenant / L2 第四层）", () => {
	it("无头 → db.asTenant(推导值) 补身份", () => {
		g.http = {};
		ensureTenant(tenantOfCorp("ww_corp_a"));
		expect(g.http.tenantId).toBe("ww_corp_a");
	});

	it("头与推导值不一致 → 403（伪造 X-TENANT-ID 的第一道拦）", () => {
		g.http = { tenantId: "ww_corp_b" };
		expect(() => ensureTenant("ww_corp_a")).toThrow(/does not match/);
	});
});

describe("P1-E：JIT 建档（不另注册）", () => {
	it("同 corp 同 userid 两次 → 同一 uid，且用户名走 wecom: 命名空间、corp_id 落行", async () => {
		const a = await ensureWecomUser("ww_corp_a", "zhangsan");
		const b = await ensureWecomUser("ww_corp_a", "zhangsan");
		expect(a).toEqual({ uid: b.uid, forbidden: false });
		const row = dbo.prepare("SELECT username, source, corp_id, is_forbidden FROM users WHERE id = ?").get(a.uid);
		expect(row).toMatchObject({ username: externalUsername("zhangsan"), source: "wecom", corp_id: "ww_corp_a", is_forbidden: 0 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE username = ?").get(externalUsername("zhangsan"))).toMatchObject({ n: 1 });
	});

	it("预查与插入之间的竞态：唯一约束撞车后回查复用，不抛错", async () => {
		// 先手动插一行（模拟另一个请求已抢先建号），再让 ensureWecomUser 走「查到即复用」
		dbo.prepare("INSERT INTO users (username, password_hash, source, corp_id) VALUES (?, '!wecom', 'wecom', 'ww_corp_a')").run(externalUsername("lisi"));
		const r = await ensureWecomUser("ww_corp_a", "lisi");
		expect(r.forbidden).toBe(false);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users WHERE username = ?").get(externalUsername("lisi"))).toMatchObject({ n: 1 });
	});

	it("本地已停用的外部号：建档返回 forbidden，兑换前 assertUserActive 再拦一次（403）", async () => {
		const { uid } = await ensureWecomUser("ww_corp_a", "wangwu");
		dbo.prepare("UPDATE users SET is_forbidden = 1 WHERE id = ?").run(uid);
		expect((await ensureWecomUser("ww_corp_a", "wangwu")).forbidden).toBe(true);
		await expect(assertUserActive(uid)).rejects.toThrow(/已被停用/);
	});

	it("名字只在首次建档取一次：写 display_name，老用户不再调 resolver（不给每次登录加一次上游）", async () => {
		let calls = 0;
		const first = await ensureWecomUser("ww_corp_a", "zhaoliu", async () => {
			calls++;
			return "赵六";
		});
		expect(dbo.prepare("SELECT display_name FROM users WHERE id = ?").get(first.uid)).toMatchObject({ display_name: "赵六" });

		await ensureWecomUser("ww_corp_a", "zhaoliu", async () => {
			calls++;
			return "不该被用到";
		});
		expect(calls).toBe(1);
		expect(dbo.prepare("SELECT display_name FROM users WHERE id = ?").get(first.uid)).toMatchObject({ display_name: "赵六" });
	});

	it("取不到名字（无通讯录权限 / 上游抛错）→ 用工号兜底，建档不失败", async () => {
		const noName = await ensureWecomUser("ww_corp_a", "sunqi", async () => null);
		expect(dbo.prepare("SELECT display_name FROM users WHERE id = ?").get(noName.uid)).toMatchObject({ display_name: "sunqi" });

		const thrown = await ensureWecomUser("ww_corp_a", "zhouba", async () => {
			throw new Error("boom");
		});
		expect(dbo.prepare("SELECT display_name FROM users WHERE id = ?").get(thrown.uid)).toMatchObject({ display_name: "zhouba" });
	});
});

describe("P1-F：凭证链（client：缓存 + 失效重试 + 错误两态）", () => {
	interface Stub extends WecomHttp { calls: string[] }

	function stubHttp(replies: Array<Record<string, unknown>>): Stub {
		const calls: string[] = [];
		const next = () => {
			const r = replies.shift();
			if (!r)
				throw new Error("stub http: 无更多应答");
			return r;
		};
		return {
			calls,
			async getJson(url) {
				calls.push(url);
				return next();
			},
			async postJson(url) {
				calls.push(url);
				return next();
			},
			async getBytes() {
				throw new Error("not stubbed");
			},
		};
	}

	it("suite_access_token 进缓存：第二次调用不再打企微，TTL = expires_in - 300", async () => {
		const http = stubHttp([{ suite_access_token: "sat_1", expires_in: 7200 }]);
		const cache = fakeCache();
		const client = createWecomClient({ http, cache });
		expect(await client.suiteAccessToken("suite_1", "sec", "ticket")).toBe("sat_1");
		expect(await client.suiteAccessToken("suite_1", "sec", "ticket")).toBe("sat_1");
		expect(http.calls).toHaveLength(1);
		expect(cache.ttlOf("wecom:suite_token:suite_1")).toBe(6900);
	});

	it("40001（token 过期）→ 失效缓存重取一次后成功，用户无感", async () => {
		const http = stubHttp([
			{ access_token: "corp_token_old", expires_in: 7200 },
			{ errcode: 40001, errmsg: "invalid credential" },
			{ access_token: "corp_token_new", expires_in: 7200 },
			{ errcode: 0, userid: "zhangsan" },
		]);
		const client = createWecomClient({ http, cache: fakeCache() });
		expect(await client.userIdByCode("ww_corp_a", "100001", "perm", "CODE")).toBe("zhangsan");
		expect(http.calls).toHaveLength(4);
	});

	it("snsapi_privateinfo：code 换回 user_ticket，getuserdetail 取到头像", async () => {
		const http = stubHttp([
			{ access_token: "t", expires_in: 7200 },
			{ errcode: 0, userid: "zhangsan", user_ticket: "UT_1" },
			{ errcode: 0, avatar: "http://wx.qlogo.cn/x/0" },
		]);
		const client = createWecomClient({ http, cache: fakeCache() });
		await expect(client.codeUserInfo("c", "a", "p", "CODE")).resolves.toEqual({ userid: "zhangsan", userTicket: "UT_1" });
		// 原图 URL 末段 /0 → 同时给出 /100 缩略图（login 侧优先用它）
		await expect(client.userDetailByTicket("c", "a", "p", "UT_1")).resolves.toEqual({
			avatar: "http://wx.qlogo.cn/x/0",
			thumbAvatar: "http://wx.qlogo.cn/x/100",
		});
	});

	it("头像 URL 不是 .../0 形态 → thumbAvatar 为 null（回落原图）", async () => {
		const client = createWecomClient({
			http: stubHttp([{ access_token: "t", expires_in: 7200 }, { errcode: 0, avatar: "https://example.com/a.jpg" }]),
			cache: fakeCache(),
		});
		await expect(client.userDetailByTicket("c", "a", "p", "UT_1")).resolves.toEqual({
			avatar: "https://example.com/a.jpg",
			thumbAvatar: null,
		});
	});

	it("snsapi_base 回包没有 user_ticket → null（扫码/静默授权不取头像）", async () => {
		const client = createWecomClient({
			http: stubHttp([{ access_token: "t", expires_in: 7200 }, { errcode: 0, userid: "zhangsan" }]),
			cache: fakeCache(),
		});
		await expect(client.codeUserInfo("c", "a", "p", "CODE")).resolves.toEqual({ userid: "zhangsan", userTicket: null });
	});

	it("getuserdetail 权限/票据失败 → null，不影响登录", async () => {
		const client = createWecomClient({
			http: stubHttp([{ access_token: "t", expires_in: 7200 }, { errcode: 60011, errmsg: "no privilege" }]),
			cache: fakeCache(),
		});
		await expect(client.userDetailByTicket("c", "a", "p", "UT_1")).resolves.toBeNull();
	});

	it("code 无效 / 非企业成员（只有 openid）→ 统一 401，不泄露具体原因", async () => {
		const invalid = createWecomClient({
			http: stubHttp([{ access_token: "t", expires_in: 7200 }, { errcode: 40029, errmsg: "invalid code" }]),
			cache: fakeCache(),
		});
		await expect(invalid.userIdByCode("c", "a", "p", "BAD")).rejects.toMatchObject({ status: 401 });
		const outsider = createWecomClient({
			http: stubHttp([{ access_token: "t", expires_in: 7200 }, { errcode: 0, openid: "o_1" }]),
			cache: fakeCache(),
		});
		await expect(outsider.userIdByCode("c", "a", "p", "CODE")).rejects.toMatchObject({ status: 401 });
	});

	it("上游故障 → 502（可重试语义），不能伪装成 401", async () => {
		const client = createWecomClient({
			http: {
				async getJson() {
					throw Object.assign(new Error("企微接口不可达"), { status: 502 });
				},
				async postJson() {
					throw Object.assign(new Error("企微接口不可达"), { status: 502 });
				},
				async getBytes() {
					throw Object.assign(new Error("企微接口不可达"), { status: 502 });
				},
			},
			cache: fakeCache(),
		});
		await expect(client.userIdByCode("c", "a", "p", "CODE")).rejects.toMatchObject({ status: 502 });
	});

	it("get_permanent_code 缺 corpid / agent 列表为空且复核也没有 → 502（不静默落一行空 profile）", async () => {
		const noAgent = createWecomClient({
			// suite_access_token 由调用方传入，所以这里的应答从 get_permanent_code 开始
			http: stubHttp([
				{ permanent_code: "perm", auth_corp_info: { corpid: "ww_x" }, auth_info: { agent: [] } },
				// 回源复核（get_auth_info）同样没有应用 → 这时才判死
				{ auth_info: { agent: [] } },
			]),
			cache: fakeCache(),
		});
		await expect(noAgent.permanentCodeByAuthCode("sat", "AUTH")).rejects.toMatchObject({ status: 502 });
	});

	// 2026-11-01 生产日志：create_auth 拿到永久码，但 auth_info.agent 是空的 → 上一版直接 502，
	// 企业管理员看到「应用安装失败」，而永久码白白作废（auth_code 一次有效）。
	it("get_permanent_code 的 agent 为空 → 拿刚换到的永久码回源 get_auth_info 补齐", async () => {
		const http = stubHttp([
			{ permanent_code: "perm", auth_corp_info: { corpid: "ww_x" }, auth_info: { agent: [] } },
			{ auth_info: { agent: [{ agentid: 1000012, auth_mode: 1 }] } },
		]);
		const client = createWecomClient({ http, cache: fakeCache() });

		const granted = await client.permanentCodeByAuthCode("sat", "AUTH");

		expect(granted.agentIds).toEqual(["1000012"]);
		expect(granted.authModes["1000012"]).toBe(1);
		expect(http.calls.some(u => u.includes("/service/get_auth_info"))).toBe(true);
	});

	it("auth_info.agent 给成单个对象（不是数组）也认——少一次「明明有应用却判成没授权」", async () => {
		const client = createWecomClient({
			http: stubHttp([
				{ permanent_code: "perm", auth_corp_info: { corpid: "ww_x" }, auth_info: { agent: { agentid: 1000011, auth_mode: 0 } } },
			]),
			cache: fakeCache(),
		});

		expect((await client.permanentCodeByAuthCode("sat", "AUTH")).agentIds).toEqual(["1000011"]);
	});

	it("userNameById 拿到真名（去首尾空白）", async () => {
		const http = stubHttp([{ access_token: "t", expires_in: 7200 }, { errcode: 0, name: " 张三 " }]);
		const client = createWecomClient({ http, cache: fakeCache() });
		expect(await client.userNameById("ww_corp_a", "100001", "perm", "zhangsan")).toBe("张三");
	});

	it("userNameById 权限不足（60011）→ null 而不是抛错：补名失败不能把登录打成 5xx", async () => {
		const client = createWecomClient({
			http: stubHttp([{ access_token: "t", expires_in: 7200 }, { errcode: 60011, errmsg: "no privilege to access" }]),
			cache: fakeCache(),
		});
		await expect(client.userNameById("c", "a", "p", "u")).resolves.toBeNull();
	});

	it("userNameById 遇 40001 → 失效缓存重试一次", async () => {
		const http = stubHttp([
			{ access_token: "t", expires_in: 7200 },
			{ errcode: 40001 },
			{ access_token: "t2", expires_in: 7200 },
			{ errcode: 0, name: "李四" },
		]);
		const client = createWecomClient({ http, cache: fakeCache() });
		expect(await client.userNameById("c", "a", "p", "u")).toBe("李四");
		expect(http.calls).toHaveLength(4);
	});

	it("userNameById 网络故障 / name 为空 → null（不抛）", async () => {
		const broken = createWecomClient({
			http: {
				async getJson() {
					throw new Error("unreachable");
				},
				async postJson() {
					throw new Error("unreachable");
				},
				async getBytes() {
					throw new Error("unreachable");
				},
			},
			cache: fakeCache(),
		});
		await expect(broken.userNameById("c", "a", "p", "u")).resolves.toBeNull();

		const noName = createWecomClient({
			http: stubHttp([{ access_token: "t", expires_in: 7200 }, { errcode: 0, name: "   " }]),
			cache: fakeCache(),
		});
		await expect(noName.userNameById("c", "a", "p", "u")).resolves.toBeNull();
	});
});

describe("P1-G：事件分发（suite_ticket / 授权 / 解绑）", () => {
	function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
		const invalidated: string[] = [];
		return {
			invalidated,
			async suiteAccessToken() {
				return "sat";
			},
			async permanentCodeByAuthCode() {
				return { permanentCode: "perm_new", corpId: "ww_corp_a", corpName: "测试企业", agentIds: ["100001", "100002"], authModes: { 100001: 0, 100002: 0 }, state: null, ...overrides };
			},
			async corpAccessToken() {
				return "ct";
			},
			async invalidateCorpToken(corp: string, agent: string) {
				invalidated.push(`${corp}:${agent}`);
			},
			async userIdByCode() {
				return "u";
			},
		} as never;
	}

	const deps = (client: unknown) => ({ cfg: CFG, client: client as never, store: storeDeps() });

	it("suite_ticket：落库并给 30 分钟有效期（企微 10 分钟推一次，过期即拒发 API）", async () => {
		await handleSuiteEvent({ SuiteId: "suite_1", InfoType: "suite_ticket", SuiteTicket: "tk_1" }, deps(fakeClient()));
		expect(await getSuiteTicket(CFG.suiteId, storeDeps())).toEqual({ ticket: "tk_1", expiresAt: clock + 1800 });
	});

	it("suite_ticket 顺势预热 suite token（授权路径只剩一次出网），换票失败也不影响票据落库", async () => {
		const seen: string[] = [];
		const warm = {
			...fakeClient(),
			async suiteAccessToken(suiteId: string, secret: string, ticket: string) {
				seen.push(`${suiteId}/${secret}/${ticket}`);
				return "sat";
			},
		} as never;
		await handleSuiteEvent({ SuiteId: "suite_1", InfoType: "suite_ticket", SuiteTicket: "tk_9" }, deps(warm));
		expect(seen).toEqual(["suite_1/secret_1/tk_9"]);

		// suite_secret 配错时只是预热失败：票据必须照旧落库，否则 create_auth 连门都进不去
		const broken = {
			...fakeClient(),
			async suiteAccessToken() {
				throw new Error("企微 get_suite_token 失败：errcode=40001");
			},
		} as never;
		await expect(handleSuiteEvent({ SuiteId: "suite_1", InfoType: "suite_ticket", SuiteTicket: "tk_10" }, deps(broken)))
			.resolves
			.toBe("suite_ticket");
		expect((await getSuiteTicket(CFG.suiteId, storeDeps())).ticket).toBe("tk_10");
	});

	it("create_auth：AuthCode 换永久码 → 每个 agent 一行 profile，并作废旧 corp token", async () => {
		await putSuiteTicket(CFG.suiteId, "tk_1", clock + 1800, storeDeps());
		const client = fakeClient();
		await handleSuiteEvent({ SuiteId: "suite_1", InfoType: "create_auth", AuthCode: "AC_1", State: "env=test" }, deps(client));
		const rows = dbo.prepare("SELECT agent_id, env, status FROM wecom_app_profile ORDER BY agent_id").all();
		expect(rows).toEqual([
			{ agent_id: "100001", env: "test", status: "active" },
			{ agent_id: "100002", env: "test", status: "active" },
		]);
		expect((client as unknown as { invalidated: string[] }).invalidated).toEqual(["ww_corp_a:100001", "ww_corp_a:100002"]);
		// 审计留痕（谁在什么时候绑了哪个 corp）
		expect(dbo.prepare("SELECT action FROM sys_oplog WHERE action = 'wecom.auth.apply'").all()).toHaveLength(1);
	});

	// 回归：线上「应用安装失败，联系服务商」的正因——回调是匿名请求（无 X-TENANT-ID），
	// sys_oplog 是租户表，sql_guard: deny 下不绑租户就写会被守卫拒；而它发生在 profile 已落库之后，
	// 于是「授权其实成功了，企微却判失败」。鉴据：审计行必须落在该企业自己的租户下。
	it("create_auth 匿名回调（无租户头）：审计前先按企业绑租户，行落进该企业 oplog", async () => {
		await putSuiteTicket(CFG.suiteId, "tk_1", clock + 1800, storeDeps());
		g.http = {};
		await handleSuiteEvent({ SuiteId: "suite_1", InfoType: "create_auth", AuthCode: "AC_1" }, deps(fakeClient()));
		expect(g.http.tenantId).toBe("ww_corp_a");
		expect(dbo.prepare("SELECT tenant_id, target FROM sys_oplog WHERE action = 'wecom.auth.apply'").get())
			.toMatchObject({ tenant_id: "ww_corp_a", target: "ww_corp_a" });
	});

	it("审计写失败不得把 create_auth 打成失败（授权已落库，企微必须拿到 success）", async () => {
		await putSuiteTicket(CFG.suiteId, "tk_1", clock + 1800, storeDeps());
		const orig = g.db.table;
		g.db.table = (name: string) => {
			if (name === "sys_oplog")
				throw new Error("tenant guard: table(s) [\"sys_oplog\"] require tenant context (missing tenant header)");
			return orig(name);
		};
		try {
			await expect(handleSuiteEvent({ SuiteId: "suite_1", InfoType: "create_auth", AuthCode: "AC_1" }, deps(fakeClient())))
				.resolves
				.toBe("create_auth");
		}
		finally {
			g.db.table = orig;
		}
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM wecom_app_profile").get()).toMatchObject({ n: 2 });
	});

	it("cancel_auth：profile 全部停用 + 该租户 refresh 串清空（解绑后旧会话不得续命）", async () => {
		await saveProfile(profile({ agent: "100001" }), storeDeps());
		await saveProfile(profile({ agent: "100002" }), storeDeps());
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h', 'ww_corp_a', 1, ?, 0, ?)").run(clock + 100, clock);

		g.http = {};
		await handleSuiteEvent({ SuiteId: "suite_1", InfoType: "cancel_auth", AuthCorpId: "ww_corp_a" }, deps(fakeClient()));

		expect(dbo.prepare("SELECT DISTINCT status FROM wecom_app_profile").all()).toEqual([{ status: "disabled" }]);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token").get()).toMatchObject({ n: 0 });
		expect(dbo.prepare("SELECT level FROM sys_oplog WHERE action = 'wecom.auth.cancel'").get()).toMatchObject({ level: 4 });
		// 清会话是裸 SQL，deny 档下同样要租户上下文
		expect(g.http.tenantId).toBe("ww_corp_a");
	});

	it("SuiteId 与本部署不一致 → 400（不同套件的回调不得互相污染）", async () => {
		await expect(handleSuiteEvent({ SuiteId: "other", InfoType: "suite_ticket", SuiteTicket: "t" }, deps(fakeClient())))
			.rejects
			.toMatchObject({ status: 400 });
	});

	it("不消费的事件回 success 语义的 InfoType，不抛错（否则企微重推三次）", async () => {
		expect(await handleSuiteEvent({ InfoType: "change_contact", SuiteId: "suite_1" }, deps(fakeClient()))).toBe("change_contact");
	});

	// 数据回调没有 InfoType，只有 MsgType=event + Event=change_contact：分流靠 Event 认，
	// 认不出就会落进 default 被记成「不消费的事件」——而这条正是轨三的全部输入。
	it("数据回调形态（无 InfoType）也能分流到轨三，且日志只留 ChangeType 不留值", async () => {
		const dataCallback = {
			ToUserName: "ww_corp_a",
			CreateTime: 1700000000,
			MsgType: "event",
			Event: "change_contact",
			ChangeType: "update_party",
			Id: 2,
		};
		const logged: unknown[][] = [];
		const orig = g.log;
		const push = (...args: unknown[]) => void logged.push(args);
		// 失败那条是 warn（成功才是 info）：两个都要抓，否则「没抛错」会掩盖「根本没走到轨三」
		g.log = { ...orig, info: push, warn: push };
		try {
			// 返回值是 ChangeType（日志只用它记一行），不是事件名
			expect(await handleSuiteEvent(dataCallback, deps(fakeClient()))).toBe("update_party");
		}
		finally {
			g.log = orig;
		}
		// 这家企业在本用例里没授权：失败只记一笔，绝不抛（抛了企微就重推三次）
		const line = logged.find(args => args[0] === "wecom change_contact ignored");
		expect(line).toBeDefined();
		// ChangeType 是协议枚举，记下来才有排查价值；姓名/工号这类明文值一个都不许进日志
		expect(line).toContain("update_party");
		expect(JSON.stringify(line)).toContain("未授权");
	});

	// 兜底口径（payload.ts 头的说明）：部分回调业务没有 JSON 文档，收到 XML 也必须能处理。
	// 同一个事件两种格式走出来的效果必须一模一样，否则「换个格式就静默不认」会在真机上才暴露。
	it("XML（文档形态）与 JSON 归一化结果一致：两种包体走同一条路径", async () => {
		const asJson = { SuiteId: "suite_1", InfoType: "create_auth", AuthCode: "AC_xml" };
		const asXml = [
			"<xml><SuiteId><![CDATA[suite_1]]></SuiteId><InfoType><![CDATA[create_auth]]></InfoType>",
			"<AuthCode><![CDATA[AC_xml]]></AuthCode></xml>",
		].join("");
		const fromJson = callbackFields(asJson);
		const fromXml = callbackFields(asXml);
		expect([...fromXml.values.entries()].sort()).toEqual([...fromJson.values.entries()].sort());
		// 信封小写、明文大写都认：上游 JSON 信封是 {"tousername","encrypt"}
		expect(field(callbackFields({ tousername: "ww_corp_a", encrypt: "abc" }), "Encrypt")).toBe("abc");
	});

	it("create_auth 缺 AuthCode → 400（宁可拒也不落半行 profile）", async () => {
		await putSuiteTicket(CFG.suiteId, "tk_1", clock + 1800, storeDeps());
		await expect(handleSuiteEvent({ SuiteId: "suite_1", InfoType: "create_auth" }, deps(fakeClient())))
			.rejects
			.toMatchObject({ status: 400 });
	});
});

describe("P1-H：授权链接与 state（一次性）", () => {
	it("企微内用 oauth2（snsapi_privateinfo + agentid + #wechat_redirect）；浏览器用 qrConnect", () => {
		const base = { corpId: "ww1", agentId: "100001", redirectUri: "https://s.example.com/cb?a=1&b=2", state: "st" };
		const inApp = buildAuthorizeUrl({ ...base, inWecom: true });
		expect(inApp).toContain("connect/oauth2/authorize");
		// 头像只能靠 privateinfo 的 user_ticket（user/get 自 2022-06-20 起不回头像）
		expect(inApp).toContain("scope=snsapi_privateinfo");
		expect(inApp).toContain("agentid=100001");
		expect(inApp.endsWith("#wechat_redirect")).toBe(true);
		// redirect_uri 必须整串编码，否则企微把我们的参数当自己的解析
		expect(inApp).toContain(encodeURIComponent(base.redirectUri));

		const qr = buildAuthorizeUrl({ ...base, inWecom: false });
		expect(qr).toContain("wwopen/sso/qrConnect");
		expect(qr).toContain("appid=ww1");
	});

	it("state 一次性：取即删，第二次 400；过期同样 400", async () => {
		const cache = fakeCache();
		await putLoginState("n1", { corpId: "ww_corp_a", agentId: "100001", env: "prod" }, cache);
		expect(await takeLoginState("n1", cache)).toEqual({ corpId: "ww_corp_a", agentId: "100001", env: "prod" });
		await expect(takeLoginState("n1", cache)).rejects.toMatchObject({ status: 400 });

		await putLoginState("n2", { corpId: "ww_corp_a", agentId: "100001", env: "prod" }, cache);
		clock += LOGIN_STATE_TTL_SECS + 1;
		await expect(takeLoginState("n2", cache)).rejects.toMatchObject({ status: 400 });
	});

	it("落地地址同时带票据与租户（缺租户 → 换票会被 ensureTenant 判 403）", () => {
		const url = loginLandingUrl({ origin: "https://site.example.com", ticket: "tk", tenant: "ww_corp_a" });
		expect(url).toBe("https://site.example.com/login?wecom_ticket=tk&tenant=ww_corp_a");
	});

	it("envOfState 只认 env=xxx 或裸环境名，其余回落 prod（防止 State 被当自由文本）", () => {
		expect(envOfState("env=test")).toBe("test");
		expect(envOfState("staging")).toBe("staging");
		expect(envOfState("随便写的")).toBe("prod");
		expect(envOfState(null)).toBe("prod");
	});

	it("UA 识别与外部号命名空间", () => {
		expect(isWecomUa("Mozilla/5.0 (iPhone) wxwork/4.1.0")).toBe(true);
		expect(isWecomUa("Mozilla/5.0 (Macintosh) Chrome/120")).toBe(false);
		expect(externalUsername("zhangsan")).toBe("wecom:zhangsan");
	});
});

describe("P1-J：部署常量读取（缺项一次报全 / 密钥格式 fail-fast / 地址派生）", () => {
	function installVars(overrides: Record<string, string> = {}): void {
		const base: Record<string, string> = {
			wecom_suite_id: "suite_1",
			wecom_suite_secret: "secret_1",
			wecom_callback_token: "tok",
			wecom_encoding_aes_key: "a".repeat(43),
			wecom_enc_key: "0123456789abcdef0123456789abcdef",
			wecom_base_url: "https://site.example.com/api/auth/wecom/",
			...overrides,
		};
		g.vars = { get: (name: string) => base[name] ?? null };
	}

	it("缺项一次报全（不是报第一个就返回，省掉逐轮补配置的往返）", () => {
		installVars({ wecom_suite_id: "", wecom_callback_token: "", wecom_enc_key: "" });
		const msg = (() => {
			try {
				readSuiteConfig();
				return "";
			}
			catch (e) {
				return (e as Error).message;
			}
		})();
		for (const name of ["wecom_suite_id", "wecom_callback_token", "wecom_enc_key"])
			expect(msg).toMatch(new RegExp(name));
	});

	it("readCallbackConfig 只校验 Tier A（token/aeskey/encKey/baseUrl），不依赖 suite 凭据——引导期可独立运行", () => {
		// 即使 suite 两项全空，只要 Tier A 齐，readCallbackConfig 就不抛（供 echostr 验证用）
		installVars({ wecom_suite_id: "", wecom_suite_secret: "" });
		expect(() => readCallbackConfig()).not.toThrow();
		// Tier A 缺项仍一次报全
		installVars({ wecom_suite_id: "", wecom_suite_secret: "", wecom_callback_token: "", wecom_enc_key: "" });
		const msg = (() => {
			try {
				readCallbackConfig();
				return "";
			}
			catch (e) {
				return (e as Error).message;
			}
		})();
		for (const name of ["wecom_callback_token", "wecom_enc_key"])
			expect(msg).toMatch(new RegExp(name));
	});

	it("baseUrl 去尾斜杠后拼出两个企微侧地址（回调 URL 要原样填进后台）", () => {
		installVars();
		const cfg = readSuiteConfig();
		expect(cfg.baseUrl).toBe("https://site.example.com/api/auth/wecom");
		// 不带 callback_format=json：官方文档只给「对外收款」写了这个参数，代开发的通用回调配置只有 XML
		expect(eventUrlOf(cfg)).toBe("https://site.example.com/api/auth/wecom/event");
		expect(loginRedirectOf(cfg)).toBe("https://site.example.com/api/auth/wecom/callback");
		expect(siteRootOf(cfg)).toBe("https://site.example.com");
	});

	it("子路径部署：站点根保留子路径（302 回跳必须落 /oj/login，不是 /login）", () => {
		installVars({ wecom_base_url: "https://site.example.com/oj/api/auth/wecom" });
		const cfg = readSuiteConfig();
		expect(siteRootOf(cfg)).toBe("https://site.example.com/oj");
		expect(loginLandingUrl({ origin: siteRootOf(cfg), ticket: "tk", tenant: "ww_corp_a" }))
			.toBe("https://site.example.com/oj/login?wecom_ticket=tk&tenant=ww_corp_a");
	});

	it("baseUrl 后缀不对 → 400（宁可拒，也不猜站点根拼出错误回跳）", () => {
		installVars({ wecom_base_url: "https://site.example.com/api/wecom" });
		expect(() => siteRootOf(readSuiteConfig())).toThrow(/必须以 \/api\/auth\/wecom 结尾/);
	});

	it("baseUrl 非绝对地址 → 400（相对路径会让 redirect_uri 与回调 URL 双双失效）", () => {
		installVars({ wecom_base_url: "/api/auth/wecom" });
		expect(() => readSuiteConfig()).toThrow(/绝对地址/);
	});

	it("wecom_enc_key 只收 16/32 字节的 hex 或 base64（AES-192 会在加密时才炸，故在读配置处拦住）", () => {
		for (const key of [
			"0123456789abcdef0123456789abcdef", // 32 hex = 16 字节
			"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // 64 hex = 32 字节
			"AAECAwQFBgcICQoLDA0ODw==", // base64 16 字节
			"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=", // base64 32 字节
		])
			expect(() => assertEncKey(key), key).not.toThrow();

		for (const key of [
			"enc-key", // 既非 hex 也非合法 base64
			"0123456789abcdef0123456789abcdef01234567", // 40 hex = 20 字节
			"AAECAwQFBgcICQoLDA0ODxAREhMUFRYX", // base64 → 24 字节（AES-192，oj 明确不支持）
		])
			expect(() => assertEncKey(key), key).toThrow(/16 或 32 字节/);
	});
});
