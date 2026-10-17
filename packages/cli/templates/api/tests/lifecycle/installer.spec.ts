// BDD：状态机编排 + 任务注册表（P1-10，D11/OCP/SRP）。
// 十阶段声明式状态机（STAGES 表）+ lockCommit 显式 stage（migrate 后，D11）+ 任务注册表
// （.install-tasks/<id>.json：保留 10 条、超时 running 判 failed、message 脱敏）。
// 失败语义三分（D11）：锁前（preflight..lock_commit）失败 → 清场重跑（零改锁零改库表）；
// 锁后（registering..smoke）失败 → status:"partial" + 回滚指引 key（lifecycle.stage.*，附录 A）；
// 切换前 verifyTarget() 复验（staging 产物完整性；sha256/seq 对齐分别在 verifying/migrating 段已复核）。
// reconcile() 入口对账自愈：锁 ↔ 账本 head（D11）——锁指新版账本落后 → 回指旧版（.bak + 旧目录俱在）
// 或摘除记 failed；启动/对账时点超时 running 判 failed（R13/B9/R31）。
// oj 原生扁平锁（D12）：`name: version` 字符串表，全量重写经 atomicWriteText（.bak 先备份，恢复用例），
// 写后读回校验重试收敛（S1-3：oj build load→save 窗口会吞并发外部写）。
// 任务互斥 .install-tasks/.lock（R17/R31）：mkdir EEXIST 等价 O_CREAT|O_EXCL，owner.json 时间戳
// 过期（30min）可接管。setEnabled 四处同写（D12/AC-P1-6）：锁摘除/恢复 + sidecar + route + modules。
// 步骤面全 stub 注入（DIP）：fetch/exec/tar/reload 不真跑；register/smoke/audit 走真实内存库夹具。
/* eslint-disable test/prefer-lowercase-title -- 任务/AC 编号是验收锚点，保留大写（register.spec 同约定） */
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import type { InstallRequest } from "../../src/_platform/_lifecycle/installer";
import type { StateStore } from "../../src/_platform/_lifecycle/state";
import type { ExecFace } from "../../src/_platform/_lifecycle/steps/extract";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteText } from "../../src/_platform/_lifecycle/atomic";
import { reconcile, runInstall, setEnabled, STAGES } from "../../src/_platform/_lifecycle/installer";
import { acquireTaskLock, commitLockEntry, parseLock, readLock, serializeLock, writeLock } from "../../src/_platform/_lifecycle/lock";
import { createStateStore } from "../../src/_platform/_lifecycle/state";
import { getTask, readTasks, redact, sweepTimedOut, writeTask } from "../../src/_platform/_lifecycle/tasks";
import { installDb } from "../fixture";

const g = globalThis as any;

const ARCHIVE = new TextEncoder().encode("demo-archive-bytes\n");
const SHA256 = createHash("sha256").update(ARCHIVE).digest("hex");
const ENTRY = new TextEncoder().encode("console.log(\"demo entry\");\n");
const CSS = new TextEncoder().encode(".demo{color:red}\n");
const sha384b64 = (d: Uint8Array) => createHash("sha384").update(d).digest("base64");
const MIGRATE_LINE = JSON.stringify({ results: [{ module: "demo-solution", ok: true, applied: [{ version: 3, name: "create_todos" }] }] });

/** 十阶段表（契约附录 A stage 名逐字：lock_commit 为 D11①扩展组，audit 恒末位） */
const STAGE_ORDER = ["preflight", "downloading", "verifying", "extracting", "migrating", "lock_commit", "registering", "deploying_web", "reloading", "smoke", "audit"];

let root: string;
let sharedRoot: string;
let staging: string;
let taskDir: string;
let siteModulesDir: string;
let modulesJsonPath: string;
let dataDir: string;
let dbPath: string;
let lockPath: string;
let state: StateStore;
let dbo: any;

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

function manifestFixture(version = "0.1.0"): any {
	return {
		name: "demo-solution",
		version,
		summary: "演示方案",
		peerRuntime: ">=0.1.0",
		archive: { file: `demo-solution-${version}.tgz`, sha256: SHA256, size: ARCHIVE.byteLength },
		api: { prefix: "/api/demo-solution", anonymous: ["demo-solution/ping"] },
		web: { entry: `modules/demo-solution/${version}/entry.js`, css: [`modules/demo-solution/${version}/main.css`] },
		routes: [
			{ path: "/demo-solution", category: "main", order: 200, title_key: "demo-solution:menu.main" },
			{ path: "/demo-solution/ping", category: "hidden", order: 205, title_key: "demo-solution:menu.ping" },
		],
		permissions: [{ code: "demo-solution.view", title_key: "demo-solution:perm.view" }],
		roles: [{ name: "demo-solution.admin", title_key: "demo-solution:role.admin", permissions: ["demo-solution.view"] }],
		settings: {
			groups: [{
				group: "display",
				label_key: "demo-solution:settings.group.display",
				items: [{ key: "demo-solution.display.theme", type: "enum", options: ["dark", "light"] }],
			}],
		},
	};
}

/** bundle exec stub：tar list 返回 verbose listing、tar extract 真写出产物树、oj migrate 返回 S1-6 合同 JSON */
function bundleExec(): ExecFace & { calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		run: async (argv) => {
			calls.push([...argv]);
			if (argv[0] === "tar" && argv[1] === "-tvzf") {
				const v = /demo-solution-([\w.-]+)\.tgz$/.exec(argv[2] ?? "")?.[1] ?? "0.1.0";
				return { code: 0, stdout: `manifest.yaml\nweb/modules/demo-solution/${v}/entry.js\nweb/modules/demo-solution/${v}/main.css\n`, stderr: "" };
			}
			if (argv[0] === "tar" && argv[1] === "-xzf") {
				const v = /demo-solution-([\w.-]+)\.tgz$/.exec(argv[2] ?? "")?.[1] ?? "0.1.0";
				const dest = argv[4]!;
				const dir = join(dest, "web", "modules", "demo-solution", v);
				await fsp.mkdir(dir, { recursive: true });
				await fsp.writeFile(join(dest, "manifest.yaml"), `name: demo-solution\nversion: ${v}\n`);
				await fsp.writeFile(join(dir, "entry.js"), ENTRY);
				await fsp.writeFile(join(dir, "main.css"), CSS);
				return { code: 0, stdout: "", stderr: "" };
			}
			if (argv[0] === "oj" && argv[1] === "migrate") {
				return { code: 0, stdout: `${MIGRATE_LINE}\n`, stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		},
	};
}

function makeReq(overrides: Partial<InstallRequest> = {}): InstallRequest {
	const version = overrides.version ?? "0.1.0";
	return {
		manifest: manifestFixture(version),
		name: "demo-solution",
		version,
		state,
		archiveUrl: `https://cdn.example.com/demo-solution-${version}.tgz?token=should-not-leak`,
		sharedRoot,
		staging,
		taskDir,
		dataDir,
		dbPath,
		siteModulesDir,
		modulesJsonPath,
		apiPrefix: "/api/demo-solution",
		fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer }),
		exec: bundleExec(),
		reload: { reloadConfig: async () => ({ generation: 1, unchanged: false, applied: ["mounts"], restart_pending: [], kept_listener: [] }) },
		sha256Hex: d => createHash("sha256").update(d).digest("hex"),
		sha384B64: sha384b64,
		hostVersions: { "@oj-module/runtime": "0.1.77" },
		ledgerHead: null,
		...overrides,
	};
}

function rows(sql: string): Record<string, unknown>[] {
	return dbo.prepare(sql).all() as Record<string, unknown>[];
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-installer-"));
	sharedRoot = join(root, "modules");
	staging = join(sharedRoot, ".staging");
	taskDir = join(sharedRoot, ".install-tasks");
	lockPath = join(sharedRoot, "manifests.yaml");
	siteModulesDir = join(root, "dist", "modules");
	modulesJsonPath = join(root, "dist", "modules.json");
	dataDir = root;
	dbPath = join(root, "db.sqlite");
	await fsp.writeFile(dbPath, new TextEncoder().encode("sqlite-header\n"));
	g.fs = nodeFsFace();
	g.http = {};
	dbo = installDb();
	state = await createStateStore(join(sharedRoot, ".solutions", "state.yaml"));
});

afterEach(async () => {
	g.fs = undefined;
	g.http = undefined;
	g.db = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

describe("STAGES 声明式状态机表", () => {
	it("十阶段表逐序：preflight..migrating → lock_commit（D11 migrate 后）→ registering..smoke → audit 恒末位", () => {
		expect(STAGES.map(s => s.name)).toEqual(STAGE_ORDER);
	});
});

describe("runInstall 全绿路径（步骤 stub，register/smoke/audit 走真实内存库）", () => {
	it("stage 顺序推进至 done；锁/版本目录/web 落位/sidecar/注册四表/终态审计/任务文件全就位", async () => {
		const t = await runInstall(makeReq());
		expect(t.status).toBe("done");
		expect(t.stage).toBe("done");
		expect(t.progress).toBe(100);
		expect(t.error).toBeUndefined();
		expect(t.stages.map(s => s.stage)).toEqual(STAGE_ORDER);
		expect(t.stages.every(s => s.ok)).toBe(true);

		// oj 原生扁平锁（D12）：name: version 字符串表，无嵌套无额外键
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual({ "demo-solution": "0.1.0" });
		// 版本目录就位（锁指向的目录先于锁落盘，S1-4 同序）
		await fsp.access(join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"));
		// web 产物落位 + modules.json 条目（R10 integrity 为包内容重算值）
		await fsp.access(join(siteModulesDir, "demo-solution", "0.1.0", "entry.js"));
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
		expect(list[0]).toMatchObject({
			name: "demo-solution",
			entry: "modules/demo-solution/0.1.0/entry.js",
			enabled: true,
			integrity: `sha384-${sha384b64(ENTRY)}`,
			peerRuntime: ">=0.1.0",
		});
		// sidecar（D12 元数据）：版本 + enabled + installedAt
		expect(state.read().solutions["demo-solution"]).toMatchObject({ version: "0.1.0", enabled: true });
		// 注册四表（D10 出口）+ 冒烟消费同一真源
		expect(rows("SELECT path FROM sys_solution_route WHERE module = 'demo-solution'")).toHaveLength(2);
		expect(rows("SELECT name FROM sys_role WHERE module = 'demo-solution'")).toHaveLength(1);
		// 迁移 applied max seq 入任务记录（对账 floor 依据）
		expect(t.appliedSeq).toBe(3);
		// 终态审计（AC-P1-14）：solution.install 落 oplog，detail 带 status/taskId
		const oplog = rows("SELECT action, detail FROM sys_oplog WHERE action = 'solution.install'");
		expect(oplog).toHaveLength(1);
		expect(String(oplog[0]!.detail)).toContain("\"status\":\"done\"");
		expect(String(oplog[0]!.detail)).toContain(t.id);
		// 任务文件落盘可查（800ms 轮询消费面）
		const saved = await getTask(taskDir, t.id);
		expect(saved?.status).toBe("done");
		expect(saved?.appliedSeq).toBe(3);
		expect(await getTask(taskDir, "nope")).toBeNull();
	});

	it("同版本重装幂等、不同版本目录共存（AC-P1-3）：两版本目录并存，锁指新版", async () => {
		const first = await runInstall(makeReq({ version: "0.1.0" }));
		expect(first.status).toBe("done");
		const again = await runInstall(makeReq({ version: "0.1.0" }));
		expect(again.status).toBe("done");
		const up = await runInstall(makeReq({ version: "0.2.0" }));
		expect(up.status).toBe("done");
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual({ "demo-solution": "0.2.0" });
		await fsp.access(join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml")); // 旧版本目录保留（回滚可用）
		await fsp.access(join(sharedRoot, "demo-solution-0.2.0", "manifest.yaml"));
	});
});

describe("失败语义①锁前清场（D11：零改锁零改库表，可重跑）", () => {
	it("extract 失败 → status failed + extracting 指引 key；staging 清场、锁/清单/sidecar/库表零改动", async () => {
		const exec: ExecFace = {
			run: async argv => (argv[1] === "-xzf" ? { code: 1, stdout: "", stderr: "tar: exiting with failure status" } : { code: 0, stdout: "manifest.yaml\n", stderr: "" }),
		};
		const t = await runInstall(makeReq({ exec }));
		expect(t.status).toBe("failed");
		expect(t.stage).toBe("extracting");
		expect(t.error?.hintKey).toBe("lifecycle.stage.extracting.hint");
		expect(t.error?.retryable).toBe(true);
		expect(t.stages.map(s => s.stage)).toEqual(["preflight", "downloading", "verifying", "extracting"]);
		// 清场：staging 删除（下载产物随 staging 一并清）
		await expect(fsp.access(staging)).rejects.toThrow();
		// 零改锁零落位
		await expect(fsp.access(lockPath)).rejects.toThrow();
		await expect(fsp.access(join(sharedRoot, "demo-solution-0.1.0"))).rejects.toThrow();
		await expect(fsp.access(modulesJsonPath)).rejects.toThrow();
		// 零改库表（注册未发生）零审计前置写
		expect(rows("SELECT path FROM sys_solution_route")).toHaveLength(0);
		expect(rows("SELECT * FROM sys_oplog")).toHaveLength(0);
		// sidecar 未写（failed 非 done/partial）
		expect(state.read().solutions).toEqual({});
		// 任务文件已落（可观测）
		expect((await getTask(taskDir, t.id))?.status).toBe("failed");
	});
});

describe("失败语义②锁后 partial（D11：部分生效 + 回滚指引）", () => {
	it("smoke 失败 → status partial + smoke 指引 key；锁/版本目录/sidecar 已生效，终态审计记 partial", async () => {
		const t = await runInstall(makeReq({ query: async () => null }));
		expect(t.status).toBe("partial");
		expect(t.stage).toBe("smoke");
		expect(t.error?.hintKey).toBe("lifecycle.stage.smoke.hint");
		expect(t.error?.retryable).toBe(false);
		// 锁与版本目录已生效（partial 语义：部分生效，不回滚已落位产物）
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual({ "demo-solution": "0.1.0" });
		await fsp.access(join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"));
		expect(state.read().solutions["demo-solution"]).toMatchObject({ version: "0.1.0", enabled: true });
		// 终态审计（含失败，AC-P1-14）：status=partial + failedStage
		const oplog = rows("SELECT detail FROM sys_oplog WHERE action = 'solution.install'");
		expect(oplog).toHaveLength(1);
		expect(String(oplog[0]!.detail)).toContain("\"status\":\"partial\"");
		expect(String(oplog[0]!.detail)).toContain("smoke");
	});
});

describe("reconcile 入口对账自愈（D11：锁 ↔ 账本 head）", () => {
	it("锁指新版但账本 head 落后 + .bak 与旧版本目录俱在 → 回指旧版（repoint）", async () => {
		await writeLock(lockPath, { "demo-solution": "0.2.0", "auth": "0.1.0" });
		await atomicWriteText(`${lockPath}.bak`, serializeLock({ "demo-solution": "0.1.0", "auth": "0.1.0" }));
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.2.0"), { recursive: true });
		const report = await reconcile({
			lockPath,
			sharedRoot,
			taskDir,
			ledgerHeadOf: async () => 3,
			headFloorOf: async (_n, v) => (v === "0.2.0" ? 5 : 3),
		});
		expect(report.healed).toEqual([{
			name: "demo-solution",
			action: "repoint",
			from: "0.2.0",
			to: "0.1.0",
			reason: expect.stringContaining("账本"),
		}]);
		expect(await readLock(lockPath)).toEqual({ "demo-solution": "0.1.0", "auth": "0.1.0" });
	});

	it("无旧版可指（.bak 缺失）→ 摘除条目 + 记 failed 任务（其余条目原样保留）", async () => {
		await writeLock(lockPath, { "demo-solution": "0.2.0", "auth": "0.1.0" });
		const report = await reconcile({
			lockPath,
			sharedRoot,
			taskDir,
			ledgerHeadOf: async () => 3,
			headFloorOf: async (_n, v) => (v === "0.2.0" ? 5 : 3),
		});
		expect(report.healed).toEqual([expect.objectContaining({ name: "demo-solution", action: "remove", to: null })]);
		expect(await readLock(lockPath)).toEqual({ auth: "0.1.0" });
		const failed = (await readTasks(taskDir)).filter(x => x.name === "demo-solution" && x.status === "failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]!.message).toContain("摘除");
	});

	it("账本一致 → 零自愈零改写（锁字节不变）；对账时点超时 running 判 failed（R13/B9/R31）", async () => {
		await writeLock(lockPath, { "demo-solution": "0.2.0" });
		const before = await fsp.readFile(lockPath, "utf8");
		const now = Date.now();
		await writeTask(taskDir, {
			id: "stale-running",
			name: "demo-solution",
			version: "0.2.0",
			status: "running",
			stage: "migrating",
			progress: 30,
			message: "执行中",
			stages: [],
			startedAt: now - 31 * 60_000,
		});
		const report = await reconcile({
			lockPath,
			sharedRoot,
			taskDir,
			ledgerHeadOf: async () => 5,
			headFloorOf: async () => 5,
			now,
		});
		expect(report.healed).toEqual([]);
		expect(await fsp.readFile(lockPath, "utf8")).toBe(before);
		const swept = await getTask(taskDir, "stale-running");
		expect(swept?.status).toBe("failed");
		expect(swept?.error?.reason).toContain("超时");
	});
});

describe(".install-tasks/.lock 任务互斥（R17/R31）", () => {
	it("并发取锁互斥：持锁期间第二取锁拒绝；释放后可再取", async () => {
		const l1 = await acquireTaskLock(taskDir);
		await expect(acquireTaskLock(taskDir)).rejects.toThrow(/busy|互斥/);
		await l1.release();
		const l2 = await acquireTaskLock(taskDir);
		await l2.release();
	});

	it("持有者崩溃后 owner 时间戳过期（>30min）→ 可接管（stale takeover）", async () => {
		const t0 = Date.now();
		const l1 = await acquireTaskLock(taskDir, { now: t0 });
		// 模拟持有者崩溃：时间戳停在 31 分钟前
		await fsp.writeFile(join(taskDir, ".lock", "owner.json"), JSON.stringify({ holder: "dead-process", acquiredAt: t0 - 31 * 60_000 }));
		const l2 = await acquireTaskLock(taskDir, { now: t0 });
		await l2.release();
		void l1;
	});

	it("runInstall 撞锁 → 返回 failed 任务（busy 可重试），互斥不悬挂", async () => {
		const l = await acquireTaskLock(taskDir);
		const t = await runInstall(makeReq());
		expect(t.status).toBe("failed");
		expect(t.error?.retryable).toBe(true);
		expect(t.message).toContain("busy");
		expect((await getTask(taskDir, t.id))?.status).toBe("failed");
		await l.release();
	});
});

describe("扁平锁写（D12）：.bak 备份 + 写后读回收敛（S1-3）", () => {
	it("改写前备份原锁至 .bak（恢复 = 回拷 .bak 内容，锁条目原样可解析）", async () => {
		await writeLock(lockPath, { auth: "0.1.0", demo: "0.1.0" });
		await writeLock(lockPath, { auth: "0.1.0", demo: "0.2.0" });
		expect(parseLock(await fsp.readFile(`${lockPath}.bak`, "utf8"))).toEqual({ auth: "0.1.0", demo: "0.1.0" });
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual({ auth: "0.1.0", demo: "0.2.0" });
	});

	it("写后被并发写者吞写（oj build load→save 窗口）→ 读回不符重试，最终收敛", async () => {
		const inner = nodeFsFace();
		let sabotaged = 0;
		g.fs = {
			...inner,
			rename: async (a: string, b: string) => {
				await inner.rename(a, b);
				if (b === lockPath && sabotaged === 0) {
					sabotaged++;
					await fsp.writeFile(lockPath, "auth: 0.1.0\n"); // 模拟 oj build 全量回写丢掉我们的条目
				}
			},
		};
		await writeLock(lockPath, { auth: "0.1.0" });
		const r = await commitLockEntry(lockPath, "demo-solution", "0.1.0");
		expect(r.ok).toBe(true);
		expect(sabotaged).toBe(1);
		expect(await readLock(lockPath)).toEqual({ "auth": "0.1.0", "demo-solution": "0.1.0" });
	});
});

describe("setEnabled 四处同写（D12/AC-P1-6）：锁摘除/恢复 + sidecar + route + modules", () => {
	async function seedEnabled(): Promise<void> {
		await writeLock(lockPath, { "demo-solution": "0.1.0", "auth": "0.1.0" });
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1000 } } });
		dbo.exec("INSERT INTO sys_solution_route (path, module, category, \"order\", deprecated, enabled) VALUES ('/demo-solution', 'demo-solution', 'main', 200, 0, 1)");
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		await fsp.writeFile(join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"), "name: demo-solution\nversion: 0.1.0\n");
		await atomicWriteText(modulesJsonPath, `${JSON.stringify([{ name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: true }], null, 2)}\n`);
	}

	it("禁用：锁摘除（他条目保留）+ sidecar enabled=false + route enabled=0 + modules enabled=false", async () => {
		await seedEnabled();
		const r = await setEnabled({ name: "demo-solution", enabled: false, sharedRoot, lockPath, state, modulesJsonPath });
		expect(r.ok).toBe(true);
		expect(await readLock(lockPath)).toEqual({ auth: "0.1.0" });
		expect(state.read().solutions["demo-solution"]).toMatchObject({ version: "0.1.0", enabled: false });
		expect(Number(rows("SELECT enabled FROM sys_solution_route WHERE module = 'demo-solution'")[0]!.enabled)).toBe(0);
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
		expect(list[0].enabled).toBe(false);
	});

	it("启用：从 sidecar 摘除前记录恢复锁版本，四处回写 enabled=true", async () => {
		await seedEnabled();
		await setEnabled({ name: "demo-solution", enabled: false, sharedRoot, lockPath, state, modulesJsonPath });
		const r = await setEnabled({ name: "demo-solution", enabled: true, sharedRoot, lockPath, state, modulesJsonPath });
		expect(r.ok).toBe(true);
		expect(await readLock(lockPath)).toEqual({ "demo-solution": "0.1.0", "auth": "0.1.0" });
		expect(state.read().solutions["demo-solution"]).toMatchObject({ version: "0.1.0", enabled: true });
		expect(Number(rows("SELECT enabled FROM sys_solution_route WHERE module = 'demo-solution'")[0]!.enabled)).toBe(1);
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
		expect(list[0].enabled).toBe(true);
	});

	it("摘除后锁为空 → 拒绝（空锁拒启，S1-1.2），四处状态未变", async () => {
		await writeLock(lockPath, { "demo-solution": "0.1.0" });
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1000 } } });
		const r = await setEnabled({ name: "demo-solution", enabled: false, sharedRoot, lockPath, state, modulesJsonPath });
		expect(r.ok).toBe(false);
		expect(r.message).toContain("空锁");
		expect(await readLock(lockPath)).toEqual({ "demo-solution": "0.1.0" });
	});
});

describe("任务治理（R13/B9/R31）：保留 10 条 + 超时判 failed + message 脱敏", () => {
	it("任务文件保留最近 10 条，超出删最旧（按 startedAt 序）", async () => {
		const base = Date.now();
		for (let i = 0; i < 12; i++) {
			await writeTask(taskDir, {
				id: `t-${String(i).padStart(2, "0")}`,
				name: "demo-solution",
				version: "0.1.0",
				status: "done",
				stage: "done",
				progress: 100,
				message: `m${i}`,
				stages: [],
				startedAt: base + i,
				finishedAt: base + i,
			});
		}
		const files = (await fsp.readdir(taskDir)).filter(f => f.endsWith(".json"));
		expect(files).toHaveLength(10);
		await expect(fsp.access(join(taskDir, "t-01.json"))).rejects.toThrow();
		await fsp.access(join(taskDir, "t-11.json"));
	});

	it("sweepTimedOut：running 超 30min 判 failed（retryable），新鲜 running 不动", async () => {
		const now = Date.now();
		await writeTask(taskDir, {
			id: "old",
			name: "demo-solution",
			version: "0.1.0",
			status: "running",
			stage: "migrating",
			progress: 30,
			message: "执行中",
			stages: [],
			startedAt: now - 31 * 60_000,
		});
		await writeTask(taskDir, {
			id: "fresh",
			name: "demo-solution",
			version: "0.1.0",
			status: "running",
			stage: "preflight",
			progress: 0,
			message: "执行中",
			stages: [],
			startedAt: now - 1000,
		});
		const flipped = await sweepTimedOut(taskDir, now);
		expect(flipped.map(x => x.id)).toEqual(["old"]);
		expect((await getTask(taskDir, "old"))?.status).toBe("failed");
		expect((await getTask(taskDir, "old"))?.error?.retryable).toBe(true);
		expect((await getTask(taskDir, "fresh"))?.status).toBe("running");
	});

	it("redact：URL query / Bearer / JWT / token=xxx 脱敏；sha256 诊断摘要保留（verify 可诊断性）", () => {
		expect(redact("下载失败：https://cdn.example.com/a.tgz?token=secret123&sig=zzz"))
			.not
			.toContain("secret123");
		expect(redact("凭证 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")).not.toContain("eyJhbGciOiJIUzI1NiJ9");
		expect(redact("参数 password=hunter2 其他")).not.toContain("hunter2");
		const digest = `校验失败：期望 ${SHA256}，实得 ${"f".repeat(64)}`;
		expect(redact(digest)).toBe(digest);
	});

	it("writeTask 落盘前脱敏：message/error.reason/stages 逐条过 redact", async () => {
		await writeTask(taskDir, {
			id: "leak",
			name: "demo-solution",
			version: "0.1.0",
			status: "failed",
			stage: "downloading",
			progress: 10,
			message: "下载失败：https://cdn.example.com/a.tgz?token=secret123",
			stages: [{ stage: "downloading", ok: false, message: "URL https://cdn.example.com/a.tgz?token=secret123 失败" }],
			startedAt: 1,
			finishedAt: 2,
			error: { reason: "Bearer abcdef123456 泄漏", retryable: true, hintKey: "lifecycle.stage.downloading.hint" },
		});
		const raw = await fsp.readFile(join(taskDir, "leak.json"), "utf8");
		expect(raw).not.toContain("secret123");
		expect(raw).not.toContain("abcdef123456");
	});
});
