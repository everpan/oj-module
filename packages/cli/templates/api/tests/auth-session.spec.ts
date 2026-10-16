// BDD：登录链——B1 登录顺序（D14 统一 401）、B2 首登改密（AC1-27）、B3 refresh 轮换/reuse 检测（AC1-13）、B4 JWT 仅 sub。
// deps 全注入（Node 侧 crypto 只读不可 stub，设计 §9.1）；fake bcrypt 以 `hashed:<pw>` 为口令哈希约定。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import type { SessionDeps } from "../src/auth/_shared/session";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertPermission } from "../src/_platform/_shared/service/access";
import { createSession } from "../src/auth/_shared/session";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

let clock: number;
let signedSubs: string[];
let randomSeq: string[];

function deps(): SessionDeps {
	return {
		randomHex: () => randomSeq.shift() ?? "rnd-fallback",
		sha256Hex: (s: string) => `h(${s})`,
		signAccess: (sub: string) => {
			signedSubs.push(sub);
			return `jwt(${sub})`;
		},
		accessTtlSecs: 900,
		refreshTtlSecs: 30 * 24 * 3600,
		bcryptHash: async (pw: string) => `hashed:${pw}`,
		bcryptVerify: async (pw: string, h: string) => h === `hashed:${pw}`,
		now: () => clock,
	};
}

/** 建用户；password_hash 走 fake bcrypt 约定。 */
function mkUser(username: string, opts: { pw?: string, forbidden?: boolean, mustChange?: boolean } = {}): number {
	dbo.prepare("INSERT INTO users (username, password_hash, is_forbidden, must_change) VALUES (?, ?, ?, ?)")
		.run(username, `hashed:${opts.pw ?? "pw"}`, opts.forbidden ? 1 : 0, opts.mustChange ? 1 : 0);
	return (dbo.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number }).id;
}

function refreshRow(token: string) {
	return dbo.prepare("SELECT * FROM sys_refresh_token WHERE token_hash = ?").get(`h(${token})`) as Record<string, unknown> | undefined;
}

beforeAll(() => {
	dbo = installDb();
	clock = 0;
	signedSubs = [];
	randomSeq = [];
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM sys_refresh_token");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM users WHERE username LIKE 's%'");
});

describe("B1/D14：本地登录顺序与统一 401", () => {
	it("口令正确未禁用 → 签发 + profile roles 来自 sys_user_role JOIN", async () => {
		const uid = mkUser("s_alice", { pw: "secret1" });
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'editor')").run(uid);
		const s = createSession(deps());
		const r = await s.localLogin("s_alice", "secret1");
		expect(r.access_token).toBe(`jwt(${uid})`);
		expect(r.user.roles).toEqual(["editor"]);
		expect(r.restricted).toBe(false);
	});

	it("错误口令 → 401 invalid credentials", async () => {
		mkUser("s_bob", { pw: "secret1" });
		await expect(createSession(deps()).localLogin("s_bob", "wrong"))
			.rejects
			.toMatchObject({ status: 401, message: "invalid credentials" });
	});

	it("号不存在 → 401 同文案（不泄露存在性）", async () => {
		await expect(createSession(deps()).localLogin("s_ghost", "x"))
			.rejects
			.toMatchObject({ status: 401, message: "invalid credentials" });
	});

	it("口令对但 is_forbidden=1 → 401 同文案（禁用状态不泄露，D14）", async () => {
		mkUser("s_carol", { pw: "secret1", forbidden: true });
		await expect(createSession(deps()).localLogin("s_carol", "secret1"))
			.rejects
			.toMatchObject({ status: 401, message: "invalid credentials" });
	});

	it("B4：signAccess 仅收到 sub（roles 不进 claims）", async () => {
		signedSubs = [];
		const uid = mkUser("s_dave", { pw: "secret1" });
		dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, 'admin')").run(uid);
		await createSession(deps()).localLogin("s_dave", "secret1");
		expect(signedSubs).toEqual([String(uid)]);
	});
});

describe("B2/AC1-27：must_change 首登改密闭环", () => {
	it("must_change=1 → 登录响应 restricted=true，判权出口 403 must_change", async () => {
		const uid = mkUser("s_eve", { pw: "oldpass", mustChange: true });
		const s = createSession(deps());
		const r = await s.localLogin("s_eve", "oldpass");
		expect(r.restricted).toBe(true);
		expect(r.user.must_change).toBe(true);
		g.http = { user: { id: uid } };
		await expect(assertPermission("wiki.page.edit")).rejects.toMatchObject({ status: 403, code: "must_change" });
	});

	it("旧口令错 → 401；新口令 <6 → 400", async () => {
		const uid = mkUser("s_frank", { pw: "oldpass", mustChange: true });
		const s = createSession(deps());
		await expect(s.changePassword(uid, "nope", "newpass1")).rejects.toMatchObject({ status: 401 });
		await expect(s.changePassword(uid, "oldpass", "123")).rejects.toMatchObject({ status: 400 });
	});

	it("改密成功：must_change 清 0、旧 refresh 全删、换发 unrestricted 正式 token", async () => {
		const uid = mkUser("s_gina", { pw: "oldpass", mustChange: true });
		const s = createSession(deps());
		randomSeq = ["rt-old"];
		await s.localLogin("s_gina", "oldpass");
		expect(refreshRow("rt-old")).toBeDefined();
		randomSeq = ["rt-new"];
		const r = await s.changePassword(uid, "oldpass", "newpass1");
		expect(refreshRow("rt-old")).toBeUndefined();
		expect(refreshRow("rt-new")).toBeDefined();
		expect(r.restricted).toBe(false);
		const after = dbo.prepare("SELECT must_change FROM users WHERE id = ?").get(uid) as { must_change: number };
		expect(Number(after.must_change)).toBe(0);
	});
});

describe("B3/AC1-13：refresh 轮换、reuse 检测、TTL", () => {
	it("轮换作旧：旧串 revoked=1，新串可用且 access/refresh 均更新", async () => {
		mkUser("s_hank", { pw: "secret1" });
		const s = createSession(deps());
		randomSeq = ["rt-1"];
		const t1 = await s.localLogin("s_hank", "secret1");
		randomSeq = ["rt-2"];
		clock = 1000;
		const t2 = await s.refresh(t1.refresh_token);
		expect(t2.refresh_token).toBe("rt-2");
		expect(t2.access_token).toBe(t1.access_token); // 同 sub，签名恒定（fake）
		expect(Number(refreshRow("rt-1")?.revoked)).toBe(1);
		expect(Number(refreshRow("rt-2")?.revoked)).toBe(0);
	});

	it("reuse 检测：已吊销串二次出现 → 全族吊销 + 审计 auth.refresh.reuse + 401", async () => {
		mkUser("s_ivy", { pw: "secret1" });
		const s = createSession(deps());
		randomSeq = ["rt-a"];
		const t1 = await s.localLogin("s_ivy", "secret1");
		randomSeq = ["rt-b"];
		await s.refresh(t1.refresh_token); // rt-a 作旧，rt-b 活跃
		randomSeq = ["rt-c"];
		await expect(s.refresh(t1.refresh_token)).rejects.toMatchObject({ status: 401 }); // 重放 rt-a
		// 全族吊销：rt-b 也被删
		expect(refreshRow("rt-b")).toBeUndefined();
		const audit = dbo.prepare("SELECT * FROM sys_oplog WHERE action = 'auth.refresh.reuse'").all();
		expect(audit.length).toBe(1);
	});

	it("过期串 → 401（now 推进过 expires_at）", async () => {
		mkUser("s_jack", { pw: "secret1" });
		clock = 0;
		const s = createSession(deps());
		randomSeq = ["rt-x"];
		const t1 = await s.localLogin("s_jack", "secret1");
		clock = 31 * 24 * 3600;
		await expect(s.refresh(t1.refresh_token)).rejects.toMatchObject({ status: 401 });
	});

	it("滑动窗口封顶：新 exp = min(旧 exp, now + 30d)", async () => {
		mkUser("s_kate", { pw: "secret1" });
		clock = 0;
		const s = createSession(deps());
		randomSeq = ["rt-p"];
		const t1 = await s.localLogin("s_kate", "secret1");
		clock = 10 * 24 * 3600; // 第 10 天刷新
		randomSeq = ["rt-q"];
		await s.refresh(t1.refresh_token);
		const cap = 30 * 24 * 3600; // 旧 exp（绝对 30d）
		expect(Number(refreshRow("rt-q")?.expires_at)).toBe(Math.min(cap, clock + 30 * 24 * 3600));
	});

	it("吊销联动：revokeAll 后旧串失效（禁用/改密级联的底层）", async () => {
		const uid = mkUser("s_leo", { pw: "secret1" });
		const s = createSession(deps());
		randomSeq = ["rt-m"];
		const t1 = await s.localLogin("s_leo", "secret1");
		await s.revokeAll(uid);
		await expect(s.refresh(t1.refresh_token)).rejects.toMatchObject({ status: 401 });
	});
});
