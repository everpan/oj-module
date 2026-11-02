// BDD：后端 C 期补口——操作日志查询（AC1-29/D13 admin 可查）、系统设置（PRD §4.3）、登录方式发现（C5/D2 匿名）。
/* eslint-disable test/prefer-lowercase-title -- AC 编号是验收锚点，保留大写 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { listLoginMethods, listSettings, updateSetting } from "../src/app/api/_platform/_shared/service/domain/settings";
import { recordOp } from "../src/app/api/_platform/_shared/service/infra/audit";
import { searchOplog } from "../src/app/api/_platform/_shared/service/infra/oplog";
import { installDb } from "./fixture";

let dbo: ReturnType<typeof installDb>;
const g = globalThis as any;

beforeAll(() => {
	dbo = installDb();
});

afterEach(() => {
	g.http = {};
	dbo.exec("DELETE FROM sys_oplog");
	dbo.exec("DELETE FROM sys_setting");
});

describe("AC1-29/D13：操作日志查询（admin 可查）", () => {
	// L2：searchOplog 的本职是「过滤维度 → whereIf 条件」的映射 + 分页复用（pagedFactory）；
	// 构造器执行（SQL 渲染 / 真过滤）在 oj 二进制内——vitest 无真 builder 载体（架构定论：
	// builder 纯 Rust 实现、无 JS 模块可导；SQL 断言走 oj test / oj exec，见 devkit
	// oj-test-guide.md）。这里用记录型假构造器断言条件发射；whereIf 的「假值/空数组跳过」
	// 按 api-manual §1153 契约建模（引擎语义的忠实复刻，非新逻辑）。
	function fakeTable() {
		const conds: Array<{ test: unknown, cond: any }> = [];
		// 分页同样只记录不执行：count 查询不该带 limit/offset，list 查询必须带上
		const paging: { limit: number | null, offset: number | null } = { limit: null, offset: null };
		const b: any = {
			whereIf: (test: unknown, cond: any) => {
				if (test !== undefined && test !== null && test !== false && !(Array.isArray(test) && test.length === 0))
					conds.push({ test, cond });
				return b;
			},
			select: () => b,
			orderBy: () => b,
			limit: (n: number) => {
				paging.limit = n;
				return b;
			},
			offset: (n: number) => {
				paging.offset = n;
				return b;
			},
			// 固定非零 total：保证 count/list 两条路径都构造（total=0 跳过 list 的行为
			// 由 query-utils.spec 的 pagedFactory 用例覆盖，这里只关心条件发射）
			all: async () => [{ c: 42 }],
		};
		return { b, conds, paging };
	}

	/** 以假构造器跑 searchOplog，回传 count/list 两次构造（[0]=count，[1]=list） */
	async function captureBuilt(filter: Parameters<typeof searchOplog>[0]) {
		const built: Array<ReturnType<typeof fakeTable>> = [];
		const prevDb = g.db;
		g.db = {
			table: () => {
				const t = fakeTable();
				built.push(t);
				return t.b;
			},
		};
		try {
			await searchOplog(filter);
		}
		finally {
			g.db = prevDb;
		}
		expect(built).toHaveLength(2); // count + list 各构造一次
		expect(built[1].conds).toEqual(built[0].conds); // mk 工厂：两组条件一致
		return built;
	}

	/** 回传 count 构造发射的条件 */
	async function captureConds(filter: Parameters<typeof searchOplog>[0]) {
		const built = await captureBuilt(filter);
		return built[0].conds;
	}

	it("无过滤/空串过滤 → 不发射任何条件（归一化空串 → whereIf 跳过，等价旧 if (filter.x)）", async () => {
		expect(await captureConds({})).toEqual([]);
		expect(await captureConds({ action: "", username: "", module: "" })).toEqual([]);
	});

	it("action/module 精确 + username 包含：三维度各发射一条，字段与 op 对应", async () => {
		const conds = await captureConds({ action: "user.create", module: "framework", username: "bo" });
		expect(conds).toEqual([
			{ test: "user.create", cond: { field: "action", op: "eq", value: "user.create" } },
			{ test: "framework", cond: { field: "module", op: "eq", value: "framework" } },
			{ test: "bo", cond: { field: "username", op: "contains", value: "bo" } },
		]);
	});

	it("403 拒绝类（auth.deny）可在日志中检索：按 action 精确命中，且从无 level 条件（读不过滤等级）", async () => {
		const conds = await captureConds({ action: "auth.deny" });
		expect(conds).toEqual([
			{ test: "auth.deny", cond: { field: "action", op: "eq", value: "auth.deny" } },
		]);
		expect(conds.some(c => (c.cond as { field?: string }).field === "level")).toBe(false);
	});

	it("page/limit 只作用在 list 查询：limit=size、offset=(page-1)*size，count 不带分页", async () => {
		const [count, list] = await captureBuilt({ action: "user.create", page: 3, limit: 10 });
		expect(count!.paging).toEqual({ limit: null, offset: null });
		expect(list!.paging).toEqual({ limit: 10, offset: 20 });
	});

	it("缺省/非法分页参数：第 1 页 20 条，size 静默钳 200", async () => {
		expect((await captureBuilt({}))[1]!.paging).toEqual({ limit: 20, offset: 0 });
		expect((await captureBuilt({ page: 0, limit: "abc" }))[1]!.paging).toEqual({ limit: 20, offset: 0 });
		expect((await captureBuilt({ page: 2, limit: 10_000 }))[1]!.paging).toEqual({ limit: 200, offset: 200 });
	});
});

// 真库分页语义：上面用假构造器只钉「参数怎么发」，这里钉「切片/总数/还剩多少」算得对——
// 页导航能否正确显示页数全靠 total，靠 truncated 提示「结果被截断」的旧交互已删除。
describe("AC1-29：操作日志分页（真库切片 + total）", () => {
	async function seedOplog(n: number) {
		for (let i = 1; i <= n; i++)
			await recordOp({ action: "test.page", module: "framework", target: `t${i}` });
	}

	it("按 id 倒序切页：total 是全量而不是本页条数", async () => {
		await seedOplog(5);
		const p1 = await searchOplog({ page: 1, limit: 2 });
		expect(p1.total).toBe(5);
		expect(p1.list.map(r => r.target)).toEqual(["t5", "t4"]);
		expect(p1.truncated).toBe(true);

		const p2 = await searchOplog({ page: 2, limit: 2 });
		expect(p2.list.map(r => r.target)).toEqual(["t3", "t2"]);
		expect(p2.truncated).toBe(true);

		// 末页：5 条 / 每页 2 → 第 3 页只剩 1 条，truncated=false（页导航据此停在第 3 页）
		const p3 = await searchOplog({ page: 3, limit: 2 });
		expect(p3.list.map(r => r.target)).toEqual(["t1"]);
		expect(p3.truncated).toBe(false);
	});

	it("越界页：list 为空但 total 仍为全量（前端据此纠正页码，而不是显示 0 条）", async () => {
		await seedOplog(3);
		const far = await searchOplog({ page: 99, limit: 20 });
		expect(far.list).toEqual([]);
		expect(far.total).toBe(3);
		expect(far.truncated).toBe(false);
	});

	it("过滤与分页叠加：total 按过滤后的集合算", async () => {
		await seedOplog(5);
		await recordOp({ action: "other.act", module: "framework", target: "x" });
		const r = await searchOplog({ action: "test.page", page: 1, limit: 2 });
		expect(r.total).toBe(5);
		expect(r.list).toHaveLength(2);
		expect(r.list.every(x => x.action === "test.page")).toBe(true);
	});
});

describe("PRD §4.3：系统设置", () => {
	it("按 group 返回设置项（secret 项掩码）", async () => {
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time) VALUES ('framework.site_title', 'framework', 'general', 'string', 'ACME', 0, 0)").run();
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time) VALUES ('market.cdn_url', 'market', 'security', 'string', 'https://cdn.example.com', 1, 0)").run();
		const groups = await listSettings();
		const general = groups.find(x => x.group === "general");
		expect(general?.items.find(i => i.key === "framework.site_title")?.value).toBe("ACME");
		const security = groups.find(x => x.group === "security");
		expect(security?.items.find(i => i.key === "market.cdn_url")?.value).toBe("***");
	});

	it("组标题回填（P2-15③）：group_label_key 落库行 → 组面收敛出 label_key", async () => {
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time, group_label_key) VALUES ('demo-solution.display.theme', 'demo-solution', 'display', 'string', 'auto', 0, 0, 'demo-solution:settings.group.display')").run();
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time, group_label_key) VALUES ('demo-solution.display.size', 'demo-solution', 'display', 'int', '20', 0, 0, 'demo-solution:settings.group.display')").run();
		const groups = await listSettings();
		const display = groups.find(x => x.group === "display");
		expect(display?.label_key).toBe("demo-solution:settings.group.display");
	});

	it("更新写值 + update_time + 审计（market 安全项须 superadmin 操作者）", async () => {
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time) VALUES ('framework.site_title', 'framework', 'general', 'string', 'ACME', 0, 0)").run();
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, secret, update_time) VALUES ('market.cdn_url', 'market', 'security', 'string', 'x', 1, 0)").run();
		await updateSetting(1, "framework.site_title", "NEW");
		expect(String((dbo.prepare("SELECT value FROM sys_setting WHERE key = 'framework.site_title'").get() as { value: string }).value)).toBe("NEW");
		expect(dbo.prepare("SELECT * FROM sys_oplog WHERE action = 'setting.update'").get()).toBeDefined();
		// 非 superadmin 操作 market 安全项 → 403
		await expect(updateSetting(1, "market.cdn_url", "https://evil.example.com")).rejects.toMatchObject({ status: 403 });
	});

	it("未知 key → 404", async () => {
		await expect(updateSetting(1, "ghost.key", "v")).rejects.toMatchObject({ status: 404 });
	});
});

describe("C5/D2：登录方式发现（匿名端点数据源）", () => {
	it("默认仅 local；LDAP/SSO 开关来自设置项", async () => {
		expect((await listLoginMethods()).methods).toEqual(["local"]);
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, update_time) VALUES ('ldap.enabled', 'ldap', 'login', 'bool', '1', 0)").run();
		expect((await listLoginMethods()).methods).toEqual(["local", "ldap"]);
	});
});
