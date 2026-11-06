// BDD：安装补偿清单（P0 §3.5）。锁后失败把站点恢复到「装前代」——旧代继续服务、任务 partial+可重试。
// 直接驱动 compensate()（不重跑整个状态机），配真实内存库夹具（installDb）+ 真实临时文件系统 +
// stub reload 面，覆盖：完整回滚、幂等、部分失败仍尽力回滚、匿名面不随失败放大（验收 4）。
//
// 资产回滚原语：removeAnonymousPaths（text-edit）/ revertLock（lock）/ removeModulesJsonEntry
// （deploy-web）/ revertRegistrations（uninstall，复用卸载事务）。各原语幂等（缺则 no-op），
// 故补偿可安全被重试端点反复调用。

import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteText } from "../../src/app/api/_platform/_lifecycle/atomic";
import { compensate } from "../../src/app/api/_platform/_lifecycle/compensate";
import { parseLock, writeLock } from "../../src/app/api/_platform/_lifecycle/lock";
import { appendAnonymousPaths, removeAnonymousPaths } from "../../src/app/api/_platform/_lifecycle/text-edit";
import { installDb } from "../fixture";

const g = globalThis as any;

const BASE_CONFIG = "mounts: []\nserver:\n  reload_api: true\nvars:\n  other: 1\nauth:\n  anonymous_paths:\n    - /auth/login\n    - /system/login-methods\n";

function nodeFsFace() {
	return {
		writeFile: (p: string, d: any) => fsp.writeFile(p, d),
		readFile: (p: string) => fsp.readFile(p),
		mkdir: (p: string, o: any) => fsp.mkdir(p, o),
		remove: (p: string, o: any) => fsp.rm(p, o),
		rename: (o: string, n: string) => fsp.rename(o, n),
		copyFile: (s: string, d: string) => fsp.copyFile(s, d),
		readdir: (p: string) => fsp.readdir(p),
	};
}

let root: string;
let configPath: string;
let previewPath: string;
let sharedRoot: string;
let lockPath: string;
let modulesJsonPath: string;
let dbo: any;
let reloadCalls: number;
let reloadThrow: boolean;

const LOCK_BEFORE: Record<string, string> = { existing: "1.0.0" };

/** 把站点摆成「demo-solution 已锁后落位」状态，返回本次新增的匿名路径（= 补偿的输入 deferredAnonymous） */
async function seedInstalled(anonPaths: string[]): Promise<string[]> {
	const added = appendAnonymousPaths(BASE_CONFIG, anonPaths);
	await atomicWriteText(configPath, added.content);
	await atomicWriteText(previewPath, added.content);
	// 锁：装前快照 + 本次模块条目
	await writeLock(lockPath, { ...LOCK_BEFORE, "demo-solution": "0.1.0" });
	// modules.json：含本次模块条目
	await atomicWriteText(modulesJsonPath, `${JSON.stringify([{ name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: true }], null, 2)}\n`);
	// DB：路由/角色/权限各一行为 demo-solution（registering 段已落位）
	await g.db.table("sys_solution_route").insert({ path: "/demo-solution", module: "demo-solution", category: "main" }).run();
	await g.db.table("sys_role").insert({ name: "demo-solution.admin", module: "demo-solution" }).run();
	await g.db.table("sys_permission").insert({ code: "demo-solution.view", module: "demo-solution" }).run();
	return added.added;
}

function countAnon(cfg: string): number {
	const lines = cfg.split("\n");
	const idx = lines.findIndex(l => /^\s*anonymous_paths\s*:/.test(l));
	if (idx === -1)
		return 0;
	let n = 0;
	for (let i = idx + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.trim() === "" || /^\s*#/.test(line))
			continue;
		if (!line.replace(/#.*$/, "").trim().startsWith("- "))
			break;
		n++;
	}
	return n;
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-compensate-"));
	configPath = join(root, "config.yaml");
	previewPath = join(root, ".ojm-preview.yaml");
	sharedRoot = join(root, "modules");
	lockPath = join(sharedRoot, "manifests.yaml");
	modulesJsonPath = join(root, "dist", "modules.json");
	await fsp.mkdir(sharedRoot, { recursive: true });
	await fsp.mkdir(join(root, "dist"), { recursive: true });
	g.fs = nodeFsFace();
	g.yaml = { parse: async (t: string) => JSON.parse(t) };
	g.http = {};
	dbo = installDb();
	reloadCalls = 0;
	reloadThrow = false;
});

afterEach(async () => {
	g.fs = undefined;
	g.http = undefined;
	g.db = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

function makeInput(deferredAnonymous: string[]): any {
	return {
		name: "demo-solution",
		version: "0.1.0",
		configPath,
		deferredAnonymous,
		sharedRoot,
		modulesJsonPath,
		lockBefore: LOCK_BEFORE,
		lockExisted: true,
		reload: {
			reloadConfig: async () => {
				reloadCalls++;
				if (reloadThrow)
					throw new Error("reload 模拟失败");
				return { generation: 2, unchanged: false, applied: ["vars"], restart_pending: [], kept_listener: [] };
			},
		},
	};
}

describe("compensate 完整回滚到装前代", () => {
	it("锁/config匿名/modules.json/DB 全部回退，旧代仍服务（reload 已调用）", async () => {
		const added = await seedInstalled(["demo-solution/ping", "demo-solution/health"]);
		const r = await compensate(makeInput(added));

		expect(r.allOk).toBe(true);
		expect(r.steps.map(s => s.step)).toEqual(["config.anonymous", "lock", "modules.json", "db.registrations", "reload"]);

		// 锁回到装前快照（无 demo-solution）
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual(LOCK_BEFORE);
		// config：新增匿名条目被精确移除，基线两条保留；seq 不被回滚（单调无害）
		const cfg = await fsp.readFile(configPath, "utf8");
		expect(cfg).toContain("- /auth/login");
		expect(cfg).toContain("- /system/login-methods");
		expect(cfg).not.toContain("demo-solution/ping");
		expect(cfg).not.toContain("demo-solution/health");
		expect(countAnon(cfg)).toBe(2);
		// preview 派生同样被清理
		const prev = await fsp.readFile(previewPath, "utf8");
		expect(prev).not.toContain("demo-solution/ping");
		// modules.json 无 demo-solution 条目
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8")) as unknown[];
		expect(list.some((e: any) => e.name === "demo-solution")).toBe(false);
		// DB 注册被级联清掉
		expect(dbo.prepare("SELECT * FROM sys_solution_route WHERE module='demo-solution'").all()).toHaveLength(0);
		expect(dbo.prepare("SELECT * FROM sys_role WHERE module='demo-solution'").all()).toHaveLength(0);
		expect(dbo.prepare("SELECT * FROM sys_permission WHERE module='demo-solution'").all()).toHaveLength(0);
		// reload 被调用一次（活动代回到装前态）
		expect(reloadCalls).toBe(1);
	});
});

describe("compensate 幂等（可重试）", () => {
	it("连续两次补偿：第二次全 no-op，终态不变，reload 仍各调用一次", async () => {
		const added = await seedInstalled(["demo-solution/ping"]);
		const first = await compensate(makeInput(added));
		const second = await compensate(makeInput(added));
		expect(first.allOk).toBe(true);
		expect(second.allOk).toBe(true);
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual(LOCK_BEFORE);
		expect(countAnon(await fsp.readFile(configPath, "utf8"))).toBe(2);
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8")) as unknown[];
		expect(list.some((e: any) => e.name === "demo-solution")).toBe(false);
		expect(dbo.prepare("SELECT * FROM sys_solution_route WHERE module='demo-solution'").all()).toHaveLength(0);
		expect(reloadCalls).toBe(2); // 两次各触发一次 reload（幂等但不跳过 reload）
	});
});

describe("compensate 部分失败仍尽力回滚", () => {
	it("reload 步抛错 → 该步标记失败、其余四步仍生效、allOk=false", async () => {
		const added = await seedInstalled(["demo-solution/ping"]);
		reloadThrow = true;
		const r = await compensate(makeInput(added));

		expect(r.allOk).toBe(false);
		const reloadStep = r.steps.find(s => s.step === "reload")!;
		expect(reloadStep.ok).toBe(false);
		// 其余步成功
		for (const s of r.steps.filter(s => s.step !== "reload")) {
			expect(s.ok).toBe(true);
		}
		// 即便 reload 失败，已落位资产仍被回退
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual(LOCK_BEFORE);
		expect(countAnon(await fsp.readFile(configPath, "utf8"))).toBe(2);
		expect(dbo.prepare("SELECT * FROM sys_solution_route WHERE module='demo-solution'").all()).toHaveLength(0);
	});
});

describe("compensate 匿名面不随失败放大（验收 4）", () => {
	it("同一方案连续两次失败安装：config 匿名条目数不增长", async () => {
		// 第一次失败：装前基线 2 条，新增 1 条后补偿
		const added = await seedInstalled(["demo-solution/ping"]);
		await compensate(makeInput(added));
		const afterFirst = await fsp.readFile(configPath, "utf8");
		expect(countAnon(afterFirst)).toBe(2); // 回到基线

		// 第二次失败：再次以同样 deferredAnonymous 补偿（模拟又失败一次）
		await compensate(makeInput(added));
		const afterSecond = await fsp.readFile(configPath, "utf8");
		expect(countAnon(afterSecond)).toBe(2); // 不增长
		expect(removeAnonymousPaths(afterSecond, added).removed).toEqual([]); // 已无残留可删
	});
});
