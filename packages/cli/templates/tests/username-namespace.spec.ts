// BDD：外来号命名空间抢占（B6 红线）在**改名路径**上的延伸。
//
// 背景：外部身份（ldap/sso/wecom）的本地用户名是 `ldap:<uid>` / `sso:<sub>` / `wecom:<userid>`
// 这种带前缀的形式，JIT 建档时按用户名反查——查到就复用，查不到才新建。于是「用户名」本身
// 就是外部身份的认领凭据。
//
// 攻击：我从本地建号起家（比如 `mario`），自助改名为 `wecom:boss`。此时企微侧那位
// `boss` 还没登录过，库里没有真行，于是我的行成了唯一的匹配者——他第一次扫码登录时
// `ensureWecomUser` 查到的就是**我的 uid**，服务端给真正的 boss 签发了我的会话，
// 我的角色、我的数据、我的操作日志，全部对他敞开。
//
// 建号侧早挡了这条红线（rbac-users.spec.ts「B6：建号加固」），但改名侧漏了——同一条红线
// 必须钉在所有写 `users.username` 的入口上，本文件就是把「漏了会怎样」钉死：
//   · 自助改名拒 `wecom:` 前缀（401/403 之后的第三道：不给你改）；
//   · 对照组：普通改名照旧放行（红线不能误伤正常用户）；
//   · 端到端：改名被拒之后，真正的外部成员 JIT 登录拿到的是**新建**的那一行。

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invalidateAllUsers } from "../src/_platform/api/_shared/service/infra/access";
import { ensureWecomUser, externalUsername } from "../src/auth/api/_shared/wecom/login";
import profile from "../src/personal-center/api/profile/api";
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

function usernameOf(uid: number): string {
	const row = dbo.prepare("SELECT username FROM users WHERE id = ?").get(uid) as { username: string } | undefined;
	return row ? String(row.username) : "";
}

beforeAll(() => {
	dbo = installDb();
});

beforeEach(() => {
	installJson();
	invalidateAllUsers();
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM users WHERE username LIKE 'u_%' OR username LIKE 'wecom:%' OR username LIKE 'mario%'");
});

describe("自助改名不得抢占外部身份命名空间", () => {
	it("改名为 wecom:boss → 400，且自己的用户名原样不动", async () => {
		const uid = mkUser("u_mario");
		g.http = { user: { id: uid }, body: { username: "wecom:boss" } };

		await profile.post();

		expect(out.status).toBe(400);
		expect(String(out.body.msg)).toMatch(/reserved/i);
		expect(usernameOf(uid)).toBe("u_mario");
	});

	it("三个前缀全覆盖（ldap:/sso:/wecom:），大小写不敏感", async () => {
		const uid = mkUser("u_every");
		for (const name of ["ldap:alice", "sso:bob", "wecom:carol", "WeCom:Dave"]) {
			g.http = { user: { id: uid }, body: { username: name } };
			await profile.post();
			expect(out.status, name).toBe(400);
		}
		expect(usernameOf(uid)).toBe("u_every");
	});

	it("对照组：普通改名照旧放行", async () => {
		const uid = mkUser("u_plain");
		g.http = { user: { id: uid }, body: { username: "u_renamed" } };

		await profile.post();

		expect(out.status).toBe(200);
		expect(usernameOf(uid)).toBe("u_renamed");
	});
});

describe("端到端：抢占不成，真正的外部成员拿到的是自己那一行", () => {
	it("wecom:boss 首次 JIT 登录 → 新建独立 uid，不是抢名者的 uid", async () => {
		const attackerUid = mkUser("u_squatter");
		g.http = { user: { id: attackerUid }, body: { username: externalUsername("boss") } };
		await profile.post();
		expect(out.status).toBe(400); // 抢占被拒是前提

		g.http = {};
		const { uid } = await ensureWecomUser("ww_corp", "boss");

		expect(uid).not.toBe(attackerUid);
		expect(usernameOf(uid)).toBe("wecom:boss");
		// 幂等：boss 再登一次仍是同一行
		expect((await ensureWecomUser("ww_corp", "boss")).uid).toBe(uid);
	});
});
