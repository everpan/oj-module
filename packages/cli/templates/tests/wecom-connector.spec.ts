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
import type { WecomCache, WecomHttp } from "../src/auth/api/_shared/wecom/client";
import type { WecomConfig } from "../src/auth/api/_shared/wecom/config";
import type { WecomStoreDeps } from "../src/auth/api/_shared/wecom/store";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createWecomClient, runtimeCache } from "../src/auth/api/_shared/wecom/client";
import {
	assertEncKey,
	eventUrlOf,
	installUrlOf,
	loginRedirectOf,
	readWecomConfig,
	siteRootOf,
} from "../src/auth/api/_shared/wecom/config";
import { envOfState, handleSuiteEvent } from "../src/auth/api/_shared/wecom/events";
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
} from "../src/auth/api/_shared/wecom/login";
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
} from "../src/auth/api/_shared/wecom/store";
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
	g.db.asSystem = () => {};
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
			},
			cache: fakeCache(),
		});
		await expect(client.userIdByCode("c", "a", "p", "CODE")).rejects.toMatchObject({ status: 502 });
	});

	it("get_permanent_code 缺 corpid / agent 列表为空 → 502（不静默落一行空 profile）", async () => {
		const noAgent = createWecomClient({
			http: stubHttp([
				{ suite_access_token: "sat", expires_in: 7200 },
				{ permanent_code: "perm", auth_corp_info: { corpid: "ww_x" }, auth_info: { agent: [] } },
			]),
			cache: fakeCache(),
		});
		await expect(noAgent.permanentCodeByAuthCode("sat", "AUTH")).rejects.toMatchObject({ status: 502 });
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
				return { permanentCode: "perm_new", corpId: "ww_corp_a", corpName: "测试企业", agentIds: ["100001", "100002"], state: null, ...overrides };
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
		await handleSuiteEvent("<xml><InfoType>suite_ticket</InfoType><SuiteId>suite_1</SuiteId><SuiteTicket>tk_1</SuiteTicket></xml>", deps(fakeClient()));
		expect(await getSuiteTicket(CFG.suiteId, storeDeps())).toEqual({ ticket: "tk_1", expiresAt: clock + 1800 });
	});

	it("create_auth：AuthCode 换永久码 → 每个 agent 一行 profile，并作废旧 corp token", async () => {
		await putSuiteTicket(CFG.suiteId, "tk_1", clock + 1800, storeDeps());
		const client = fakeClient();
		await handleSuiteEvent("<xml><InfoType>create_auth</InfoType><SuiteId>suite_1</SuiteId><AuthCode>AC_1</AuthCode><State>env=test</State></xml>", deps(client));
		const rows = dbo.prepare("SELECT agent_id, env, status FROM wecom_app_profile ORDER BY agent_id").all();
		expect(rows).toEqual([
			{ agent_id: "100001", env: "test", status: "active" },
			{ agent_id: "100002", env: "test", status: "active" },
		]);
		expect((client as unknown as { invalidated: string[] }).invalidated).toEqual(["ww_corp_a:100001", "ww_corp_a:100002"]);
		// 审计留痕（谁在什么时候绑了哪个 corp）
		expect(dbo.prepare("SELECT action FROM sys_oplog WHERE action = 'wecom.auth.apply'").all()).toHaveLength(1);
	});

	it("cancel_auth：profile 全部停用 + 该租户 refresh 串清空（解绑后旧会话不得续命）", async () => {
		await saveProfile(profile({ agent: "100001" }), storeDeps());
		await saveProfile(profile({ agent: "100002" }), storeDeps());
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, tenant_id, user_id, expires_at, revoked, created_at) VALUES ('h', 'ww_corp_a', 1, ?, 0, ?)").run(clock + 100, clock);

		await handleSuiteEvent("<xml><InfoType>cancel_auth</InfoType><SuiteId>suite_1</SuiteId><AuthCorpId>ww_corp_a</AuthCorpId></xml>", deps(fakeClient()));

		expect(dbo.prepare("SELECT DISTINCT status FROM wecom_app_profile").all()).toEqual([{ status: "disabled" }]);
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token").get()).toMatchObject({ n: 0 });
		expect(dbo.prepare("SELECT level FROM sys_oplog WHERE action = 'wecom.auth.cancel'").get()).toMatchObject({ level: 4 });
	});

	it("SuiteId 与本部署不一致 → 400（不同套件的回调不得互相污染）", async () => {
		await expect(handleSuiteEvent("<xml><InfoType>suite_ticket</InfoType><SuiteId>other</SuiteId><SuiteTicket>t</SuiteTicket></xml>", deps(fakeClient())))
			.rejects
			.toMatchObject({ status: 400 });
	});

	it("不消费的事件（通讯录变更等）回 success 语义的 InfoType，不抛错（否则企微重推三次）", async () => {
		expect(await handleSuiteEvent("<xml><InfoType>change_contact</InfoType><SuiteId>suite_1</SuiteId></xml>", deps(fakeClient()))).toBe("change_contact");
	});

	it("create_auth 缺 AuthCode → 400（宁可拒也不落半行 profile）", async () => {
		await putSuiteTicket(CFG.suiteId, "tk_1", clock + 1800, storeDeps());
		await expect(handleSuiteEvent("<xml><InfoType>create_auth</InfoType><SuiteId>suite_1</SuiteId></xml>", deps(fakeClient())))
			.rejects
			.toMatchObject({ status: 400 });
	});
});

describe("P1-H：授权链接与 state（一次性）", () => {
	it("企微内用 oauth2（snsapi_base + agentid + #wechat_redirect）；浏览器用 qrConnect", () => {
		const base = { corpId: "ww1", agentId: "100001", redirectUri: "https://s.example.com/cb?a=1&b=2", state: "st" };
		const inApp = buildAuthorizeUrl({ ...base, inWecom: true });
		expect(inApp).toContain("connect/oauth2/authorize");
		expect(inApp).toContain("scope=snsapi_base");
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
		expect(() => readWecomConfig()).toThrow(/wecom_suite_id.*wecom_callback_token.*wecom_enc_key/);
	});

	it("baseUrl 去尾斜杠后拼出两个企微侧地址（回调 URL 要原样填进后台）", () => {
		installVars();
		const cfg = readWecomConfig();
		expect(cfg.baseUrl).toBe("https://site.example.com/api/auth/wecom");
		expect(eventUrlOf(cfg)).toBe("https://site.example.com/api/auth/wecom/event");
		expect(loginRedirectOf(cfg)).toBe("https://site.example.com/api/auth/wecom/callback");
		expect(siteRootOf(cfg)).toBe("https://site.example.com");
	});

	it("子路径部署：站点根保留子路径（302 回跳必须落 /oj/login，不是 /login）", () => {
		installVars({ wecom_base_url: "https://site.example.com/oj/api/auth/wecom" });
		const cfg = readWecomConfig();
		expect(siteRootOf(cfg)).toBe("https://site.example.com/oj");
		expect(loginLandingUrl({ origin: siteRootOf(cfg), ticket: "tk", tenant: "ww_corp_a" }))
			.toBe("https://site.example.com/oj/login?wecom_ticket=tk&tenant=ww_corp_a");
		// 开通入口的 redirect_uri 同样要带子路径
		expect(installUrlOf(cfg, "PAC1", "env=prod")).toContain(`redirect_uri=${encodeURIComponent("https://site.example.com/oj/login?wecom_installed=1")}`);
	});

	it("baseUrl 后缀不对 → 400（宁可拒，也不猜站点根拼出错误回跳）", () => {
		installVars({ wecom_base_url: "https://site.example.com/api/wecom" });
		expect(() => siteRootOf(readWecomConfig())).toThrow(/必须以 \/api\/auth\/wecom 结尾/);
	});

	it("baseUrl 非绝对地址 → 400（相对路径会让 redirect_uri 与回调 URL 双双失效）", () => {
		installVars({ wecom_base_url: "/api/auth/wecom" });
		expect(() => readWecomConfig()).toThrow(/绝对地址/);
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
