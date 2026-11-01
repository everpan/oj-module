// BDD：B2 全量同步（方案 §6.2 / D9 / D13）——分片推进、错码处置、墓碑回收、归属权。
//
// 分片是这套设计的核心约束（isolate 无定时器 + 路由超时），所以用例必须钉死：
//   · 一片处理不完就**停**（status 仍 running、游标前进、下次接着推），不是重跑也不是失败；
//   · 权限类错码是「跳过并计数」——一旦有跳过就**不许回收**（否则一次上游抖会被读成「部门被删」）；
//   · 限流/可恢复致命错要停在原部门（游标不前进），下一次重试同一部门；
//   · 本地建的部门/成员一根毛都不碰（D13 归属权）。
import type { WecomClient, WecomMember } from "../src/auth/api/_shared/wecom/client";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WecomApiError } from "../src/auth/api/_shared/wecom/client";
import { cancelSync, startSync, syncStatus } from "../src/auth/api/_shared/wecom/sync";
import { installDb } from "./fixture";

/* eslint-disable test/prefer-lowercase-title -- D/AC 编号是验收锚点，保留大写 */

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

const TENANT = "ww_corp_a";
const AGENT = "100001";
const CTX = { corpId: TENANT, agentId: AGENT, secret: "perm_a", authMode: 0 };

interface Dept { id: string, parentId: string, name: string | null, order: number }

function member(userid: string, name: string, departments: string[], opts: Partial<WecomMember> = {}): WecomMember {
	return {
		userid,
		name,
		departments,
		orders: departments.map(() => 0),
		leaderInDept: departments.map(() => 0),
		mainDepartment: null,
		position: null,
		status: 1,
		...opts,
	};
}

/**
 * 假客户端：部门清单 + 「部门 → 成员」映射；值为 Error 表示该部门拉人失败（用来喂错码）。
 * `calls` 记录每个被拉的部门，重试语义靠它断言。
 */
function fakeClient(depts: Dept[], members: Record<string, WecomMember[] | Error>) {
	const calls: string[] = [];
	const client = {
		async departmentChildren() {
			return depts;
		},
		async departmentList() {
			return depts;
		},
		async deptMembersDetail(_c: string, _a: string, _s: string, originId: string) {
			calls.push(originId);
			const hit = members[originId];
			if (hit instanceof Error)
				throw hit;
			return hit ?? [];
		},
	} as unknown as WecomClient;
	return { client, calls };
}

const deps = (client: WecomClient, budgetMs = 10_000) => ({ client, now: () => Date.now(), budgetMs });

function deptRow(originId: string): { id: number, parent_id: number | null, name: string | null, sync_visible: number } | null {
	const row = dbo.prepare("SELECT id, parent_id, name, sync_visible FROM sys_department WHERE origin = 'wecom' AND origin_id = ?").get(originId) as any;
	return row ? { id: Number(row.id), parent_id: row.parent_id == null ? null : Number(row.parent_id), name: row.name, sync_visible: Number(row.sync_visible) } : null;
}

function uidOf(userid: string): number | null {
	const row = dbo.prepare("SELECT id FROM users WHERE username = ?").get(`wecom:${userid}`) as { id: number } | undefined;
	return row ? Number(row.id) : null;
}

beforeAll(() => {
	dbo = installDb();
	// 引擎里用到 crypto.* 的地方没有；但 log 是全局的，替身避免噪音
	g.log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
});

beforeEach(() => {
	g.http = { tenantId: TENANT, user: { id: 1 } };
});

afterEach(() => {
	g.http = {};
	for (const t of ["wecom_sync_job", "wecom_sync_lock", "sys_dept_member", "sys_department", "users", "sys_oplog"])
		dbo.exec(`DELETE FROM ${t}`);
});

const TREE: Dept[] = [
	{ id: "1", parentId: "", name: "总公司", order: 1 },
	{ id: "2", parentId: "1", name: "研发部", order: 2 },
	// 孤儿：父部门不在可见范围 → 按方案挂根，不报错
	{ id: "3", parentId: "99", name: "外部协作组", order: 0 },
];

describe("B2-A：一轮完整同步", () => {
	it("部门按父子序落库 + 孤儿挂根 + 成员带职务/排序/负责人/主部门", async () => {
		const { client } = fakeClient(TREE, {
			1: [member("zhangsan", "张三", ["1", "2"], { orders: [5, 3], leaderInDept: [1, 0], mainDepartment: 2, position: "总监" })],
			2: [member("lisi", "李四", ["2"])],
			3: [],
		});

		const view = await startSync(CTX, deps(client));
		expect(view.status).toBe("done");
		expect(view.stats).toMatchObject({ departments: 3, members: 2, skipped: 0, reconciled: true });
		expect(view.progress).toEqual({ done: 3, total: 3 });

		const root = deptRow("1")!;
		const child = deptRow("2")!;
		expect(root.parent_id).toBeNull();
		expect(child.parent_id).toBe(root.id);
		expect(deptRow("3")!.parent_id).toBeNull();
		expect(deptRow("2")!.name).toBe("研发部");

		const zhang = uidOf("zhangsan")!;
		expect(dbo.prepare("SELECT display_name, position, external_status, activated, source FROM users WHERE id = ?").get(zhang))
			.toMatchObject({ display_name: "张三", position: "总监", external_status: 1, activated: 0, source: "wecom" });
		// 多部门：两行关联，order/leader 与 department[] 逐位对应，主部门唯一
		expect(dbo.prepare("SELECT dept_id, order_no, is_leader, is_main FROM sys_dept_member WHERE user_id = ? ORDER BY dept_id").all(zhang))
			.toEqual([
				{ dept_id: root.id, order_no: 5, is_leader: 1, is_main: 0 },
				{ dept_id: child.id, order_no: 3, is_leader: 0, is_main: 1 },
			]);
	});

	it("分片：预算用完就停（status 仍 running、游标前进），第二次接着推完", async () => {
		const { client, calls } = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		const first = await startSync(CTX, deps(client, 0));
		expect(first.status).toBe("running");
		expect(first.phase).toBe("members");
		expect(first.progress).toEqual({ done: 0, total: 3 });
		// 部门阶段已经完成，成员一个都没拉
		expect(calls).toEqual([]);
		expect(deptRow("1")).not.toBeNull();

		const second = await startSync(CTX, deps(client));
		expect(second.status).toBe("done");
		expect(calls.sort()).toEqual(["1", "2", "3"]);
	});
});

describe("B2-B：错码处置（跳过 / 停片 / 熔断）", () => {
	it("权限类（60011）跳过该部门并计数，且**不回收**（本轮不完整）", async () => {
		// 先跑一轮完整同步，让部门 3 有 seen 记录
		const r1 = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		await startSync(CTX, deps(r1.client));

		const { client } = fakeClient(TREE, {
			1: [],
			2: new WecomApiError("user/list", 60011, "no privilege"),
			3: [],
		});
		const view = await startSync(CTX, deps(client));
		expect(view.status).toBe("done");
		expect(view.stats).toMatchObject({ skipped: 1, reconciled: false });
		// 有跳过就不敢把「没见过的部门」判成删除
		expect(deptRow("2")!.sync_visible).toBe(1);
	});

	it("限流类（45009）停在原部门：游标不前进，下一次重试同一个部门", async () => {
		const rate = new WecomApiError("user/list", 45009, "rate limit");
		const { client, calls } = fakeClient(TREE, { 1: rate, 2: [], 3: [] });
		const first = await startSync(CTX, deps(client));
		expect(first.status).toBe("running");
		expect(first.progress.done).toBe(0);

		const ok = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		const second = await startSync(CTX, deps(ok.client));
		expect(second.status).toBe("done");
		// 第一个部门被重试（不是被跳过）
		expect(ok.calls[0]).toBe("1");
		expect(calls).toEqual(["1"]);
	});

	it("致命类（60020）连续 10 次 → job failed，且错误明细不含异常原文（脱敏）", async () => {
		const boom = new WecomApiError("user/list", 60020, "not allow to access from your ip: https://qyapi.weixin.qq.com?access_token=SECRET");
		const { client } = fakeClient(TREE, { 1: boom, 2: [], 3: [] });
		let view = await startSync(CTX, deps(client));
		for (let i = 0; i < 9; i++) {
			expect(view.status).toBe("running");
			view = await startSync(CTX, deps(client));
		}
		expect(view.status).toBe("failed");
		expect(view.errCode).toBe("60020");
		expect(view.errDetail).toMatchObject({ errcode: 60020, phase: "members", deptId: "1" });
		// 脱敏红线：明细里绝不能出现 access_token / 上游文案
		expect(JSON.stringify(view.errDetail)).not.toMatch(/SECRET|access_token/);
	});

	it("抢锁：同一企业同时只允许一个同步（租约未过期 → 409）", async () => {
		const { client } = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		dbo.prepare("INSERT INTO wecom_sync_lock (tenant_id, agent_id, owner, taken_at) VALUES (?, ?, 'other', ?)")
			.run(TENANT, AGENT, Math.floor(Date.now() / 1000));
		await expect(startSync(CTX, deps(client))).rejects.toMatchObject({ status: 409 });
	});

	it("过期租约可被抢占（请求崩溃不能把企业永久锁死）", async () => {
		const { client } = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		dbo.prepare("INSERT INTO wecom_sync_lock (tenant_id, agent_id, owner, taken_at) VALUES (?, ?, 'dead', ?)")
			.run(TENANT, AGENT, Math.floor(Date.now() / 1000) - 600);
		const view = await startSync(CTX, deps(client));
		expect(view.status).toBe("done");
		// 锁用完即释放
		expect(dbo.prepare("SELECT COUNT(*) c FROM wecom_sync_lock").get()).toMatchObject({ c: 0 });
	});
});

describe("B2-C：准入与取消", () => {
	it("成员授权模式（auth_mode=1）直接 400，不发起任何上游调用", async () => {
		const { client, calls } = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		await expect(startSync({ ...CTX, authMode: 1 }, deps(client))).rejects.toMatchObject({ status: 400 });
		expect(calls).toEqual([]);
		expect(dbo.prepare("SELECT COUNT(*) c FROM sys_department").get()).toMatchObject({ c: 0 });
	});

	it("取消：置 cancelled 并清游标；已写入的组织数据不回滚（重跑即覆盖）", async () => {
		const { client } = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		await startSync(CTX, deps(client, 0));
		const cancelled = await cancelSync(TENANT, AGENT, { now: () => Date.now() });
		expect(cancelled.status).toBe("cancelled");
		expect(cancelled.progress).toEqual({ done: 0, total: 0 });
		expect((await syncStatus(TENANT, AGENT)).status).toBe("cancelled");
		// 部门已落库（同步幂等，取消只清进度）
		expect(deptRow("1")).not.toBeNull();
	});
});

describe("B2-D：墓碑回收与归属权（D9/D13）", () => {
	it("第二轮看不到某部门 → 置为不可见；再次出现 → 自动恢复（markSeen 拉回 visible）", async () => {
		const full = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		await startSync(CTX, deps(full.client));

		const shrunk = fakeClient(TREE.slice(0, 1), { 1: [], 2: [], 3: [] });
		const v2 = await startSync(CTX, deps(shrunk.client));
		expect(v2.stats.reconciled).toBe(true);
		expect(deptRow("2")!.sync_visible).toBe(0);
		expect(deptRow("1")!.sync_visible).toBe(1);

		const back = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		await startSync(CTX, deps(back.client));
		expect(deptRow("2")!.sync_visible).toBe(1);
	});

	it("本地建的部门/成员不被同步碰（D13）：回收只作用于 origin=wecom", async () => {
		dbo.prepare("INSERT INTO sys_department (tenant_id, origin, origin_id, parent_id, name, order_no, sync_visible, deleted, update_time) VALUES (?, 'local', 'local:1', NULL, '手工建的部门', 0, 1, 0, 0)")
			.run(TENANT);
		const { client } = fakeClient(TREE, { 1: [], 2: [], 3: [] });
		await startSync(CTX, deps(client));
		const local = dbo.prepare("SELECT sync_visible, seen_job_id FROM sys_department WHERE origin = 'local'").get() as any;
		expect(Number(local.sync_visible)).toBe(1);
		expect(local.seen_job_id).toBeNull();
	});

	it("部门名缺失（未授权「部门名」）落 NULL，不编造假名字", async () => {
		const { client } = fakeClient([{ id: "1", parentId: "", name: null, order: 0 }], { 1: [] });
		await startSync(CTX, deps(client));
		expect(deptRow("1")!.name).toBeNull();
	});
});
