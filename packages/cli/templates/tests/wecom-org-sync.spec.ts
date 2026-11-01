// BDD：B1 企微适配器——错码分流 / 授权模式 / 登录自更新（方案 §6.1、§9.1、D10、D13）。
//
// 这一段钉的是「同步器与登录路径靠什么做判断」，四类会静默出错的地方：
//   · **错码分类**：60011/48002（无权限）必须能跳过并计数，45009/45033（限流）必须退避重试，
//     其余立即失败——三者混成一个 502 的话，同步要么一直白跑、要么把限流当权限错误静默丢部门。
//   · **auth_mode**：成员授权下部门接口 100% 60011，落库错了同步会永远 0 结果且没人知道为什么；
//     企业管理员在后台切换授权模式时只有 `change_auth` 会告诉我们（该通知不带 AuthCode，
//     只能拿已存永久码去 get_auth_info 反查）。
//   · **登录自更新节流**：上万员工每天登录，不节流就是把 user/get 打成常驻流量；
//     但 `user/get` 拿不到（无权限/不在可见范围）时**不能**写节流键，否则这一整天都补不上资料。
//   · **D10 不建占位部门**：登录路径若能顺手建部门，任何成员都能凭空造出组织节点。
import type { WecomCache, WecomHttp } from "../src/auth/api/_shared/wecom/client";
import type { WecomStoreDeps } from "../src/auth/api/_shared/wecom/store";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { upsertDepartment } from "../src/_platform/api/_shared/service/domain/org";
import { createWecomClient, WecomApiError } from "../src/auth/api/_shared/wecom/client";
import { handleSuiteEvent } from "../src/auth/api/_shared/wecom/events";
import { SELF_UPDATE_TTL_SECS, selfUpdate } from "../src/auth/api/_shared/wecom/login";
import { findProfile, probeProfile, putSuiteTicket, saveProfile, setProfileStatus } from "../src/auth/api/_shared/wecom/store";
import { installDb } from "./fixture";

/* eslint-disable test/prefer-lowercase-title -- D/AC 编号是验收锚点，保留大写 */

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

let clock = 1_000_000;

const CFG = {
	suiteId: "suite_1",
	suiteSecret: "secret_1",
	token: "tok",
	encodingAesKey: "a".repeat(43),
	encKey: "k",
	baseUrl: "https://site.example.com/api/auth/wecom",
};

function storeDeps(): WecomStoreDeps {
	return {
		encrypt: (p: string) => `enc:${p}`,
		decrypt: (b: string) => b.replace(/^enc:/, ""),
		now: () => clock,
	};
}

function memCache(): WecomCache & { keys: () => string[] } {
	const map = new Map<string, { value: string, exp: number }>();
	return {
		async get(key) {
			const hit = map.get(key);
			return hit && hit.exp > clock ? hit.value : null;
		},
		async set(key, value, ttl) {
			map.set(key, { value, exp: clock + ttl });
		},
		async del(key) {
			map.delete(key);
		},
		keys: () => [...map.keys()],
	};
}

/** 预置 corp token 缓存：让被测路径只剩「目标接口」一次出网，调用次数才好断言 */
async function cacheWithToken(): Promise<WecomCache> {
	const cache = memCache();
	await cache.set("wecom:corp_token:ww_corp_a:100001", "ct", 7200);
	return cache;
}

/** 只回答通讯录接口的桩：按 path 命中 errcode，`calls` 用来断言重试次数 */
function stubHttp(reply: { errcode: number, errmsg?: string, payload?: Record<string, unknown> }): WecomHttp & { calls: string[] } {
	const calls: string[] = [];
	const data = { errcode: reply.errcode, errmsg: reply.errmsg ?? "", ...(reply.payload ?? {}) };
	return {
		calls,
		async getJson(url) {
			calls.push(url);
			return data;
		},
		async postJson(url) {
			calls.push(url);
			return data;
		},
	};
}

async function clientWith(reply: { errcode: number, errmsg?: string, payload?: Record<string, unknown> }) {
	const http = stubHttp(reply);
	const cache = await cacheWithToken();
	return { http, cache, client: createWecomClient({ http, cache }) };
}

beforeAll(() => {
	dbo = installDb();
	g.db.asTenant = () => {};
	g.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
});

beforeEach(() => {
	g.http = {};
});

afterEach(() => {
	g.http = {};
	clock = 1_000_000;
	for (const t of ["wecom_app_profile", "wecom_suite_ticket", "sys_dept_member", "sys_department", "users", "sys_oplog", "sys_refresh_token"])
		dbo.exec(`DELETE FROM ${t}`);
});

describe("B1-A：企微错码三分（同步器靠 kind 决定跳过/退避/熔断）", () => {
	it("60011 / 48002 → permission：立即抛出，不重试（无权限重试一万次也还是无权限）", async () => {
		for (const code of [60011, 48002]) {
			const { http, client } = await clientWith({ errcode: code, errmsg: "no privilege" });
			const err = await client.departmentList("ww_corp_a", "100001", "perm", undefined).catch(e => e);
			expect(err).toBeInstanceOf(WecomApiError);
			expect(err.kind).toBe("permission");
			expect(err.errcode).toBe(code);
			expect(http.calls).toHaveLength(1);
		}
	});

	it("45009 / 45033 → ratelimit：退避重试三次，仍失败才抛（错码必须带出去）", async () => {
		for (const code of [45009, 45033]) {
			const { http, client } = await clientWith({ errcode: code, errmsg: "rate limit" });
			const err = await client.departmentList("ww_corp_a", "100001", "perm", undefined).catch(e => e);
			expect(err).toBeInstanceOf(WecomApiError);
			expect(err.kind).toBe("ratelimit");
			expect(err.errcode).toBe(code);
			// 首次 + 两次退避重试
			expect(http.calls).toHaveLength(3);
		}
	});

	it("其余错码 → fatal：一次就抛（60020 是 IP 白名单，重试没有意义）", async () => {
		const { http, client } = await clientWith({ errcode: 60020, errmsg: "not allow to access from your ip" });
		const err = await client.departmentList("ww_corp_a", "100001", "perm", undefined).catch(e => e);
		expect(err.kind).toBe("fatal");
		expect(http.calls).toHaveLength(1);
	});

	it("token 失效（40001）先换票重试一次，不把用户打成失败", async () => {
		const cache = await cacheWithToken();
		let first = true;
		const http: WecomHttp = {
			async getJson(url) {
				if (url.includes("/cgi-bin/gettoken"))
					return { errcode: 0, access_token: "ct2", expires_in: 7200 };
				if (first) {
					first = false;
					return { errcode: 40001, errmsg: "invalid credential" };
				}
				return { errcode: 0, department: [{ id: 1, name: "总公司" }] };
			},
			async postJson() {
				return { errcode: 0 };
			},
		};
		const client = createWecomClient({ http, cache });
		const list = await client.departmentList("ww_corp_a", "100001", "perm", undefined);
		expect(list).toHaveLength(1);
		// 旧 token 已作废：缓存里换成了新票
		expect(await cache.get("wecom:corp_token:ww_corp_a:100001")).toBe("ct2");
	});

	it("userDetail 是 best-effort：任何错码都返回 null，绝不抛出（登录不能因此 5xx）", async () => {
		const { client } = await clientWith({ errcode: 60011, errmsg: "no privilege" });
		await expect(client.userDetail("ww_corp_a", "100001", "perm", "zhangsan")).resolves.toBeNull();
	});

	it("userDetail 回包缺 userid（精简回包）也用入参补，姓名照常拿到", async () => {
		const { client } = await clientWith({ errcode: 0, payload: { name: "张三", department: [2], order: [10] } });
		const detail = await client.userDetail("ww_corp_a", "100001", "perm", "zhangsan");
		expect(detail).toMatchObject({ userid: "zhangsan", name: "张三", departments: ["2"] });
	});
});

describe("B1-B：授权模式（auth_mode）", () => {
	it("落库：saveProfile 带 authMode → 读回同一个值", async () => {
		await saveProfile({
			suiteId: CFG.suiteId,
			corpId: "ww_corp_a",
			authCorpId: "ww_corp_a",
			agentId: "100001",
			env: "prod",
			corpName: "测试企业",
			credentialKind: "suite",
			permanentCode: "perm_a",
			authMode: 1,
		}, storeDeps());
		expect((await findProfile("ww_corp_a", "100001", storeDeps())).authMode).toBe(1);
		expect(dbo.prepare("SELECT auth_mode FROM wecom_app_profile").get()).toMatchObject({ auth_mode: 1 });
	});

	it("缺省按 0（管理员授权）——成员授权会让同步 100% 60011，但也不能反过来猜成 1", async () => {
		await saveProfile({
			suiteId: CFG.suiteId,
			corpId: "ww_corp_a",
			authCorpId: "ww_corp_a",
			agentId: "100001",
			env: "prod",
			corpName: null,
			credentialKind: "suite",
			permanentCode: "perm_a",
		} as never, storeDeps());
		expect((await findProfile("ww_corp_a", "100001", storeDeps())).authMode).toBe(0);
	});

	it("change_auth：用已存永久码反查 get_auth_info 并刷新 auth_mode（不带 AuthCode 的唯一路径）", async () => {
		await saveProfile({
			suiteId: CFG.suiteId,
			corpId: "ww_corp_a",
			authCorpId: "ww_corp_a",
			agentId: "100001",
			env: "prod",
			corpName: "测试企业",
			credentialKind: "suite",
			permanentCode: "perm_a",
			authMode: 0,
		}, storeDeps());
		await putSuiteTicket(CFG.suiteId, "tk_1", clock + 1800, storeDeps());

		const seen: string[] = [];
		const client = {
			async suiteAccessToken() {
				return "sat";
			},
			async authModesByPermanentCode(suiteToken: string, corpId: string, permanentCode: string) {
				seen.push(`${suiteToken}/${corpId}/${permanentCode}`);
				return { 100001: 1 };
			},
		} as never;

		await handleSuiteEvent({ InfoType: "change_auth", SuiteId: "suite_1", AuthCorpId: "ww_corp_a" }, { cfg: CFG, client, store: storeDeps() });
		expect(seen).toEqual(["sat/ww_corp_a/perm_a"]);
		expect((await findProfile("ww_corp_a", "100001", storeDeps())).authMode).toBe(1);
	});

	it("change_auth 复核失败只告警：回调仍回 success（窗口 1 秒，重推补不回来）", async () => {
		await saveProfile({
			suiteId: CFG.suiteId,
			corpId: "ww_corp_a",
			authCorpId: "ww_corp_a",
			agentId: "100001",
			env: "prod",
			corpName: "测试企业",
			credentialKind: "suite",
			permanentCode: "perm_a",
			authMode: 0,
		}, storeDeps());
		await putSuiteTicket(CFG.suiteId, "tk_1", clock + 1800, storeDeps());
		const client = {
			async suiteAccessToken() {
				throw new Error("企微 get_suite_token 失败：errcode=40001");
			},
		} as never;
		await expect(handleSuiteEvent({ InfoType: "change_auth", SuiteId: "suite_1", AuthCorpId: "ww_corp_a" }, { cfg: CFG, client, store: storeDeps() }))
			.resolves
			.toBe("change_auth");
		// 旧值保留，同步闸门那侧还有 60011 兜底
		expect((await findProfile("ww_corp_a", "100001", storeDeps())).authMode).toBe(0);
	});
});

describe("B1-D：授权探针（同步入口的准入事实）", () => {
	const profile = (agentId: string, authMode = 0) => saveProfile({
		suiteId: CFG.suiteId,
		corpId: "ww_corp_a",
		authCorpId: "ww_corp_a",
		agentId,
		env: "prod",
		corpName: null,
		credentialKind: "suite",
		permanentCode: `perm_${agentId}`,
		authMode,
	}, storeDeps());

	it("没装企微 → null：页面据此整条不显示，而不是画红叉", async () => {
		expect(await probeProfile("ww_unknown", null)).toBeNull();
	});

	it("装了 → 拿得到 agent + 授权模式；带 agent 可收窄，指错应用 → null", async () => {
		await profile("100001", 1);
		expect(await probeProfile("ww_corp_a", null)).toEqual({ agentId: "100001", authMode: 1, status: "active", credentialKind: "suite" });
		expect(await probeProfile("ww_corp_a", "100001")).toMatchObject({ authMode: 1 });
		expect(await probeProfile("ww_corp_a", "200002")).toBeNull();
	});

	it("同企业多个启用应用且没带 agent → 400（真歧义，不能瞎挑一个去同步）", async () => {
		await profile("100001");
		await profile("200002");
		await expect(probeProfile("ww_corp_a", null)).rejects.toMatchObject({ status: 400 });
		expect(await probeProfile("ww_corp_a", "200002")).toMatchObject({ agentId: "200002" });
	});

	it("企业被停用/取消授权 → 仍探得到（status=disabled），同步面据此画冻结黄条而不是「没装」", async () => {
		await profile("100001");
		await setProfileStatus("ww_corp_a", "disabled", storeDeps());
		expect(await probeProfile("ww_corp_a", null)).toMatchObject({ status: "disabled" });
	});

	it("停用后再装一个新应用：优先返回启用中的那个（别把活的应用报成冻结）", async () => {
		await profile("100001");
		await profile("200002");
		await db.table("wecom_app_profile").update({ status: "disabled" }).where({ field: "agent_id", op: "eq", value: "100001" }).run();
		expect(await probeProfile("ww_corp_a", null)).toMatchObject({ agentId: "200002", status: "active" });
	});
});

describe("B1-C：登录自更新（轨一）", () => {
	function mkUser(username: string, extra: Record<string, unknown> = {}): number {
		dbo.prepare("INSERT INTO users (username, password_hash, display_name, source) VALUES (?, '!wecom', ?, ?)")
			.run(username, extra.displayName ?? username, extra.source ?? "wecom");
		return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
	}

	async function wecomDept(originId: string, name = `部门${originId}`): Promise<number> {
		return upsertDepartment({ origin: "wecom", originId, parentId: null, name }, { now: () => clock });
	}

	function userRow(username: string): Record<string, unknown> {
		return dbo.prepare("SELECT display_name, position, external_status, activated, source FROM users WHERE username = ?").get(username) as Record<string, unknown>;
	}

	/** 只实现 userDetail 的桩：`detail` 为 null 表示拿不到（无权限/不在可见范围） */
	function clientOf(detail: unknown, counter?: { n: number }) {
		return {
			async userDetail() {
				if (counter)
					counter.n++;
				if (detail instanceof Error)
					throw detail;
				return detail;
			},
		} as never;
	}

	const ctx = { uid: 0, userid: "zhangsan", corpId: "ww_corp_a", agentId: "100001", permanentCode: "perm_a" };

	it("首次登录：姓名/职务/在职状态回写 + 部门关联 + 主部门，并写 24h 节流键", async () => {
		const uid = mkUser("wecom:zhangsan");
		const deptId = await wecomDept("2");
		const cache = memCache();
		const res = await selfUpdate({ ...ctx, uid }, {
			client: clientOf({ userid: "zhangsan", name: "张三", position: "工程师", status: 1, departments: ["2"], orders: [10], leaderInDept: [1], mainDepartment: null }),
			cache,
			store: storeDeps(),
		});
		expect(res.blocked).toBe(false);
		expect(userRow("wecom:zhangsan")).toMatchObject({ display_name: "张三", position: "工程师", external_status: 1, activated: 1, source: "wecom" });
		expect(dbo.prepare("SELECT dept_id, order_no, is_leader, is_main FROM sys_dept_member WHERE user_id = ?").get(uid))
			.toMatchObject({ dept_id: deptId, order_no: 10, is_leader: 1, is_main: 1 });
		expect(await cache.get("wecom:self:ww_corp_a:zhangsan")).toBe("1");
	});

	it("节流内再次登录不再打上游（一次 user/get 顶一天）", async () => {
		const uid = mkUser("wecom:zhangsan");
		const cache = memCache();
		const counter = { n: 0 };
		const detail = { userid: "zhangsan", name: "张三", position: null, status: 1, departments: [], orders: [], leaderInDept: [], mainDepartment: null };
		await selfUpdate({ ...ctx, uid }, { client: clientOf(detail, counter), cache, store: storeDeps() });
		clock += SELF_UPDATE_TTL_SECS - 1;
		await selfUpdate({ ...ctx, uid }, { client: clientOf(detail, counter), cache, store: storeDeps() });
		expect(counter.n).toBe(1);
	});

	it("userDetail 拿不到（null）：不写节流键，下次登录还能补（否则这天都补不上资料）", async () => {
		const uid = mkUser("wecom:zhangsan");
		const cache = memCache();
		const res = await selfUpdate({ ...ctx, uid }, { client: clientOf(null), cache, store: storeDeps() });
		expect(res.blocked).toBe(false);
		expect(await cache.get("wecom:self:ww_corp_a:zhangsan")).toBeNull();
	});

	it("状态 2（已禁用）/ 5（退出企业）→ blocked=true，登录侧据此 403", async () => {
		const uid = mkUser("wecom:zhangsan");
		for (const status of [2, 5]) {
			const res = await selfUpdate({ ...ctx, uid }, {
				client: clientOf({ userid: "zhangsan", name: "张三", position: null, status, departments: [], orders: [], leaderInDept: [], mainDepartment: null }),
				cache: memCache(),
				store: storeDeps(),
			});
			expect(res.blocked).toBe(true);
		}
	});

	it("节流命中时仍读本地 external_status 判禁用（不能因为跳过上游就放行离职的人）", async () => {
		const uid = mkUser("wecom:zhangsan");
		dbo.prepare("UPDATE users SET external_status = 5 WHERE id = ?").run(uid);
		const cache = memCache();
		await cache.set("wecom:self:ww_corp_a:zhangsan", "1", SELF_UPDATE_TTL_SECS);
		const counter = { n: 0 };
		const res = await selfUpdate({ ...ctx, uid }, { client: clientOf(null, counter), cache, store: storeDeps() });
		expect(res.blocked).toBe(true);
		expect(counter.n).toBe(0);
	});

	it("未知部门一律跳过、不建占位部门（D10：登录成员不得凭空造组织节点）", async () => {
		const uid = mkUser("wecom:zhangsan");
		await selfUpdate({ ...ctx, uid }, {
			client: clientOf({ userid: "zhangsan", name: "张三", position: null, status: 1, departments: ["999"], orders: [1], leaderInDept: [0], mainDepartment: null }),
			cache: memCache(),
			store: storeDeps(),
		});
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_department").get()).toMatchObject({ c: 0 });
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_dept_member").get()).toMatchObject({ c: 0 });
	});

	it("只写企微拥有的行（D13）：管理员已「转为本地维护」的号不被覆盖", async () => {
		const uid = mkUser("wecom:zhangsan", { displayName: "本地维护名", source: "local" });
		await selfUpdate({ ...ctx, uid }, {
			client: clientOf({ userid: "zhangsan", name: "企微名", position: "工程师", status: 1, departments: [], orders: [], leaderInDept: [], mainDepartment: null }),
			cache: memCache(),
			store: storeDeps(),
		});
		expect(userRow("wecom:zhangsan")).toMatchObject({ display_name: "本地维护名", source: "local", position: null });
	});

	it("上游/写库异常不影响登录：永不抛出，只 blocked=false", async () => {
		const uid = mkUser("wecom:zhangsan");
		const res = await selfUpdate({ ...ctx, uid }, { client: clientOf(new Error("上游炸了")), cache: memCache(), store: storeDeps() });
		expect(res.blocked).toBe(false);
	});
});

// 轨三：事件增量。全程**只有一条纪律**要钉住——事件是加速器，不是权威：
//   写对了就立刻可见（不必等下一次全量），写错了也绝不抛（抛了企微重推三次，而重推补不回来）。
describe("C1：通讯录事件增量（change_contact）", () => {
	/** 应用侧数据回调（90970）：企业身份在 ToUserName，没有 InfoType */
	const appEvent = (extra: Record<string, unknown>) => ({
		ToUserName: "ww_corp_a",
		FromUserName: "sys",
		CreateTime: 1_700_000_000,
		MsgType: "event",
		Event: "change_contact",
		...extra,
	});

	/** 代开发指令回调（91134）：企业身份在 AuthCorpId，事件名在 InfoType，字段往往只有一个 id */
	const suiteEvent = (extra: Record<string, unknown>) => ({
		SuiteId: "suite_1",
		AuthCorpId: "ww_corp_a",
		InfoType: "change_contact",
		...extra,
	});

	async function authorized(): Promise<void> {
		await saveProfile({
			suiteId: CFG.suiteId,
			corpId: "ww_corp_a",
			authCorpId: "ww_corp_a",
			agentId: "100001",
			env: "prod",
			corpName: "测试企业",
			credentialKind: "suite",
			permanentCode: "perm_a",
			authMode: 0,
		}, storeDeps());
	}

	/** 只实现两个回源接口的桩：member/dept 缺省 = 拿不到（无权限 / 不在可见范围） */
	function clientOf(opts: { member?: unknown, dept?: unknown } = {}) {
		const calls = { member: 0, dept: 0 };
		return {
			calls,
			async userDetail() {
				calls.member++;
				return opts.member ?? null;
			},
			async departmentDetail() {
				calls.dept++;
				if (!opts.dept)
					throw new Error("企微 department/get 失败：errcode=60011");
				return opts.dept;
			},
		};
	}

	const deps = (client: unknown) => ({ cfg: CFG, client: client as never, store: storeDeps() });

	async function wecomDept(originId: string, name = `部门${originId}`, parentId: number | null = null): Promise<number> {
		return upsertDepartment({ origin: "wecom", originId, parentId, name }, { now: () => clock });
	}

	function mkUser(username: string, extra: Record<string, unknown> = {}): number {
		dbo.prepare("INSERT INTO users (username, password_hash, display_name, source, activated) VALUES (?, '!wecom', ?, 'wecom', ?)")
			.run(username, extra.displayName ?? username, extra.activated ?? 0);
		return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
	}

	const uidOf = (username: string) => (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined)?.id;

	it("create_user（应用侧）：建档但不置 activated，姓名/部门/主部门照事件落库", async () => {
		await authorized();
		const d1 = await wecomDept("1");
		const d2 = await wecomDept("2");
		const client = clientOf();
		await handleSuiteEvent(appEvent({
			ChangeType: "create_user",
			UserID: "zhangsan",
			Name: "张三",
			Department: "1|2",
			MainDepartment: "2",
			IsLeaderInDept: "1|0",
		}), deps(client));

		// 回源拿不到（无通讯录权限）→ 退回事件自带字段，而不是什么都不写
		expect(client.calls.member).toBe(1);
		expect(dbo.prepare("SELECT display_name, source, activated FROM users WHERE username = 'wecom:zhangsan'").get())
			.toMatchObject({ display_name: "张三", source: "wecom", activated: 0 });
		const uid = uidOf("wecom:zhangsan")!;
		expect(dbo.prepare("SELECT dept_id, is_leader, is_main FROM sys_dept_member WHERE user_id = ? ORDER BY dept_id").all(uid))
			.toEqual([{ dept_id: d1, is_leader: 1, is_main: 0 }, { dept_id: d2, is_leader: 0, is_main: 1 }]);
	});

	it("create_user（代开发形态只有 UserID）：回源拿全量快照，职务/排序/在职状态都补上", async () => {
		await authorized();
		const d1 = await wecomDept("1");
		await handleSuiteEvent(suiteEvent({ ChangeType: "create_user", UserID: "lisi" }), deps(clientOf({
			member: { userid: "lisi", name: "李四", position: "经理", status: 1, departments: ["1"], orders: [5], leaderInDept: [1], mainDepartment: 1 },
		})));

		expect(dbo.prepare("SELECT display_name, position, external_status FROM users WHERE username = 'wecom:lisi'").get())
			.toMatchObject({ display_name: "李四", position: "经理", external_status: 1 });
		expect(dbo.prepare("SELECT dept_id, order_no, is_leader, is_main FROM sys_dept_member WHERE user_id = ?").get(uidOf("wecom:lisi")))
			.toMatchObject({ dept_id: d1, order_no: 5, is_leader: 1, is_main: 1 });
	});

	it("update_user + NewUserID：同一行改名（不新建）+ 吊销旧会话", async () => {
		await authorized();
		const uid = mkUser("wecom:zhangsan", { activated: 1 });
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, user_id, expires_at, revoked, created_at) VALUES ('h1', ?, 0, 0, 0)").run(uid);

		await handleSuiteEvent(appEvent({ ChangeType: "update_user", UserID: "zhangsan", NewUserID: "zhangsan2", Name: "张三" }), deps(clientOf()));

		expect(uidOf("wecom:zhangsan")).toBeUndefined();
		// 同一行：id 不变、activated 保持（登录过就是登录过）
		expect(dbo.prepare("SELECT id, display_name, activated FROM users WHERE username = 'wecom:zhangsan2'").get())
			.toMatchObject({ id: uid, display_name: "张三", activated: 1 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token WHERE user_id = ?").get(uid)).toMatchObject({ n: 0 });
	});

	it("delete_user：置 external_status=5 并摘掉部门关联，但**不删账号**", async () => {
		await authorized();
		const d1 = await wecomDept("1");
		const uid = mkUser("wecom:zhangsan", { displayName: "张三", activated: 1 });
		dbo.prepare("INSERT INTO sys_dept_member (tenant_id, user_id, dept_id, order_no, is_leader, is_main, update_time) VALUES ('default', ?, ?, 0, 0, 1, 0)").run(uid, d1);
		dbo.prepare("INSERT INTO sys_refresh_token (token_hash, user_id, expires_at, revoked, created_at) VALUES ('h2', ?, 0, 0, 0)").run(uid);

		await handleSuiteEvent(appEvent({ ChangeType: "delete_user", UserID: "zhangsan" }), deps(clientOf()));

		// 账号留着（角色、历史操作、文件归属都挂在 users.id 上）；只摘组织关系与外部状态
		expect(dbo.prepare("SELECT display_name, external_status, is_forbidden FROM users WHERE id = ?").get(uid))
			.toMatchObject({ display_name: "张三", external_status: 5, is_forbidden: 0 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_dept_member WHERE user_id = ?").get(uid)).toMatchObject({ n: 0 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_refresh_token WHERE user_id = ?").get(uid)).toMatchObject({ n: 0 });
	});

	it("create_party / update_party：落库并解析出本地父 id（事件给的是企微部门 id）", async () => {
		await authorized();
		const parent = await wecomDept("1");
		await handleSuiteEvent(appEvent({ ChangeType: "create_party", Id: 2, Name: "研发部", ParentId: "1" }), deps(clientOf()));

		expect(dbo.prepare("SELECT origin, origin_id, name, parent_id, deleted FROM sys_department WHERE origin_id = '2'").get())
			.toMatchObject({ origin: "wecom", origin_id: "2", name: "研发部", parent_id: parent, deleted: 0 });
	});

	it("delete_party：deleted=1 并**级联到整棵子树**（企微只报被删的那一个 id）", async () => {
		await authorized();
		const root = await wecomDept("1");
		const mid = await wecomDept("2", "子部门", root);
		const leaf = await wecomDept("3", "孙部门", mid);

		await handleSuiteEvent(appEvent({ ChangeType: "delete_party", Id: 1 }), deps(clientOf()));

		// 子树一并标记：否则它们会挂在一个已删父节点下，列表过滤后变成孤儿
		for (const id of [root, mid, leaf])
			expect(dbo.prepare("SELECT deleted, sync_visible FROM sys_department WHERE id = ?").get(id)).toMatchObject({ deleted: 1, sync_visible: 0 });
	});

	it("回源与事件都没有名字：不建无名部门，也不抛（事件是加速器，失败等全量兜底）", async () => {
		await authorized();
		await expect(handleSuiteEvent(suiteEvent({ ChangeType: "create_party", Id: 9 }), deps(clientOf())))
			.resolves
			.toBe("create_party");
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_department").get()).toMatchObject({ n: 0 });
	});

	it("不认识的 ChangeType（标签变更等）：不写任何东西，也不报错", async () => {
		await authorized();
		await expect(handleSuiteEvent(appEvent({ ChangeType: "update_tag", TagId: 4 }), deps(clientOf())))
			.resolves
			.toBe("update_tag");
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 0 });
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM sys_department").get()).toMatchObject({ n: 0 });
	});

	it("未授权企业的通讯录事件：照旧回事件名，不抛、不写（重推三次也补不回来）", async () => {
		await expect(handleSuiteEvent(appEvent({ ChangeType: "create_user", UserID: "zhangsan", Name: "张三" }), deps(clientOf())))
			.resolves
			.toBe("create_user");
		expect(dbo.prepare("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 0 });
	});
});
