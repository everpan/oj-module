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
import { invalidateAllUsers } from "../../src/_platform/_shared/service/access";
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

	it("未安装方案 → ok:false 可读失败（不崩）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "nope" } };
		await api.uninstall.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: false });
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
