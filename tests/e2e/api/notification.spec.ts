import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * 通知多模块后端 e2e（真实运行服务，ojm dev 反代的 /api）。
 * 设计文档 §6 覆盖点：按人隔离、归属 403、广播全员可见+独立已读、发射原语端点、命名空间 id 路由。
 * spec 零 import 源码：仅通过 HTTP 观测，不依赖任何 #src/@oj-module 内部实现。
 *
 * 凭据约定（见 api/src/web/seed.sql 注头）：admin/common 口令均为 12345。
 * admin = user id 1，common = user id 2（seed 插入序）。
 */

const ADMIN = { username: "admin", password: "12345" } as const;
const COMMON = { username: "common", password: "12345" } as const;

interface Env {
	code: number
	msg?: string
	data?: unknown
}

async function login(request: APIRequestContext, creds: { username: string, password: string }): Promise<string> {
	const resp = await request.post("/api/auth/login", { data: creds });
	expect(resp.status(), "login 应 200").toBe(200);
	const body = (await resp.json()) as Env;
	expect(body.code, "login 信封 code 应 0").toBe(0);
	const token = (body.data as { access_token: string }).access_token;
	expect(token?.length ?? 0, "应返回 access_token").toBeGreaterThan(0);
	return token;
}

function auth(request: APIRequestContext, token: string) {
	return {
		async get(path: string): Promise<APIResponse> {
			return request.get(path, { headers: { Authorization: `Bearer ${token}` } });
		},
		async post(path: string, data?: unknown): Promise<APIResponse> {
			return request.post(path, { data, headers: { Authorization: `Bearer ${token}` } });
		},
	};
}

/** 断言响应是 oj 信封且取出 data（HTTP 2xx + code 0） */
async function envelope(resp: APIResponse): Promise<{ body: Env, data: any }> {
	expect(resp.status(), `HTTP 状态应 2xx，实得 ${resp.status()}`).toBeLessThan(300);
	const body = (await resp.json()) as Env;
	expect(body.code, `信封 code 应 0，实得 ${body.code}:${body.msg}`).toBe(0);
	return { body, data: body.data };
}

/** 清空两用户通知，保证用例间确定性（db.sqlite 持久化，跨运行会累积） */
async function clean(adminApi: ReturnType<typeof auth>, commonApi: ReturnType<typeof auth>): Promise<void> {
	await adminApi.post("/api/notification/notifications/clear");
	await commonApi.post("/api/notification/notifications/clear");
}

interface NoticeItem {
	id: string
	scope: "user" | "broadcast"
	title: string
	isRead?: boolean
	link?: string | null
	category?: string
}

test.describe("notification 多模块通知 API", () => {
	let adminTok: string;
	let commonTok: string;
	let adminApi: ReturnType<typeof auth>;
	let commonApi: ReturnType<typeof auth>;

	test.beforeEach(async ({ request }) => {
		// legacy worktree（411e353b）无本模块端点，整组跳过
		if ((process.env.E2E_TARGET ?? "playground") === "legacy") {
			test.skip(true, "legacy 环境无 notification 模块");
		}
		adminTok = await login(request, ADMIN);
		commonTok = await login(request, COMMON);
		adminApi = auth(request, adminTok);
		commonApi = auth(request, commonTok);
		await clean(adminApi, commonApi);
	});

	// 未带 Bearer → 401（Bearer 守卫）
	test("N0: 未授权访问通知列表 → 401", async ({ request }) => {
		const resp = await request.get("/api/notification/notifications");
		expect(resp.status()).toBe(401);
	});

	// push 返回命名空间 id "u:<id>"
	test("N1: push 返回 u: 命名空间 id", async () => {
		const { data } = await envelope(await adminApi.post("/api/notification/push", { title: "t1", message: "m1" }));
		expect((data as { id: string }).id).toMatch(/^u:\d+$/);
	});

	// push-broadcast 返回命名空间 id "b:<id>"
	test("N2: push-broadcast 返回 b: 命名空间 id", async () => {
		const { data } = await envelope(await adminApi.post("/api/notification/push-broadcast", { title: "bt", message: "bm" }));
		expect((data as { id: string }).id).toMatch(/^b:\d+$/);
	});

	// 按人隔离：admin push 给 common，admin 不可见、common 可见
	test("N3: 按人隔离 —— A push 给 B 后仅 B 可见", async () => {
		const { data } = await envelope(
			await adminApi.post("/api/notification/push", { userId: 2, title: "to-common", message: "hi common" }),
		);
		const id = (data as { id: string }).id;

		const adminList = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(adminList.find(n => n.id === id), "admin 不应看到发给 common 的通知").toBeUndefined();

		const commonList = (await envelope(await commonApi.get("/api/notification/notifications"))).data as NoticeItem[];
		const hit = commonList.find(n => n.id === id);
		expect(hit, "common 应看到发给自己的通知").toBeDefined();
		expect(hit!.scope).toBe("user");
		expect(hit!.title).toBe("to-common");
	});

	// 默认 push 给当前登录用户（admin 自己）
	test("N4: 不指定 userId 时 push 给当前用户本人", async () => {
		const { data } = await envelope(await adminApi.post("/api/notification/push", { title: "to-self", message: "mine" }));
		const id = (data as { id: string }).id;
		const adminList = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(adminList.find(n => n.id === id), "admin 应看到自己 push 的通知").toBeDefined();
		const commonList = (await envelope(await commonApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(commonList.find(n => n.id === id), "common 不应看到 admin 的自推通知").toBeUndefined();
	});

	// 跨用户 del → 403（归属校验，delNotice 返回 false）
	test("N5: 删除他人按人通知 → 403", async () => {
		const id = (await envelope(await adminApi.post("/api/notification/push", { title: "a", message: "b" }))).data as { id: string };
		const resp = await commonApi.post("/api/notification/del", { id: id.id });
		expect(resp.status(), "他人项删除应 403").toBe(403);

		// 本人删除成功且列表不再含该条
		const ok = await adminApi.post("/api/notification/del", { id: id.id });
		expect(ok.status(), "本人删除应 200").toBeLessThan(300);
		const adminList = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(adminList.find(n => n.id === id.id)).toBeUndefined();
	});

	// 跨用户 read → 403（markRead 归属校验，N8 修复后对称于 del）
	test("N6: 已读他人按人通知 → 403", async () => {
		const id = (await envelope(await adminApi.post("/api/notification/push", { title: "a", message: "b" }))).data as { id: string };
		const resp = await commonApi.post("/api/notification/notifications/read", { id: id.id });
		expect(resp.status(), "他人项已读应 403").toBe(403);

		// 本人已读成功，且该项 isRead 翻转
		await adminApi.post("/api/notification/notifications/read", { id: id.id });
		const adminList = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		const hit = adminList.find(n => n.id === id.id);
		expect(hit?.isRead, "本人已读后该项应 isRead=true").toBe(true);
	});

	// 广播：一行全员可见，且各自已读独立
	test("N7: 广播全员可见 + 各自已读独立", async () => {
		const { data } = await envelope(await adminApi.post("/api/notification/push-broadcast", { title: "bcast", message: "all" }));
		const bid = (data as { id: string }).id;

		// 两用户均可见
		const adminList = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		const commonList = (await envelope(await commonApi.get("/api/notification/notifications"))).data as NoticeItem[];
		const aHit = adminList.find(n => n.id === bid);
		const cHit = commonList.find(n => n.id === bid);
		expect(aHit, "admin 应看到广播").toBeDefined();
		expect(cHit, "common 应看到广播").toBeDefined();
		expect(aHit!.scope).toBe("broadcast");
		expect(aHit!.isRead).toBe(false);
		expect(cHit!.isRead).toBe(false);

		// 仅 admin 已读广播
		await adminApi.post("/api/notification/notifications/read", { id: bid });
		const adminList2 = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		const commonList2 = (await envelope(await commonApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(adminList2.find(n => n.id === bid)!.isRead, "admin 广播应已读").toBe(true);
		expect(commonList2.find(n => n.id === bid)!.isRead, "common 广播仍应未读（独立回执）").toBe(false);
	});

	// 广播：删除仅移除本人回执，广播作为全员全局项不会从列表消失（仅回到未读），不影响他人可见性
	test("N8: 删除广播仅移除本人回执（列表仍可见，不影响他人）", async () => {
		const { data } = await envelope(await adminApi.post("/api/notification/push-broadcast", { title: "bcast2", message: "all2" }));
		const bid = (data as { id: string }).id;

		// common 先已读该广播
		await commonApi.post("/api/notification/notifications/read", { id: bid });
		const before = (await envelope(await commonApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(before.find(n => n.id === bid)!.isRead, "common 已读后广播应 isRead=true").toBe(true);

		// common 删除该广播（设计文档：仅删自己回执，全局项不消失）
		const del = await commonApi.post("/api/notification/del", { id: bid });
		expect(del.status(), "删除广播应 200").toBeLessThan(300);

		// common 自身：广播仍在列表，但回执被清、回到未读
		const commonList = (await envelope(await commonApi.get("/api/notification/notifications"))).data as NoticeItem[];
		const cHit = commonList.find(n => n.id === bid);
		expect(cHit, "common 删除广播后，全局项仍在自己列表（仅回执被清）").toBeDefined();
		expect(cHit!.isRead, "common 删除后广播应回到未读").toBe(false);

		// admin（未删）同样可见，不受影响
		const adminList = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(adminList.find(n => n.id === bid), "admin 的广播不受影响仍可见").toBeDefined();
	});

	// 全部已读只影响自己
	test("N9: 全部已读仅影响当前用户", async () => {
		await adminApi.post("/api/notification/push", { title: "a1", message: "m" });
		await commonApi.post("/api/notification/push", { title: "c1", message: "m" });

		await adminApi.post("/api/notification/notifications/read-all");
		const adminList = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(adminList.every(n => n.isRead === true), "admin 全部已读后列表应全已读").toBe(true);

		const commonList = (await envelope(await commonApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(commonList.some(n => n.isRead !== true), "common 不受 admin 全部已读影响").toBe(true);
	});

	// 命名空间 id 路由：u:/b: 即使数字相同也互不串（分表存储 + 前缀路由）
	test("N10: u:/b: 命名空间互不影响（分表路由）", async () => {
		const u = (await envelope(await adminApi.post("/api/notification/push", { title: "u-item", message: "m" }))).data as { id: string };
		const b = (await envelope(await adminApi.post("/api/notification/push-broadcast", { title: "b-item", message: "m" }))).data as { id: string };
		expect(u.id.startsWith("u:")).toBe(true);
		expect(b.id.startsWith("b:")).toBe(true);

		// 仅已读按人项 u:，广播项 b: 应保持未读（命名空间把两者分到不同表）
		await adminApi.post("/api/notification/notifications/read", { id: u.id });
		let list = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(list.find(n => n.id === u.id)!.isRead, "u: 项已读").toBe(true);
		expect(list.find(n => n.id === b.id)!.isRead, "b: 项仍应未读").toBe(false);

		// 再已读广播项 b:，两者独立
		await adminApi.post("/api/notification/notifications/read", { id: b.id });
		list = (await envelope(await adminApi.get("/api/notification/notifications"))).data as NoticeItem[];
		expect(list.find(n => n.id === b.id)!.isRead, "b: 项已读").toBe(true);
	});
});
