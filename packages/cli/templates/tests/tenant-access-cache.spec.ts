// BDD：判权快照缓存的租户边界（多租户 2026-10，`_platform/.../infra/access.ts`）。
//
// 攻击/故障形态：`access.ts` 的判权快照按 **uid 单键**缓存时，「A 企业的张三」判过权之后
// 同一个进程再处理「B 企业的张三」的请求——后者的 `users` 行按 B 租户查不到（构造器自动
// 注入 `tenant_id` 谓词），本应 403，但缓存里还留着 A 租户那张 `exists: true` 的快照，
// 于是**放行**。
//
// oj 目前每请求重建模块实例，缓存恒不命中，所以线上看不到；但只要有一次复用
// （常驻进程、或本工程自己的测试宿主）就是静默的跨租户放行——而这一层是伪造
// `X-TENANT-ID` 的**唯一**服务端拦截点，它一旦放行就没有第二道了。
// 这里把「同一 uid 换租户必须重查」钉死，顺手钉住写时失效不得漏掉别的租户。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { currentAccess, invalidateAllUsers, invalidateUser, isSelfTenant } from "../src/_platform/api/_shared/service/infra/access";
import { installDb } from "./fixture";

const g = globalThis as any;
let dbo: ReturnType<typeof installDb>;

/** 模拟一次请求的租户头（`X-TENANT-ID` → http.tenantId）与登录态 */
function as(tenant: string, uid?: number): void {
	g.http = tenant ? { tenantId: tenant, user: uid == null ? {} : { id: uid } } : { user: uid == null ? {} : { id: uid } };
}

/** 在指定租户里建一个用户（业务侧永不自己写 tenant_id，这里是造数据） */
function mkUser(tenant: string, username: string): number {
	dbo.prepare("INSERT INTO users (tenant_id, username, password_hash) VALUES (?, ?, 'x')").run(tenant, username);
	return (dbo.prepare("SELECT id FROM users WHERE username = ? AND tenant_id = ?").get(username, tenant) as { id: number }).id;
}

function bind(tenant: string, uid: number, role: string): void {
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (tenant_id, user_id, role_name) VALUES (?, ?, ?)").run(tenant, uid, role);
}

beforeAll(() => {
	dbo = installDb();
});

beforeEach(() => {
	invalidateAllUsers();
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM sys_role_permission");
	dbo.exec("DELETE FROM sys_user_role");
	dbo.exec("DELETE FROM users WHERE username LIKE 'tk_%'");
});

describe("判权快照按 (租户, uid) 缓存", () => {
	it("同一 uid 换到别家租户 → 查无此人（不吃上一家留下的快照）", async () => {
		const uid = mkUser("acme", "tk_zhangsan");
		as("acme", uid);
		expect(await isSelfTenant()).toBe(true);

		as("globex", uid);
		expect(await isSelfTenant()).toBe(false);
	});

	it("逆时针顺序同样成立（先访问别人家，回自己家不能被判没）", async () => {
		const uid = mkUser("acme", "tk_lisi");
		as("globex", uid);
		expect(await isSelfTenant()).toBe(false);

		as("acme", uid);
		expect(await isSelfTenant()).toBe(true);
	});

	it("两个租户各自的同 uid 快照互不覆盖：角色也不串台", async () => {
		const uid = mkUser("acme", "tk_wangwu");
		bind("acme", uid, "wiki.editor");
		bind("globex", uid, "crm.viewer");

		as("acme", uid);
		expect((await currentAccess()).roles).toEqual(["wiki.editor"]);
		as("globex", uid);
		expect(await isSelfTenant()).toBe(false);
	});
});

describe("写时失效覆盖该 uid 的全部租户快照", () => {
	it("在别家上下文里 invalidateUser，回原租户也必须重查", async () => {
		const uid = mkUser("acme", "tk_zhaoliu");
		as("acme", uid);
		expect((await currentAccess()).roles).toEqual([]);

		// 直接改库（模拟别处写路径），此 uid 在 acme 的旧快照此刻已过期
		bind("acme", uid, "wiki.editor");
		as("acme", uid);
		expect((await currentAccess()).roles, "未失效前读到旧快照（TTL 内缓存命中，符合预期）").toEqual([]);

		// 失效发生在**别家**的上下文里 —— 不得只清当前租户那一张
		as("globex", uid);
		invalidateUser(uid);

		as("acme", uid);
		expect((await currentAccess()).roles).toEqual(["wiki.editor"]);
	});
});
