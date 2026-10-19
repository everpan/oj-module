// BDD：卸载编排（P1-15a，R9/AC-P1-6 反向/D12/AC2-6/S1-1.2）。
// 端点（createMarketApi 的 uninstall-impact / uninstall）只做门禁 + 取参 + 调 runUninstall；
// 编排器负责四处同删（锁/sidecar/sys_solution_route/modules.json）+ 权限级联 uninstallSolution
// + 版本目录移除 + 审计 + 全用户失效 + market_history 留痕。本规格为验收锚点。
// 夹具：本仓范式（node:sqlite 真实迁移建表 + 真实 fs 面 g.fs）；market_history 表真源随市场
// 方案包（fixture.MARKET_HISTORY_DDL 同构建表），守卫语义（表不存在静默跳过）单列一例。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（market-api.spec 同约定） */
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import type { MarketEnv } from "../../src/_platform/market/api";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLock, writeLock } from "../../src/_platform/_lifecycle/lock";
import { createStateStore } from "../../src/_platform/_lifecycle/state";
import { catalogSpec, collectRetainedTables, tablePrefixPattern } from "../../src/_platform/_lifecycle/uninstall";
import { invalidateAllUsers } from "../../src/_platform/_shared/service/infra/access";
import { createMarketApi } from "../../src/_platform/market/api";
import { installDb, MARKET_HISTORY_DDL } from "../fixture";

const g = globalThis as any;

let root: string;
let sharedRoot: string;
let statePath: string;
let modulesJsonPath: string;
let dbo: any;
let last: { status: number, msg?: string, data?: unknown } | null = null;

function nodeFsFace(): FsFace {
	return {
		writeFile: (path, data) => fsp.writeFile(path, data),
		readFile: path => fsp.readFile(path),
		mkdir: (path, opts) => fsp.mkdir(path, opts),
		remove: (path, opts) => fsp.rm(path, opts),
		rename: (oldPath, newPath) => fsp.rename(oldPath, newPath),
		copyFile: (src, dest) => fsp.copyFile(src, dest),
		readdir: path => fsp.readdir(path),
	};
}

function makeEnv(overrides: Partial<MarketEnv> = {}): MarketEnv {
	return {
		sharedRoot,
		staging: join(sharedRoot, ".staging"),
		taskDir: join(sharedRoot, ".install-tasks"),
		statePath,
		dbPath: join(root, "db.sqlite"),
		siteModulesDir: join(root, "dist", "modules"),
		modulesJsonPath,
		apiPrefix: "/api/demo-solution",
		...overrides,
	};
}

/** 预置「已装」形态：锁（含 other 以避开空锁拒启）+ sidecar + 版本目录 + modules.json + route + 角色/用户绑定 + market_history 表 */
async function seedInstalled(opts: { withOther?: boolean } = {}): Promise<void> {
	const withOther = opts.withOther !== false;
	const lock: Record<string, string> = { "demo-solution": "0.1.0" };
	if (withOther)
		lock.other = "1.0.0";
	await writeLock(join(sharedRoot, "manifests.yaml"), lock);
	const state = await createStateStore(statePath);
	await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1 } } });
	await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
	await fsp.writeFile(modulesJsonPath, JSON.stringify([
		{ name: "demo-solution", enabled: true, src: "modules/demo-solution/" },
		...(withOther ? [{ name: "other", enabled: true, src: "modules/other/" }] : []),
	]));
	dbo.exec(MARKET_HISTORY_DDL);
	dbo.prepare("INSERT INTO sys_solution_route (path, module, category) VALUES (?, ?, ?)").run("/demo-solution", "demo-solution", "main");
	dbo.prepare("INSERT INTO sys_role (name, module, title, builtin) VALUES (?, ?, ?, 0)").run("demo-solution.admin", "demo-solution", "管理员");
	dbo.prepare("INSERT INTO sys_role (name, module, title, builtin) VALUES (?, ?, ?, 0)").run("demo-solution.viewer", "demo-solution", "访客");
	dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "demo-solution.admin");
	dbo.prepare("INSERT INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(2, "demo-solution.viewer");
}

/** 在 seedInstalled 之上：manifest.tables 声明业务表 + 实际建表（Q4 须保留、不删） */
async function seedInstalledWithTables(opts: { withOther?: boolean } = {}): Promise<void> {
	await seedInstalled(opts);
	await fsp.writeFile(
		join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"),
		"name: demo-solution\nversion: 0.1.0\ntables:\n  - demo_solution_notes\n  - demo_solution_tags\n",
	);
	dbo.exec("CREATE TABLE demo_solution_notes (id INTEGER PRIMARY KEY, body TEXT)");
	dbo.exec("CREATE TABLE demo_solution_tags (id INTEGER PRIMARY KEY, name TEXT)");
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-uninstall-"));
	sharedRoot = join(root, "modules");
	statePath = join(sharedRoot, ".solutions", "state.yaml");
	modulesJsonPath = join(root, "dist", "modules.json");
	await fsp.mkdir(sharedRoot, { recursive: true });
	await fsp.mkdir(dirname(modulesJsonPath), { recursive: true });
	g.fs = nodeFsFace();
	dbo = installDb();
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
	g.json = {
		ok: (data: unknown) => {
			last = { status: 200, data };
		},
		fail: (status: number, msg: string) => {
			last = { status, msg };
		},
	};
	last = null;
});

afterEach(async () => {
	g.fs = undefined;
	g.http = undefined;
	g.json = undefined;
	g.db = undefined;
	invalidateAllUsers();
	await fsp.rm(root, { recursive: true, force: true });
});

describe("GET uninstall-impact 影响面预检（superadmin，R9）", () => {
	it("返回受影响角色数与用户数（供前端二次确认）", async () => {
		await seedInstalled();
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { name: "demo-solution" } };
		await api["uninstall-impact"].get();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ name: "demo-solution", affectedRoles: 2, affectedUsers: 2 });
	});

	it("未安装方案也返回 0/0（不报错）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { name: "nope" } };
		await api["uninstall-impact"].get();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ name: "nope", affectedRoles: 0, affectedUsers: 0 });
	});
});

describe("POST uninstall 卸载编排（superadmin，R9）", () => {
	it("四处同删 + 权限级联 + 版本目录移除 + 历史留痕，返回 ok:true", async () => {
		await seedInstalled();
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution" } };
		await api.uninstall.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: true });
		// ① 锁摘除（other 条目保留——空锁拒启防线未被波及）
		expect(await readLock(join(sharedRoot, "manifests.yaml"))).toEqual({ other: "1.0.0" });
		// ② sidecar 删条目
		const state = await createStateStore(statePath);
		expect(state.read().solutions["demo-solution"]).toBeUndefined();
		// ③ sys_solution_route 删
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sys_solution_route WHERE module = ?").get("demo-solution").c)).toBe(0);
		// ④ modules.json 删条目（other 保留）
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8")) as Array<{ name: string }>;
		expect(list.find(e => e.name === "demo-solution")).toBeUndefined();
		expect(list.find(e => e.name === "other")).toBeDefined();
		// 权限唯一减法出口：双维度级联（角色 + 用户绑定 + 权限点）
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sys_role WHERE module = ?").get("demo-solution").c)).toBe(0);
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sys_user_role WHERE role_name = ?").get("demo-solution.admin").c)).toBe(0);
		// 版本目录移除（缺失即抛，断言 reject）
		await expect(fsp.readdir(join(sharedRoot, "demo-solution-0.1.0"))).rejects.toBeTruthy();
		// 历史留痕（第一方市场应用自身留痕；operator 反查 users 表）
		const hist = dbo.prepare("SELECT * FROM market_history WHERE solution = ? AND action = ?").all("demo-solution", "uninstall");
		expect(hist).toHaveLength(1);
		expect(String(hist[0].status)).toBe("success");
		expect(String(hist[0].operator)).toBe("admin");
	});

	it("未安装方案 → 404 资源缺失语义（P3-11：非 200 {ok:false}），人话在 message", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "nope" } };
		await api.uninstall.post();
		expect(last?.status).toBe(404);
		expect(String(last?.msg)).toContain("未安装");
		// 资源缺失：锁/sidecar/目录零改动（404 即什么都没发生）
		expect(await readLock(join(sharedRoot, "manifests.yaml"))).toEqual({});
	});

	it("卸载最后一个模块 → ok:false（空锁拒启 S1-1.2），锁保持不变", async () => {
		await seedInstalled({ withOther: false });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution" } };
		await api.uninstall.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: false });
		expect(await readLock(join(sharedRoot, "manifests.yaml"))).toEqual({ "demo-solution": "0.1.0" });
	});

	it("market_history 表不存在（站点未装市场方案）→ 卸载仍 ok:true（守卫式留痕静默跳过，缺口 A）", async () => {
		await seedInstalled();
		dbo.exec("DROP TABLE market_history");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution" } };
		await api.uninstall.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: true });
	});
});

describe("P3-3 卸载级联单一事务（fail-closed：中段失败整段回滚、锁不摘、无半残）", () => {
	it("权限级联中段失败 → 事务回滚（route/角色/权限零残）、锁/sidecar/modules/版本目录原样保留", async () => {
		await seedInstalled();
		// 注入：db.tx 内命中「delete from sys_role where module」时抛错，模拟级联中段失败；自建 BEGIN/ROLLBACK 保证回滚
		const origTx = g.db.tx;
		g.db.tx = async (fn: (t: { exec: (sql: string, params?: unknown[]) => unknown, query: (sql: string, params?: unknown[]) => unknown }) => unknown) => {
			dbo.exec("BEGIN");
			const t = {
				query: (sql: string, params: unknown[] = []) => dbo.prepare(sql).all(...(params as never[])),
				exec: (sql: string, params: unknown[] = []) => {
					if (/delete from sys_role where module/.test(sql))
						throw new Error("injected cascade failure");
					return Number(dbo.prepare(sql).run(...(params as never[])).changes);
				},
			};
			try {
				const r = await fn(t);
				dbo.exec("COMMIT");
				return r;
			}
			catch (e) {
				dbo.exec("ROLLBACK");
				throw e;
			}
		};
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution" } };
		await api.uninstall.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: false });
		// 锁仍在（fail-closed：模块仍挂载，可重试或重装自愈）
		expect(await readLock(join(sharedRoot, "manifests.yaml"))).toEqual({ "demo-solution": "0.1.0", "other": "1.0.0" });
		// 事务回滚：route / 角色 / 用户绑定 零残（全部回退到卸载前）
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sys_solution_route WHERE module = ?").get("demo-solution").c)).toBe(1);
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sys_role WHERE module = ?").get("demo-solution").c)).toBe(2);
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sys_user_role WHERE role_name = ?").get("demo-solution.admin").c)).toBe(1);
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sys_user_role WHERE role_name = ?").get("demo-solution.viewer").c)).toBe(1);
		// 文件操作未触发（级联失败在锁摘除之前返回）：sidecar / modules.json / 版本目录 原样保留
		const state = await createStateStore(statePath);
		expect(state.read().solutions["demo-solution"]).toMatchObject({ version: "0.1.0" });
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8")) as Array<{ name: string }>;
		expect(list.find(e => e.name === "demo-solution")).toBeDefined();
		expect(list.find(e => e.name === "other")).toBeDefined();
		await fsp.access(join(sharedRoot, "demo-solution-0.1.0"));
		// 还原 tx（不影响后续用例）
		g.db.tx = origTx;
	});
});

describe("门禁（R9：卸载 superadmin 独占）", () => {
	it("非 superadmin 访问 uninstall / uninstall-impact → 403", async () => {
		await seedInstalled();
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 2 }, query: { name: "demo-solution" } };
		await api["uninstall-impact"].get();
		expect(last?.status).toBe(403);
		g.http = { user: { id: 2 }, body: { name: "demo-solution" } };
		await api.uninstall.post();
		expect(last?.status).toBe(403);
	});
});

describe("P3-4 业务表保留提示（Q4：不删业务数据，retained 回传 + 表仍在）", () => {
	it("卸载成功响应含 retained 非空，且业务表仍在（sqlite 直读）；代码/锁/路由已删", async () => {
		await seedInstalledWithTables();
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution" } };
		await api.uninstall.post();
		expect(last?.status).toBe(200);
		const data = last?.data as { ok: boolean, retained?: string[] };
		expect(data).toMatchObject({ ok: true });
		expect(Array.isArray(data.retained)).toBe(true);
		expect(data.retained).toContain("demo_solution_notes");
		expect(data.retained).toContain("demo_solution_tags");
		// Q4：业务表未 DROP（sqlite_master 直读仍在）
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name = ?").get("demo_solution_notes").c)).toBe(1);
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name = ?").get("demo_solution_tags").c)).toBe(1);
		// 既有纪律：锁摘除 + sidecar + route + modules 已删（other 保留）
		expect(await readLock(join(sharedRoot, "manifests.yaml"))).toEqual({ other: "1.0.0" });
		const state = await createStateStore(statePath);
		expect(state.read().solutions["demo-solution"]).toBeUndefined();
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sys_solution_route WHERE module = ?").get("demo-solution").c)).toBe(0);
	});

	it("manifest 缺失（api-only 方案）→ 前缀兜底仍能回传业务表", async () => {
		await seedInstalled();
		// 不写 manifest，但业务表名匹配模块前缀 demo_solution.*（兜底扫描命中）
		dbo.exec("CREATE TABLE demo_solution_orphan (id INTEGER)");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution" } };
		await api.uninstall.post();
		const data = last?.data as { ok: boolean, retained?: string[] };
		expect(data).toMatchObject({ ok: true });
		expect(data.retained).toContain("demo_solution_orphan");
		expect(Number(dbo.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name = ?").get("demo_solution_orphan").c)).toBe(1);
	});
});

describe("P4-1 多方言卸载矩阵（P3-4#2）：catalogSpec 三方言 SQL 形态 + 前缀转义方言无关", () => {
	it("catalogSpec 三方言 existing SQL 形态正确（sqlite=sqlite_master / mysql/pg=information_schema）", () => {
		const sqlite = catalogSpec("sqlite");
		const mysql = catalogSpec("mysql");
		const pg = catalogSpec("pg");
		expect(sqlite.existing).toBe("SELECT name FROM sqlite_master WHERE type='table'");
		expect(mysql.existing).toContain("information_schema.tables");
		expect(mysql.existing).toContain("DATABASE()");
		expect(pg.existing).toContain("information_schema.tables");
		expect(pg.existing).toContain("table_schema = 'public'");
	});

	it("catalogSpec.like 三方言均带 ESCAPE '!' + 正确 schema 表达式 + 参数化 pat", () => {
		const pat = "demo_solution_%";
		const sqlite = catalogSpec("sqlite").like(pat);
		const mysql = catalogSpec("mysql").like(pat);
		const pg = catalogSpec("pg").like(pat);
		// sqlite
		expect(sqlite[0]).toBe("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ESCAPE '!'");
		expect(sqlite[1]).toEqual([pat]);
		// mysql：information_schema + DATABASE() + ESCAPE + 参数化（值不拼字符串，SSRF/注入无关但口径统一）
		expect(mysql[0]).toContain("information_schema.tables");
		expect(mysql[0]).toContain("DATABASE()");
		expect(mysql[0]).toContain("ESCAPE '!'");
		expect(mysql[1]).toEqual([pat]);
		// pg：information_schema + 'public' + ESCAPE + 参数化
		expect(pg[0]).toContain("information_schema.tables");
		expect(pg[0]).toContain("table_schema = 'public'");
		expect(pg[0]).toContain("ESCAPE '!'");
		expect(pg[1]).toEqual([pat]);
	});

	it("tablePrefixPattern 转义 !%_ 且连字符→下划线作表前缀", () => {
		// 连字符→下划线后，该下划线亦被转义（!_）= 字面分隔符而非 LIKE 通配，避免前缀扫描越权命中
		expect(tablePrefixPattern("demo-solution")).toBe("demo!_solution_%");
		// 危险字符必须转义，避免 LIKE 通配语义被注入（防前缀扫描越权命中）
		expect(tablePrefixPattern("a!b%c_d")).toBe("a!!b!%c!_d_%");
	});
});

describe("P4-1 多方言卸载矩阵（续）：collectRetainedTables 经 db.dialect 走 mysql/pg 信息_schema 路径", () => {
	/** 注入指定方言的 db.query 桩：existing 返回全表清单、like 返回前缀命中，模拟 information_schema 行为 */
	function stubDialect(dialect: "mysql" | "pg", existingNames: string[], likeNames: string[]): void {
		const spec = catalogSpec(dialect);
		(g.db as { dialect: () => string, query: (sql: string, p?: unknown[]) => unknown }).dialect = () => dialect;
		(g.db as { query: (sql: string, p?: unknown[]) => unknown }).query = (sql: string) => {
			if (sql === spec.existing)
				return existingNames.map(name => ({ name }));
			if (sql.includes("AND table_name LIKE"))
				return likeNames.map(name => ({ name }));
			return [];
		};
	}

	it("mysql 方言：manifest 声明 + 前缀兜底扫描均经 information_schema，返回实际存在的业务表", async () => {
		await seedInstalledWithTables();
		stubDialect("mysql", ["demo_solution_notes", "demo_solution_tags", "demo_solution_orphan"], ["demo_solution_orphan"]);
		const retained = await collectRetainedTables("demo-solution", join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"));
		expect(retained).toContain("demo_solution_notes");
		expect(retained).toContain("demo_solution_tags");
		expect(retained).toContain("demo_solution_orphan");
	});

	it("pg 方言：'public' schema 表达式路径一致，返回业务表（与 mysql 口径相同）", async () => {
		await seedInstalledWithTables();
		stubDialect("pg", ["demo_solution_notes", "demo_solution_tags", "demo_solution_orphan"], ["demo_solution_orphan"]);
		const retained = await collectRetainedTables("demo-solution", join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"));
		expect(retained).toContain("demo_solution_notes");
		expect(retained).toContain("demo_solution_tags");
		expect(retained).toContain("demo_solution_orphan");
	});

	it("db.dialect 缺省回落 sqlite（不抛、不误导），与既有 sqlite 全量路径一致", async () => {
		await seedInstalledWithTables();
		// 还原为缺省（不提供 dialect 函数）→ currentDialect 回落 "sqlite"
		const spec = catalogSpec("sqlite");
		(g.db as { dialect?: () => string }).dialect = undefined;
		(g.db as { query: (sql: string, p?: unknown[]) => unknown }).query = (sql: string) => {
			if (sql === spec.existing)
				return [{ name: "demo_solution_notes" }, { name: "demo_solution_tags" }];
			if (sql.includes("AND name LIKE"))
				return [{ name: "demo_solution_notes" }];
			return [];
		};
		const retained = await collectRetainedTables("demo-solution", join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"));
		expect(retained).toContain("demo_solution_notes");
		expect(retained).toContain("demo_solution_tags");
	});
});
