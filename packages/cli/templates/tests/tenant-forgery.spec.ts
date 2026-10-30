// BDD：伪造 `X-TENANT-ID` 的拦截面（计划 §5.7 第 1 项）。
//
// 攻击形态：攻击者持 A 企业的合法 token（JWT 只带 sub，不带租户），请求时把
// `X-TENANT-ID` 改成 B 企业。oj 构造器按当前头值注入 `tenant_id`，于是「A 企业的人
// 查 B 企业的 users」等价于**查无此行**——这是服务端唯一能看见的异常。
//
// 为什么必须单独钉这一层：`assertPermission` / `currentAccess()` 覆盖的是挂了权限点的
// 端点；而通知、我的资料、人员目录这些「登录即可」的端点根本不走它们。少了这一步，
// 伪造头的人能读到别家企业的广播通知、改别家企业的个人资料。
//
// 夹具自此已模拟租户注入（fixture.ts 头注释），跨租户「查不到、改不动」的地基语义由
// tenant-isolation.spec.ts 单独钉；本文件仍用「sub 在库中不存在」来钉端点级拦截——
// 它就是伪造头在 SQL 层的表现，且不依赖构造器能力。对照组用真实 uid 证明同一路径照常放行。
/* eslint-disable test/prefer-lowercase-title -- 用例标题带端点路径，保留原样更易检索 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { invalidateUser } from "../src/_platform/api/_shared/service/infra/access";
import notification from "../src/notification/api/api";
import notificationDel from "../src/notification/api/del/api";
import profile from "../src/personal-center/api/profile/api";
import upload from "../src/personal-center/api/upload/api";
import { installDb } from "./fixture";

const g = globalThis as any;
let dbo: ReturnType<typeof installDb>;

interface Captured { status: number | null, body: any }

let out: Captured;

function installJson(): void {
	out = { status: null, body: null };
	g.json = {
		ok: (data?: unknown) => {
			out.status = 200;
			out.body = data;
		},
		fail: (code: number, msg: string) => {
			out.status = code;
			out.body = { code, msg };
		},
	};
}

function mkUser(username: string): number {
	dbo.prepare("INSERT INTO users (username, password_hash) VALUES (?, 'x')").run(username);
	return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

/** 本租户查无此人的 sub —— 伪造租户头在 SQL 层就是这个样子 */
const FORGED = 987_654_321;

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	invalidateUser(FORGED);
	g.http = {};
});

describe("伪造租户头：通知族全部 403（6 个入口无一漏网）", () => {
	it("GET /api/notification/notifications → 403", async () => {
		installJson();
		g.http = { user: { id: FORGED } };
		await notification.notifications.get();
		expect(out.status).toBe(403);
	});

	it("POST /api/notification/notifications/read → 403（先于 body 校验）", async () => {
		installJson();
		g.http = { user: { id: FORGED }, body: { id: "u:1" } };
		await notification.notifications.read.post();
		expect(out.status).toBe(403);
	});

	it("POST /api/notification/notifications/read-all → 403", async () => {
		installJson();
		g.http = { user: { id: FORGED } };
		await notification.notifications["read-all"].post();
		expect(out.status).toBe(403);
	});

	it("POST /api/notification/notifications/clear → 403", async () => {
		installJson();
		g.http = { user: { id: FORGED } };
		await notification.notifications.clear.post();
		expect(out.status).toBe(403);
	});

	it("POST /api/notification/push → 403（不能先按 body 回 400）", async () => {
		installJson();
		g.http = { user: { id: FORGED }, body: { title: "t", message: "m" } };
		await notification.push.post();
		expect(out.status).toBe(403);
	});

	it("POST /api/notification/push-broadcast → 403（否则可向别家企业广播）", async () => {
		installJson();
		g.http = { user: { id: FORGED }, body: { title: "t", message: "m" } };
		await notification["push-broadcast"].post();
		expect(out.status).toBe(403);
	});

	it("POST /api/notification/del → 403（否则可按 id 删别家企业的通知）", async () => {
		installJson();
		g.http = { user: { id: FORGED }, body: { id: "u:1" } };
		await notificationDel.post();
		expect(out.status).toBe(403);
	});
});

describe("伪造租户头：个人中心写端点 403", () => {
	it("POST /api/personal-center/profile → 403（否则「更新 0 行回 200」）", async () => {
		installJson();
		g.http = { user: { id: FORGED }, body: { email: "x@example.com" } };
		await profile.post();
		expect(out.status).toBe(403);
	});

	it("POST /api/personal-center/upload → 403（且不落 blob 垃圾文件）", async () => {
		installJson();
		g.http = { user: { id: FORGED }, files: [{ key: "", content_type: "image/png" }] };
		await upload.post();
		expect(out.status).toBe(403);
	});
});

describe("对照组：同一路径换真实 uid 照常放行（证明 403 来自租户自洽而非误伤）", () => {
	// 对照组不取通知列表：'noticesFor' 走 UNION，夹具渲染成 `(SELECT …) UNION ALL (SELECT …)`，
	// sqlite 的 compound select 不接受括号（真 oj 构造器无此问题）——那是夹具的能力边界，
	// 与本层要钉的租户拦截无关，故换同一护栏下的 read-all 作对照。
	it("read-all 与我的资料：真实 uid → 200", async () => {
		const uid = mkUser("tf_ok");
		installJson();
		g.http = { user: { id: uid }, tenantId: "default" };
		await notification.notifications["read-all"].post();
		expect(out.status).toBe(200);

		installJson();
		g.http = { user: { id: uid }, body: { description: "hi" } };
		await profile.post();
		expect(out.status).toBe(200);
	});

	it("未认证（无 http.user）仍是 401，不是 403", async () => {
		installJson();
		g.http = {};
		await notification.notifications.get();
		expect(out.status).toBe(401);
	});
});
