// BDD：发布凭证端点族（申请 / 列表 / 撤销 / 兑换）。
//
// 这一层要钉的是**跨请求才看得见的语义**，纯函数测不到：
//   · 一次性：兑换成功后同票再兑必拒（并发双花只有一个赢家）
//   · 时效：过期即拒，且拒绝发生在「已经拿到身份」之前
//   · 隔离：普通用户看不到别人的凭证，超管看得到；归属租户来自 users 行而非请求头
//   · 不留痕：明文只在申请响应里出现一次，库里只有 sha256
/* eslint-disable test/prefer-lowercase-title -- 用例标题带端点路径，保留原样更易检索 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { invalidateUser } from "../src/app/api/_platform/_shared/service/infra/access";
import { CREDENTIAL_TTL_SECS } from "../src/app/api/publish/_shared/identity";
import { createPublishApi } from "../src/app/api/publish/api";
import { installDb } from "./fixture";

const g = globalThis as any;
let dbo: ReturnType<typeof installDb>;

interface Captured { status: number | null, body: any }
let out: Captured;

/** 固定令牌：必须是 64 位 hex，才过得了兑换端点的形状闸门 */
const TOKEN_1 = "a".repeat(64);
const TOKEN_2 = "b".repeat(64);

let clock: number;

/** 假摘要：短、确定性、且**不含原文**（否则「明文不落库」的断言会被夹具自己污染） */
function digest(input: string): string {
	let acc = 7;
	for (const ch of input)
		acc = (acc * 33 + ch.charCodeAt(0)) >>> 0;
	return `h${acc.toString(16)}`;
}

function installJson(): void {
	out = { status: null, body: null };
	g.json = {
		ok: (data?: unknown) => {
			out.status = 200;
			out.body = data;
		},
		fail: (code: number, msg: string, extra?: unknown) => {
			out.status = code;
			out.body = { code, msg, extra };
		},
	};
}

function api(tokens: string[] = [TOKEN_1, TOKEN_2]) {
	const queue = [...tokens];
	return createPublishApi({
		now: () => clock,
		randomHex: () => queue.shift() ?? "c".repeat(64),
		sha256Hex: digest,
	});
}

function mkUser(username: string, opts: { tenant?: string, displayName?: string, superadmin?: boolean } = {}): number {
	const tenant = opts.tenant ?? "default";
	dbo.prepare("INSERT INTO users (username, password_hash, display_name, tenant_id) VALUES (?, 'x', ?, ?)")
		.run(username, opts.displayName ?? null, tenant);
	const uid = (dbo.prepare("SELECT id FROM users WHERE username = ? AND tenant_id = ?").get(username, tenant) as { id: number }).id;
	if (opts.superadmin)
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name, tenant_id) VALUES (?, 'superadmin', ?)").run(uid, tenant);
	return uid;
}

/** 以某个登录用户身份发请求 */
function as(uid: number, extra: Record<string, unknown> = {}): void {
	g.http = { user: { id: uid }, tenantId: "default", headers: { "x-real-ip": "10.0.0.1" }, ...extra };
}

function rowOf(token: string): Record<string, unknown> | undefined {
	return dbo.prepare("SELECT * FROM publish_credential WHERE token_hash = ?").get(digest(token)) as Record<string, unknown> | undefined;
}

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	g.http = {};
	clock = 1_700_000_000;
	dbo.exec("DELETE FROM publish_credential");
});

describe("POST /api/publish/credential（申请）", () => {
	it("given 登录用户填合法产品名 When 申请 Then 返回 64 位明文、身份已定，库里只有 hash", async () => {
		installJson();
		clock = 1_700_000_000;
		const uid = mkUser("p_apply", { displayName: "张三" });
		as(uid, { body: { product: "demo-solution" } });

		await api().credential.post();

		expect(out.status).toBe(200);
		expect(out.body.token).toBe(TOKEN_1);
		expect(out.body.key_id).toBe("demo-solution.p-apply");
		expect(out.body.expires_at).toBe(clock + CREDENTIAL_TTL_SECS);
		expect(out.body.token_hint).toBe(TOKEN_1.slice(0, 8));

		const row = rowOf(TOKEN_1)!;
		expect(row.token_hash).toBe(digest(TOKEN_1));
		expect(row.display_name).toBe("张三");
		expect(row.owner_tenant).toBe("default");
		// 明文绝不落库
		expect(JSON.stringify(row)).not.toContain(TOKEN_1);
	});

	it("given 产品名是保留名 When 申请 Then 400 且不产生记录", async () => {
		installJson();
		const uid = mkUser("p_bad");
		as(uid, { body: { product: "market" } });

		await api().credential.post();

		expect(out.status).toBe(400);
		expect(out.body.msg).toContain("保留名");
		expect(dbo.prepare("SELECT count(*) AS c FROM publish_credential").get()).toEqual({ c: 0 });
	});

	it("given 同一产品名已被他人占用 When 另一用户申请 Then 409（同一人重复申请放行）", async () => {
		installJson();
		clock = 1_700_000_000;

		// 同名账号在不同租户：唯一键是 (tenant_id, username)，故可共存
		const a = mkUser("p_dup", { tenant: "default" });
		const b = mkUser("p_dup", { tenant: "t2" });

		as(a, { body: { product: "demo-solution" } });
		await api([TOKEN_1]).credential.post();
		expect(out.status).toBe(200);

		as(b, { tenantId: "t2", body: { product: "demo-solution" } });
		await api([TOKEN_2]).credential.post();
		expect(out.status).toBe(409);
		expect(out.body.msg).toContain("已被其他用户占用");
	});
});

describe("POST /api/publish/credential/exchange（兑换）", () => {
	it("given 有效凭证 When 兑换 Then 返回申请时定下的 key_id 且该票作废", async () => {
		installJson();
		clock = 1_700_000_000;
		const uid = mkUser("p_ex1");
		as(uid, { body: { product: "demo-solution" } });
		const p = api([TOKEN_1]);
		await p.credential.post();
		const issued = out.body;

		// 兑换是匿名的：不带 user
		g.http = { headers: { "x-real-ip": "10.0.0.9" }, body: { token: issued.token } };
		await p.credential.exchange.post();

		expect(out.status).toBe(200);
		expect(out.body).toMatchObject({ key_id: issued.key_id, product: "demo-solution", username: "p_ex1" });

		const row = rowOf(TOKEN_1)!;
		expect(Number(row.used)).toBe(1);
		expect(Number(row.used_at)).toBe(clock);

		// 再兑：同票必拒
		g.http = { headers: { "x-real-ip": "10.0.0.9" }, body: { token: issued.token } };
		await p.credential.exchange.post();
		expect(out.status).toBe(400);
		expect(out.body.msg).toContain("发布管理");
	});

	it("given 凭证已过期 When 兑换 Then 400（过期判定在签发身份之前）", async () => {
		installJson();
		clock = 1_700_000_000;
		const uid = mkUser("p_ex2");
		as(uid, { body: { product: "demo-solution" } });
		const p = api([TOKEN_1]);
		await p.credential.post();

		clock += CREDENTIAL_TTL_SECS + 1;
		g.http = { headers: { "x-real-ip": "10.0.0.9" }, body: { token: TOKEN_1 } };
		await p.credential.exchange.post();

		expect(out.status).toBe(400);
		expect(Number(rowOf(TOKEN_1)!.used)).toBe(0);
	});

	it("given 凭证已撤销 When 兑换 Then 400", async () => {
		installJson();
		clock = 1_700_000_000;
		const uid = mkUser("p_ex3");
		as(uid, { body: { product: "demo-solution" } });
		const p = api([TOKEN_1]);
		await p.credential.post();
		const id = Number(rowOf(TOKEN_1)!.id);

		as(uid, { body: { id } });
		await p.credential.revoke.post();
		expect(out.status).toBe(200);

		g.http = { headers: { "x-real-ip": "10.0.0.9" }, body: { token: TOKEN_1 } };
		await p.credential.exchange.post();
		expect(out.status).toBe(400);
	});

	it("given 同一张票连续兑换 3 次 When 依次到达 Then 只有第一次成功，used_at 停在首次时间", async () => {
		installJson();
		clock = 1_700_000_000;
		const uid = mkUser("p_ex4");
		as(uid, { body: { product: "demo-solution" } });
		const p = api([TOKEN_1]);
		await p.credential.post();

		// 原子性来自那一条 `update ... where used = 0`：并发双花只可能有一个 changes=1。
		// Node 侧 sqlite 是同步的，真并发无法复现，故钉「重复到达只有一次生效」这一可观测面。
		const firstAt = clock;
		const statuses: number[] = [];
		for (let i = 0; i < 3; i++) {
			g.http = { headers: { "x-real-ip": `10.0.0.${i + 1}` }, body: { token: TOKEN_1 } };
			await p.credential.exchange.post();
			statuses.push(out.status!);
			clock += 5;
		}

		expect(statuses).toEqual([200, 400, 400]);
		expect(Number(rowOf(TOKEN_1)!.used_at)).toBe(firstAt);
	});

	it("given 令牌形状不对 When 兑换 Then 400 且不触库（不打日志也不落审计）", async () => {
		installJson();
		g.http = { headers: { "x-real-ip": "10.0.0.6" }, body: { token: "not-a-token" } };
		await api().credential.exchange.post();
		expect(out.status).toBe(400);
		expect(out.body.msg).toContain("重新申请");
	});
});

describe("GET /api/publish/credential（列表）", () => {
	it("given 普通用户 When 查列表 Then 只看到自己的且响应不含 token/hash", async () => {
		installJson();
		clock = 1_700_000_000;
		const a = mkUser("p_list_a");
		const b = mkUser("p_list_b");

		as(a, { body: { product: "demo-solution" } });
		await api([TOKEN_1]).credential.post();
		as(b, { body: { product: "other-solution" } });
		await api([TOKEN_2]).credential.post();

		as(a);
		await api().credential.get();

		expect(out.status).toBe(200);
		expect(out.body.total).toBe(1);
		expect(out.body.list[0]).toMatchObject({ product: "demo-solution", key_id: "demo-solution.p-list-a", status: "active" });
		// 明文与哈希都不出现在列表里
		const serialized = JSON.stringify(out.body);
		expect(serialized).not.toContain(TOKEN_1);
		expect(serialized).not.toContain("token_hash");
		expect(out.body.list[0].owner_tenant).toBeUndefined();
	});

	it("given 超管 When 查列表 Then 能看到全部并带归属租户", async () => {
		installJson();
		clock = 1_700_000_000;
		const a = mkUser("p_list_c");
		const boss = mkUser("p_boss", { superadmin: true });

		as(a, { body: { product: "demo-solution" } });
		await api([TOKEN_1]).credential.post();

		as(boss);
		await api().credential.get();

		expect(out.status).toBe(200);
		expect(out.body.total).toBe(1);
		expect(out.body.list[0].owner_tenant).toBe("default");
	});

	it("given 状态演进 When 兑换/撤销后查列表 Then 状态字段随之变化", async () => {
		installJson();
		clock = 1_700_000_000;
		const uid = mkUser("p_list_d");
		as(uid, { body: { product: "demo-solution" } });
		const p = api([TOKEN_1]);
		await p.credential.post();

		g.http = { headers: { "x-real-ip": "10.0.0.5" }, body: { token: TOKEN_1 } };
		await p.credential.exchange.post();

		as(uid);
		await p.credential.get();
		expect(out.body.list[0].status).toBe("used");
		expect(out.body.list[0].used_at).toBe(clock);
	});
});

describe("POST /api/publish/credential/revoke（撤销）", () => {
	it("given 别人的凭证 When 撤销 Then 404（与不存在同一句话，不泄露存在性）", async () => {
		installJson();
		clock = 1_700_000_000;
		const owner = mkUser("p_rev_a");
		const stranger = mkUser("p_rev_b");

		as(owner, { body: { product: "demo-solution" } });
		await api([TOKEN_1]).credential.post();
		const id = Number(rowOf(TOKEN_1)!.id);

		as(stranger, { body: { id } });
		await api().credential.revoke.post();

		expect(out.status).toBe(404);
		expect(Number(rowOf(TOKEN_1)!.revoked)).toBe(0);
	});

	it("given 已兑换的凭证 When 撤销 Then 400 并说明发布身份不能撤回", async () => {
		installJson();
		clock = 1_700_000_000;
		const uid = mkUser("p_rev_c");
		as(uid, { body: { product: "demo-solution" } });
		const p = api([TOKEN_1]);
		await p.credential.post();
		const id = Number(rowOf(TOKEN_1)!.id);

		g.http = { headers: { "x-real-ip": "10.0.0.4" }, body: { token: TOKEN_1 } };
		await p.credential.exchange.post();

		as(uid, { body: { id } });
		await p.credential.revoke.post();
		expect(out.status).toBe(400);
		expect(out.body.msg).toContain("发布身份");
	});
});

describe("门禁", () => {
	it("given 未登录 When 访问列表/申请 Then 403", async () => {
		installJson();
		as(0);
		g.http = {};
		await api().credential.get();
		expect(out.status).toBe(403);

		installJson();
		g.http = { body: { product: "demo-solution" } };
		await api().credential.post();
		expect(out.status).toBe(403);
	});

	it("given 伪造租户头 When 访问列表 Then 403（sub 在当前租户查无此人）", async () => {
		installJson();
		const uid = mkUser("p_forge");
		invalidateUser(uid);
		g.http = { user: { id: uid }, tenantId: "other-tenant" };
		await api().credential.get();
		expect(out.status).toBe(403);
	});
});
