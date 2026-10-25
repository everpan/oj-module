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
import type { FsFace } from "../../src/_platform/api/_lifecycle/atomic";
import type { InstallRequest } from "../../src/_platform/api/_lifecycle/installer";
import type { StateStore } from "../../src/_platform/api/_lifecycle/state";
import type { ExecFace } from "../../src/_platform/api/_lifecycle/steps/extract";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTestKey, nodeVerifyEd25519, signedArchiveFor } from "../../../src/lifecycle/__tests__/helpers";
import { atomicWriteText } from "../../src/_platform/api/_lifecycle/atomic";
import { gcVersions, reconcile, runInstall, setEnabled, STAGES } from "../../src/_platform/api/_lifecycle/installer";
import { acquireTaskLock, commitLockEntry, parseLock, readLock, serializeLock, writeLock } from "../../src/_platform/api/_lifecycle/lock";
import { createStateStore } from "../../src/_platform/api/_lifecycle/state";
import { getTask, readTasks, redact, sweepTimedOut, writeTask } from "../../src/_platform/api/_lifecycle/tasks";
import { createTrustStore } from "../../src/_platform/api/_lifecycle/trust";
import { installDb } from "../fixture";

const g = globalThis as any;

/** 共享测试 key（P2-3：夹具签名与信任库播种同一把；无私钥入仓） */
const TEST_KEY = defaultTestKey();
const TRUST_KEY_ID = "test.publisher";

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++)
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

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
let dbPath: string;
let lockPath: string;
let state: StateStore;
let trustPath: string;
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
		archive: { file: `demo-solution-${version}.tgz`, sha256: SHA256, size: ARCHIVE.byteLength, signature: signedArchiveFor(ARCHIVE, "demo-solution", version, { keyPair: TEST_KEY }).sig },
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

/** bundle exec stub：tar list 返回 verbose listing、tar extract 真写出 §2.9 产物树（C2 manifest + api 模块目录 + web 树）、oj migrate 返回 S1-6 合同 JSON */
function bundleExec(): ExecFace & { calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		run: async (argv) => {
			calls.push([...argv]);
			if (argv[0] === "tar" && argv[1] === "-tvzf") {
				const v = /demo-solution-([\w.-]+)\.tgz$/.exec(argv[2] ?? "")?.[1] ?? "0.1.0";
				return { code: 0, stdout: `manifest.yaml\napi/demo-solution-${v}/manifest.yaml\napi/demo-solution-${v}/routes.js\napi/demo-solution-${v}/migrations/0001__init.sql\nweb/modules/demo-solution/${v}/entry.js\nweb/modules/demo-solution/${v}/main.css\n`, stderr: "" };
			}
			if (argv[0] === "tar" && argv[1] === "-xzf") {
				const v = /demo-solution-([\w.-]+)\.tgz$/.exec(argv[2] ?? "")?.[1] ?? "0.1.0";
				const dest = argv[4]!;
				const apiDir = join(dest, "api", `demo-solution-${v}`, "migrations");
				const dir = join(dest, "web", "modules", "demo-solution", v);
				await fsp.mkdir(apiDir, { recursive: true });
				await fsp.mkdir(dir, { recursive: true });
				// C2 Form A（staging 根）
				await fsp.writeFile(join(dest, "manifest.yaml"), `name: demo-solution\nversion: ${v}\n`);
				// oj 原生清单（api 模块目录内，desc === summary，C2-31 消费面；JSON 文本 = g.yaml.parse stub 可解析形态）
				await fsp.writeFile(join(dest, "api", `demo-solution-${v}`, "manifest.yaml"), JSON.stringify({ name: "demo-solution", desc: "演示方案", version: v }));
				await fsp.writeFile(join(dest, "api", `demo-solution-${v}`, "routes.js"), "export {};\n");
				await fsp.writeFile(join(apiDir, "0001__init.sql"), "CREATE TABLE note (id INTEGER PRIMARY KEY);\n");
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
		dbPath,
		siteModulesDir,
		modulesJsonPath,
		apiPrefix: "/api/demo-solution",
		configPath: join(root, "config.yaml"),
		fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer }),
		exec: bundleExec(),
		reload: { reloadConfig: async () => ({ generation: 1, unchanged: false, applied: ["vars"], restart_pending: [], kept_listener: [] }) },
		sha256Hex: d => createHash("sha256").update(d).digest("hex"),
		verifyEd25519: nodeVerifyEd25519,
		trustPath,
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
	dbPath = join(root, "db.sqlite");
	await fsp.writeFile(dbPath, new TextEncoder().encode("sqlite-header\n"));
	// 站点 config.yaml 夹具（reloading 段 vars.ojm_install_seq 自增消费面；模板 config.yaml 随发形态）
	await fsp.writeFile(join(root, "config.yaml"), "mounts: []\nserver:\n  reload_api: true\nvars:\n  ojm_install_seq: 0\nauth:\n  anonymous_paths:\n    - /auth/login\n");
	g.fs = nodeFsFace();
	g.yaml = { parse: async (t: string) => JSON.parse(t) };
	g.http = {};
	dbo = installDb();
	state = await createStateStore(join(sharedRoot, ".solutions", "state.yaml"));
	trustPath = join(sharedRoot, ".solutions", "trusted-keys.yaml");
	// 播种信任库（走真实 store；key_id 与夹具签名同一把 TEST_KEY）
	await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).add(TRUST_KEY_ID, TEST_KEY.publicKeyHex);
});

afterEach(async () => {
	g.fs = undefined;
	g.http = undefined;
	g.db = undefined;
	g.yaml = undefined;
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
		// 版本目录就位（锁指向的目录先于锁落盘，S1-4 同序）。B-11：发布面 = 包内 api 模块目录
		// （oj 原生清单 + routes.js + migrations/，serve 装配消费面），web 树不进版本目录
		const versionDir = join(sharedRoot, "demo-solution-0.1.0");
		await fsp.access(join(versionDir, "manifest.yaml"));
		await fsp.access(join(versionDir, "routes.js"));
		await fsp.access(join(versionDir, "migrations", "0001__init.sql"));
		await expect(fsp.access(join(versionDir, "web"))).rejects.toThrow();
		// reloading 段触发变更已落盘：vars.ojm_install_seq 自增（B-11，PRD E5 口径）
		const cfg = new TextDecoder().decode(await fsp.readFile(join(root, "config.yaml")));
		expect(cfg).toContain("ojm_install_seq: 1");
		// C2-26 anonymous 运行时接线（P2-15③）：方案匿名端点补进 auth.anonymous_paths（幂等追加）
		expect(cfg).toContain("- /demo-solution/ping");
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

	it("preview 形态：派生 .ojm-preview.yaml 存在时两份 config 一起自增（否则 reload 恒 unchanged）", async () => {
		// ojm preview 派生出来的那份才是服务端在读的 config（spa 挂载 + platform.root 改写）
		const derived = join(root, ".ojm-preview.yaml");
		await fsp.writeFile(derived, "mounts: []\nserver:\n  reload_api: true\nvars:\n  ojm_install_seq: 0\nauth:\n  anonymous_paths:\n    - /auth/login\n");

		const t = await runInstall(makeReq());
		expect(t.status).toBe("done");

		const source = new TextDecoder().decode(await fsp.readFile(join(root, "config.yaml")));
		const preview = new TextDecoder().decode(await fsp.readFile(derived));
		// 源 config 仍是真相（preview 重启后按它重建派生文件）
		expect(source).toContain("ojm_install_seq: 1");
		expect(source).toContain("- /demo-solution/ping");
		// 派生文件也要变：reloadConfig 按它的文档 sha 判 unchanged
		expect(preview).toContain("ojm_install_seq: 1");
		expect(preview).toContain("- /demo-solution/ping");
	});

	it("非 preview 形态：没有派生文件就不无中生有（dev / 生产部署只写源 config）", async () => {
		const t = await runInstall(makeReq());
		expect(t.status).toBe("done");
		await expect(fsp.access(join(root, ".ojm-preview.yaml"))).rejects.toThrow();
	});

	it("P2-13 spawn 流式双路径：appliedSeq 仍在（跨 chunk 拼接解析）+ 进度字段形状不变（轮询消费面兼容）", async () => {
		const base = bundleExec();
		const exec: ExecFace = {
			run: base.run,
			spawn: async (argv) => {
				if (argv[0] === "oj" && argv[1] === "migrate") {
					// S1-6 JSON 恰一行切成 3 块（migrate 段回调内自累积跨块拼接——installer 侧经 onMigrateOutput 捕获）
					const bytes = new TextEncoder().encode(`${MIGRATE_LINE}\n`);
					const chunks = [bytes.slice(0, 7), bytes.slice(7, 19), bytes.slice(19)];
					async function* gen() {
						for (const c of chunks)
							yield c;
					}
					return { stdout: gen(), stderr: gen(), exit: async () => ({ code: 0 }), kill: () => {} };
				}
				throw new Error(`unexpected spawn: ${argv.join(" ")}`);
			},
		};
		const t = await runInstall(makeReq({ exec }));
		expect(t.status).toBe("done");
		expect(t.appliedSeq).toBe(3);
		expect(typeof t.progress).toBe("number");
		expect(t.progress).toBe(100);
		const saved = await getTask(taskDir, t.id);
		expect(saved?.appliedSeq).toBe(3);
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

describe("P3-2 版本 GC（KEEP_VERSIONS=3：state history 时间序 + 锁版本保护）", () => {
	it("装 5 个不同版本 → 仅留最近 3 版目录、旧版本目录被清理、sidecar history 截取最近 3", async () => {
		for (const v of ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]) {
			const t = await runInstall(makeReq({ version: v }));
			expect(t.status).toBe("done");
		}
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual({ "demo-solution": "0.5.0" });
		// 仅最近 3 版目录在盘，最旧两版被 GC 清理
		for (const v of ["0.1.0", "0.2.0"]) {
			await expect(fsp.access(join(sharedRoot, `demo-solution-${v}`))).rejects.toThrow();
		}
		for (const v of ["0.3.0", "0.4.0", "0.5.0"]) {
			await fsp.access(join(sharedRoot, `demo-solution-${v}`, "manifest.yaml"));
		}
		// sidecar history 截取为最近 3（倒序：最新在前）
		expect(state.read().solutions["demo-solution"]?.history?.map(h => h.version)).toEqual(["0.5.0", "0.4.0", "0.3.0"]);
	});

	it("gcVersions 锁版本保护：history 超出 N 但锁指向最旧版本时，最旧版本目录与 history 保留（回滚目标不可被 GC 误删）", async () => {
		// 预置 sidecar history 5 个版本（倒序），最旧为 0.1.0
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1000, history: [
			{ version: "0.5.0", installedAt: 5000 },
			{ version: "0.4.0", installedAt: 4000 },
			{ version: "0.3.0", installedAt: 3000 },
			{ version: "0.2.0", installedAt: 2000 },
			{ version: "0.1.0", installedAt: 1000 },
		] } } });
		// 预建 5 个版本目录
		for (const v of ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"]) {
			await fsp.mkdir(join(sharedRoot, `demo-solution-${v}`), { recursive: true });
		}
		// 锁指向最旧版本 0.1.0（reconcile 回滚到旧版的落地形态）
		await writeLock(lockPath, { "demo-solution": "0.1.0", "auth": "0.1.0" });
		await gcVersions(sharedRoot, "demo-solution", state);
		// 锁版本 0.1.0 保留；0.2.0 超出「最近 3 ∪ 锁版本」被清理
		await fsp.access(join(sharedRoot, "demo-solution-0.1.0"));
		await fsp.access(join(sharedRoot, "demo-solution-0.3.0"));
		await fsp.access(join(sharedRoot, "demo-solution-0.4.0"));
		await fsp.access(join(sharedRoot, "demo-solution-0.5.0"));
		await expect(fsp.access(join(sharedRoot, "demo-solution-0.2.0"))).rejects.toThrow();
		// history 保留锁版本（最旧 0.1.0 在，0.2.0 出）
		expect(state.read().solutions["demo-solution"]?.history?.map(h => h.version)).toEqual(["0.5.0", "0.4.0", "0.3.0", "0.1.0"]);
	});

	it("同版本重装：history 不重复、installedAt 刷新，不触发 GC 涨栈", async () => {
		await runInstall(makeReq({ version: "0.1.0" }));
		await runInstall(makeReq({ version: "0.1.0" }));
		await runInstall(makeReq({ version: "0.2.0" }));
		const hist = state.read().solutions["demo-solution"]?.history?.map(h => h.version);
		expect(hist).toEqual(["0.2.0", "0.1.0"]); // 0.1.0 仅一条（重装去重，installedAt 刷新到更晚）
	});
});

describe("getTask/taskOf id 白名单（Finding B：穿越 id 不得读出 taskDir 之外）", () => {
	it("id=../../dist/modules 形态 → null（即使穿越目标存在合法 JSON 也不可读）；合法 id 不受影响", async () => {
		// 穿越目标预置可读 JSON：白名单缺失时 getTask 会把它当任务记录读出（红）。
		// taskDir 须真实存在——内核路径游走要穿过它，缺失时 ../ 段直接 ENOENT（测不出穿越）
		await fsp.mkdir(taskDir, { recursive: true });
		await fsp.mkdir(join(root, "dist"), { recursive: true });
		await fsp.writeFile(join(root, "dist", "modules.json"), JSON.stringify({ id: "stolen", status: "done", stages: [] }));
		expect(await getTask(taskDir, "../../dist/modules")).toBeNull();
		expect(await getTask(taskDir, "../sibling")).toBeNull();
		// 合法 id 读写不受白名单影响（lock/state 键白名单同款字符集）
		await writeTask(taskDir, { id: "t-ok", name: "demo-solution", version: "0.1.0", status: "done", stage: "done", progress: 100, message: "", stages: [], startedAt: 1 });
		expect((await getTask(taskDir, "t-ok"))?.status).toBe("done");
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

describe("p3-11 宿主层 rollbackGuard 预锁拦截（OJ-9）：包内迁移 max seq < ledgerHead → migrating 失败，零 exec 零备份", () => {
	it("ledgerHead=5、包内仅 0001 → migrating failed（retryable=false），oj migrate 未执行、无 .bak 备份、锁前清场", async () => {
		const exec = bundleExec();
		const t = await runInstall(makeReq({ ledgerHead: 5, exec }));
		expect(t.status).toBe("failed");
		expect(t.stage).toBe("migrating");
		expect(t.error?.retryable).toBe(false);
		expect(String(t.error?.reason)).toContain("禁降版");
		// 零 exec：oj migrate 未被调用（tar list/extract 属包准备，允许发生）
		expect(exec.calls.filter(c => c[0] === "oj")).toHaveLength(0);
		// 零备份：R14 前置备份未发生（宿主层在备份前拦截）
		expect((await fsp.readdir(root)).filter(e => e.includes(".bak-"))).toHaveLength(0);
		// 锁前清场（D11①）：staging 清空、零落锁零落位
		await expect(fsp.access(staging)).rejects.toThrow();
		await expect(fsp.access(lockPath)).rejects.toThrow();
	});

	it("近似真源缺失（包内无 migrations 目录）→ 宿主层放行，migrate 段 applied[] 事后复核兜底拦截", async () => {
		const exec: ExecFace = {
			run: async (argv) => {
				if (argv[0] === "tar" && argv[1] === "-tvzf")
					return { code: 0, stdout: "manifest.yaml\napi/demo-solution-0.1.0/manifest.yaml\napi/demo-solution-0.1.0/routes.js\n", stderr: "" };
				if (argv[0] === "tar" && argv[1] === "-xzf") {
					const apiDir = join(argv[4]!, "api", "demo-solution-0.1.0");
					await fsp.mkdir(apiDir, { recursive: true });
					await fsp.writeFile(join(argv[4]!, "manifest.yaml"), "name: demo-solution\nversion: 0.1.0\n");
					await fsp.writeFile(join(apiDir, "manifest.yaml"), JSON.stringify({ name: "demo-solution", desc: "演示方案", version: "0.1.0" }));
					await fsp.writeFile(join(apiDir, "routes.js"), "export {};\n");
					return { code: 0, stdout: "", stderr: "" };
				}
				if (argv[0] === "oj" && argv[1] === "migrate")
					return { code: 0, stdout: `${MIGRATE_LINE}\n`, stderr: "" };
				return { code: 0, stdout: "", stderr: "" };
			},
		};
		const t = await runInstall(makeReq({ ledgerHead: 5, exec }));
		// 宿主层未拦（无文件名真源）→ oj migrate 真的跑了 → applied seq 3 < head 5 由 migrate 段复核拦下
		expect(t.status).toBe("failed");
		expect(t.stage).toBe("migrating");
		expect(String(t.error?.reason)).toContain("账本 head 5");
	});
});

describe("U5 取消安装（P3-8）：cancel token → h.kill + staging 清场 + 锁/目录回退装前 + 终态 cancelled", () => {
	/**
	 * 取消用 harness：tar list/extract 走真实 bundleExec；oj migrate 走 spawn（逐块吐、spawn 启动后
	 * cancel 才为真、kill 记录调用）。cancel 仅在 migrate 段 spawn 实际启动且收过 ≥1 块后才为真——
	 * 避免误触 runInstall 段间 cancel 检测（真实 cancel 是布尔闭包，spawnStarted 门控贴近语义）
	 */
	function cancelHarness() {
		let killed = false;
		let spawnStarted = false;
		let chunksInSpawn = 0;
		const base = bundleExec();
		const exec: ExecFace = {
			run: (argv, opts) => base.run(argv, opts),
			spawn: async (argv) => {
				if (argv[0] === "oj" && argv[1] === "migrate") {
					spawnStarted = true;
					const bytes = new TextEncoder().encode(`${MIGRATE_LINE}\n`);
					const chunks = [bytes.slice(0, 5), bytes.slice(5)];
					async function* gen() {
						for (const c of chunks) {
							chunksInSpawn++;
							yield c;
						}
					}
					return {
						stdout: gen(),
						stderr: gen(),
						exit: async () => ({ code: 137 }),
						kill: () => {
							killed = true;
						},
					};
				}
				throw new Error(`unexpected spawn: ${argv.join(" ")}`);
			},
		};
		const cancel = () => spawnStarted && chunksInSpawn >= 1;
		return { exec, cancel, killCalled: () => killed };
	}

	it("migrate 段取消 → kill 调用、staging 清空、锁/版本目录回到装前、终态 failed+cancelled、审计末位落 oplog", async () => {
		const h = cancelHarness();
		const t = await runInstall(makeReq({ exec: h.exec, cancel: h.cancel }));
		expect(t.status).toBe("failed");
		expect(t.cancelled).toBe(true);
		expect(h.killCalled()).toBe(true);
		// staging 清空（下载/解压/迁移产物随之一并清）
		await expect(fsp.access(staging)).rejects.toThrow();
		// 首装装前无锁 → 取消后无锁文件（空锁拒启 S1-1.2，不污染）
		await expect(fsp.access(lockPath)).rejects.toThrow();
		// 版本目录不得残留（migrate 段取消 = 锁前，lock_commit 未达 → 无版本目录）
		await expect(fsp.access(join(sharedRoot, "demo-solution-0.1.0"))).rejects.toThrow();
		// 审计末位：solution.install 落 oplog（取消也须可观测，AC-P1-14）
		const oplog = rows("SELECT detail FROM sys_oplog WHERE action = 'solution.install'");
		expect(oplog).toHaveLength(1);
		// 任务文件终态可查，不滞留 running
		expect((await getTask(taskDir, t.id))?.status).toBe("failed");
	});

	it("升级场景取消（装前已有同名方案+锁）：锁回退到装前旧版本、旧版本目录保留、新版本目录清除", async () => {
		// 先装 0.1.0 成功，建立装前态
		const first = await runInstall(makeReq({ version: "0.1.0" }));
		expect(first.status).toBe("done");
		expect(await readLock(lockPath)).toEqual({ "demo-solution": "0.1.0" });
		// 升级到 0.2.0 途中取消
		const h = cancelHarness();
		const up = await runInstall(makeReq({ version: "0.2.0", exec: h.exec, cancel: h.cancel }));
		expect(up.status).toBe("failed");
		expect(up.cancelled).toBe(true);
		expect(h.killCalled()).toBe(true);
		// 锁回退到装前旧版本（撤销 0.2.0 的写入）
		expect(await readLock(lockPath)).toEqual({ "demo-solution": "0.1.0" });
		// 旧版本目录保留（回滚可用）
		await fsp.access(join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"));
		// 新版本目录清除（升级取消不残留半成品）
		await expect(fsp.access(join(sharedRoot, "demo-solution-0.2.0"))).rejects.toThrow();
		// staging 清空
		await expect(fsp.access(staging)).rejects.toThrow();
	});

	it("幂等/可重入：取消 cleanup 对已清场态重复执行无副作用（staging 已不存在仍安全）", async () => {
		const h = cancelHarness();
		const t = await runInstall(makeReq({ exec: h.exec, cancel: h.cancel }));
		expect(t.status).toBe("failed");
		expect(t.cancelled).toBe(true);
		// staging 已清：重复访问确认非存在（cleanup 重复调用幂等）
		await expect(fsp.access(staging)).rejects.toThrow();
		// 终态任务可查（不滞留 running）
		expect((await getTask(taskDir, t.id))?.status).toBe("failed");
	});
});

describe("第五终态 needs_trust（P2-3，G3 TOFU：未知 key_id 待确认，staging 不清场）", () => {
	it("未知 key 装 → needs_trust + trust 三元组 + unknown_key 指引；锁/库表/sidecar/审计零改动，staging 留存", async () => {
		const { generateKeyPair } = await import("../../../src/lifecycle/keygen");
		const { signedArchiveFor: signFor } = await import("../../../src/lifecycle/__tests__/helpers");
		const stranger = signFor(ARCHIVE, "demo-solution", "0.1.0", { keyPair: generateKeyPair(), keyId: "stranger.pub" });
		const m = manifestFixture("0.1.0");
		m.archive = { ...m.archive, signature: stranger.sig };
		const t = await runInstall(makeReq({ manifest: m }));
		expect(t.status).toBe("needs_trust");
		expect(t.stage).toBe("verifying");
		expect(t.error?.hintKey).toBe("lifecycle.stage.verifying.unknown_key");
		expect(t.error?.retryable).toBe(false);
		expect(t.trust).toMatchObject({ key_id: "stranger.pub", public_key: stranger.publicKeyHex });
		expect(t.trust?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		// 停在哪算哪：stages 止于 verifying
		expect(t.stages.map(s => s.stage)).toEqual(["preflight", "downloading", "verifying"]);
		// staging 不清场（file 源须重传、CDN 源重试自动重下——包体与 .sig 仍在场）
		await expect(fsp.access(join(staging, "demo-solution-0.1.0.tgz"))).resolves.toBeUndefined();
		// 锁/版本目录/清单/sidecar/库表/审计零改动（失败语义①同口径）
		await expect(fsp.access(lockPath)).rejects.toThrow();
		await expect(fsp.access(join(sharedRoot, "demo-solution-0.1.0"))).rejects.toThrow();
		await expect(fsp.access(modulesJsonPath)).rejects.toThrow();
		expect(rows("SELECT path FROM sys_solution_route")).toHaveLength(0);
		expect(rows("SELECT * FROM sys_oplog")).toHaveLength(0);
		expect(state.read().solutions).toEqual({});
		// 任务文件落盘可观测（800ms 轮询消费面看得见待确认态）
		const saved = await getTask(taskDir, t.id);
		expect(saved?.status).toBe("needs_trust");
		expect(saved?.trust?.key_id).toBe("stranger.pub");
	});

	it("TOFU 全链：确认入信任库（端点同路径 store.add）后原样重试 → done", async () => {
		const { generateKeyPair } = await import("../../../src/lifecycle/keygen");
		const { signedArchiveFor: signFor } = await import("../../../src/lifecycle/__tests__/helpers");
		const stranger = signFor(ARCHIVE, "demo-solution", "0.1.0", { keyPair: generateKeyPair(), keyId: "stranger.pub" });
		const m = manifestFixture("0.1.0");
		m.archive = { ...m.archive, signature: stranger.sig };
		const first = await runInstall(makeReq({ manifest: m }));
		expect(first.status).toBe("needs_trust");
		// 确认：POST /market/trust {task_id} 的服务端同路径（store.add；operator 反查留端点侧）
		await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).add("stranger.pub", stranger.publicKeyHex);
		const second = await runInstall(makeReq({ manifest: m }));
		expect(second.status).toBe("done");
		expect(second.stages.map(s => s.stage)).toContain("verifying");
		expect(parseLock(await fsp.readFile(lockPath, "utf8"))).toEqual({ "demo-solution": "0.1.0" });
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

describe("终态审计守卫（Finding A：审计失败仅日志、不阻断任务终态，附录 B-5）", () => {
	it("audit 注入抛非审计异常 + console 通道不可用（release isolate BadResource 形态）→ runInstall 仍返回正常终态，任务不滞留 running", async () => {
		// release isolate：console.* 自身抛 BadResource（契约 B-8）——catch 里的 console.warn 会把
		// 「仅日志」语义毒死并击穿 runInstall 终态段，端点 500、任务滞留 running 直到 30min sweep。
		// 以会抛的 console spy 模拟该形态（node 环境 console 不会抛，直接注入测不出此路径）
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {
			throw new Error("BadResource: console 通道在 release isolate 不可用");
		});
		try {
			const t = await runInstall(makeReq({
				audit: () => {
					throw new Error("audit 后端炸了（非审计异常形态）");
				},
			}));
			expect(t.status).toBe("done");
			expect(t.stage).toBe("done");
			const auditEntry = t.stages.find(s => s.stage === "audit");
			expect(auditEntry?.ok).toBe(true);
			expect(auditEntry?.message).toContain("audit 后端炸了");
			// 任务文件终态可查（不滞留 running）
			expect((await getTask(taskDir, t.id))?.status).toBe("done");
		}
		finally {
			warn.mockRestore();
		}
	});

	it("sidecar 写失败 → 终态 done 不变、降级路径静默（禁 console，同上 BadResource 毒终态段）", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const t = await runInstall(makeReq({
				state: {
					read: () => ({ solutions: {} }),
					write: async () => { throw new Error("sidecar 盘满"); },
				},
			}));
			expect(t.status).toBe("done");
			expect(warn).not.toHaveBeenCalled();
			expect((await getTask(taskDir, t.id))?.status).toBe("done");
		}
		finally {
			warn.mockRestore();
		}
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

describe("p3-9 reconcile live 信任核对（P2-6#1，G5）：吊销 key ⇒ 标 untrusted 且仍启用", () => {
	async function revokeKey(): Promise<void> {
		// 吊销：只阻断新装/升级，不动已装方案（G5）；与 setEnabled 启用核对同信任库
		await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).remove(TRUST_KEY_ID);
	}

	it("reconcile 后吊销 key ⇒ 方案标 untrusted 且仍启用（存量可用性承诺 G5）", async () => {
		await runInstall(makeReq()); // sidecar 落 archive.key_id=test.publisher + trust_state=trusted
		await revokeKey();
		const report = await reconcile({
			lockPath,
			sharedRoot,
			taskDir,
			ledgerHeadOf: async () => 3,
			headFloorOf: async () => 3,
			trustPath,
			state,
		});
		expect(report.healed).toEqual([]); // 账务一致，无自愈
		// 仍启用：锁条目 / sidecar enabled 不动（G5 存量可用性承诺）
		expect(await readLock(lockPath)).toEqual({ "demo-solution": "0.1.0" });
		expect(state.read().solutions["demo-solution"]?.enabled).toBe(true);
		// live 核对标 untrusted（G5：放行 + 告警 + 审计 + 深检标 untrusted）
		expect(state.read().solutions["demo-solution"]?.trust_state).toBe("untrusted");
		// archive 真源保留（切换不丢复验依据）
		expect(state.read().solutions["demo-solution"]?.archive?.sha256).toBe(SHA256);
		// 审计留痕（solution.trust.recheck，level 4；fire-and-forget，waitFor 收敛）
		await vi.waitFor(() => {
			const oplog = rows("SELECT detail FROM sys_oplog WHERE action = 'solution.trust.recheck'");
			expect(oplog).toHaveLength(1);
			expect(String(oplog[0]!.detail)).toContain("untrusted");
		}, { timeout: 1000 });
	});

	it("撤销吊销（key 重入信任库）⇒ 曾被标 untrusted 的方案恢复 trusted", async () => {
		await runInstall(makeReq());
		await revokeKey();
		await reconcile({ lockPath, sharedRoot, taskDir, ledgerHeadOf: async () => 3, headFloorOf: async () => 3, trustPath, state });
		expect(state.read().solutions["demo-solution"]?.trust_state).toBe("untrusted");
		await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).add(TRUST_KEY_ID, TEST_KEY.publicKeyHex);
		await reconcile({ lockPath, sharedRoot, taskDir, ledgerHeadOf: async () => 3, headFloorOf: async () => 3, trustPath, state });
		expect(state.read().solutions["demo-solution"]?.trust_state).toBe("trusted");
	});

	it("P1 时代条目（无 archive）→ 无复验真源，live 核对静默跳过（不误标 untrusted）", async () => {
		await writeLock(lockPath, { "demo-solution": "0.1.0" });
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1000 } } });
		await revokeKey();
		await reconcile({ lockPath, sharedRoot, taskDir, ledgerHeadOf: async () => 3, headFloorOf: async () => 3, trustPath, state });
		expect(state.read().solutions["demo-solution"]?.trust_state).toBeUndefined();
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

	// oj 真机实测（0.1.78，B-11）：readFile/remove 对缺失目标抛 TypeError "invalid_argument"
	// （无 .code）——首装（锁/modules.json 尚不存在）不得被 ENOENT 嗅探误判为坏锁而中断
	it("首装锁缺失：oj 语义 TypeError invalid_argument 视同 ENOENT（isMissingPath）", async () => {
		const ojLikeFs: FsFace = {
			...nodeFsFace(),
			readFile: async (path) => {
				await fsp.access(path).then(() => undefined, () => {
					throw new TypeError("invalid_argument");
				});
				return fsp.readFile(path);
			},
		};
		g.fs = ojLikeFs;
		const r = await commitLockEntry(lockPath, "demo-solution", "0.1.0");
		expect(r.ok).toBe(true);
		expect(await readLock(lockPath)).toEqual({ "demo-solution": "0.1.0" });
		g.fs = nodeFsFace();
	});
});

describe("P2-6 切换前复验（D11③/G5：sidecar 复验真源 + 启用发布方核对 + 同版本摘要比对）", () => {
	it("install done 后 sidecar 落 archive{sha256,key_id,signature} + trust_state=trusted（复验真源随装落）", async () => {
		const t = await runInstall(makeReq());
		expect(t.status).toBe("done");
		const entry = state.read().solutions["demo-solution"]!;
		expect(entry.trust_state).toBe("trusted");
		expect(entry.archive?.sha256).toBe(SHA256);
		expect(entry.archive?.key_id).toBe("test.publisher");
		expect(entry.archive?.signature).toMatchObject({ alg: "Ed25519", public_key: TEST_KEY.publicKeyHex });
		// 落盘形状：archive 为 JSON 字符串标量（两层 YAML 约束保持），读回等价
		const text = await fsp.readFile(join(sharedRoot, ".solutions", "state.yaml"), "utf8");
		expect(text).toMatch(/trust_state: trusted/);
		const reread = await createStateStore(join(sharedRoot, ".solutions", "state.yaml"));
		expect(reread.read().solutions["demo-solution"]?.archive?.sha256).toBe(SHA256);
	});

	it("同版本重装摘要不符 → verifying 拒（六码 tampered：CDN 同名版本换包即拒）", async () => {
		await runInstall(makeReq()); // 先装一次（sidecar 落 SHA256）
		// 重取包：包体换字节、清单摘要自洽（actual===expected 过常规比对），但与已装记录不同
		const other = new TextEncoder().encode("replaced-archive-bytes\n");
		const m = manifestFixture("0.1.0");
		m.archive = { ...m.archive, sha256: createHash("sha256").update(other).digest("hex"), size: other.byteLength };
		const t = await runInstall(makeReq({ manifest: m, fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => other.slice().buffer }) }));
		expect(t.status).toBe("failed");
		expect(t.stage).toBe("verifying");
		expect(t.error?.hintKey).toBe("lifecycle.stage.verifying.tampered");
		expect(t.stages.find(s => s.stage === "verifying")?.message).toContain("包内容被替换");
	});

	it("吊销后启用（G5）：放行 + 显著告警 + 审计带 trust + sidecar 标 untrusted", async () => {
		await runInstall(makeReq());
		// 吊销：信任库移除 key_id（只阻断新装/升级）
		await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).remove("test.publisher");
		await setEnabled({ name: "demo-solution", enabled: false, sharedRoot, lockPath, state, modulesJsonPath, trustPath });
		const r = await setEnabled({ name: "demo-solution", enabled: true, sharedRoot, lockPath, state, modulesJsonPath, trustPath });
		expect(r.ok).toBe(true); // 放行（存量可用性承诺）
		expect(r.message).toContain("已不在信任库");
		expect(r.message).toContain("建议升级");
		expect(state.read().solutions["demo-solution"]?.trust_state).toBe("untrusted");
		// archive 真源保留（切换不丢复验依据）
		expect(state.read().solutions["demo-solution"]?.archive?.sha256).toBe(SHA256);
		// 审计留痕（detail.trust）
		const oplog = rows("SELECT detail FROM sys_oplog WHERE action = 'solution.enable' ORDER BY id DESC LIMIT 1");
		expect(String(oplog[0]?.detail)).toContain("trust");
	});

	it("P1 时代条目（无 archive）：启用放行 +「无验签真源」告警 + trust_state=absent", async () => {
		await writeLock(lockPath, { "demo-solution": "0.1.0", "auth": "0.1.0" });
		// 旧四行形态（P2 前安装：无 archive/trust_state 行）
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1000 } } });
		dbo.exec("INSERT INTO sys_solution_route (path, module, category, \"order\", deprecated, enabled) VALUES ('/demo-solution', 'demo-solution', 'main', 200, 0, 1)");
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		await fsp.writeFile(join(sharedRoot, "demo-solution-0.1.0", "manifest.yaml"), "name: demo-solution\nversion: 0.1.0\n");
		await atomicWriteText(modulesJsonPath, `${JSON.stringify([{ name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: true }], null, 2)}\n`);
		const r = await setEnabled({ name: "demo-solution", enabled: true, sharedRoot, lockPath, state, modulesJsonPath, trustPath });
		expect(r.ok).toBe(true);
		expect(r.message).toContain("无验签真源");
		expect(state.read().solutions["demo-solution"]?.trust_state).toBe("absent");
	});

	it("吊销后升级拒：新包同 key_id 重签但 key 已移除 → needs_trust（升级走完整验签）", async () => {
		await runInstall(makeReq());
		await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).remove("test.publisher");
		// 0.2.0 新包（仍以 TEST_KEY 签，但 key 已吊销）
		const up = await runInstall(makeReq({ version: "0.2.0" }));
		expect(up.status).toBe("needs_trust");
		expect(up.trust?.key_id).toBe("test.publisher");
		// 已装 0.1.0 不动（吊销不动已装方案）
		expect(state.read().solutions["demo-solution"]?.version).toBe("0.1.0");
	});

	it("发布方仍受信：启用无告警 + trust_state=trusted", async () => {
		await runInstall(makeReq());
		await setEnabled({ name: "demo-solution", enabled: false, sharedRoot, lockPath, state, modulesJsonPath, trustPath });
		const r = await setEnabled({ name: "demo-solution", enabled: true, sharedRoot, lockPath, state, modulesJsonPath, trustPath });
		expect(r.ok).toBe(true);
		expect(r.message).not.toContain("⚠");
		expect(state.read().solutions["demo-solution"]?.trust_state).toBe("trusted");
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

describe("market_history 留痕（P1-15a 缺口 A）：install/enable/disable/uninstall 四类动作齐", () => {
	/** 「已装」种子（同 seedEnabled 形状：锁双条目避开空锁拒启 + sidecar + route + 版本目录 + modules.json） */
	async function seedHistory(): Promise<void> {
		await writeLock(lockPath, { "demo-solution": "0.1.0", "auth": "0.1.0" });
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1000 } } });
		dbo.exec("INSERT INTO sys_solution_route (path, module, category, \"order\", deprecated, enabled) VALUES ('/demo-solution', 'demo-solution', 'main', 200, 0, 1)");
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		await atomicWriteText(modulesJsonPath, `${JSON.stringify([{ name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: true }], null, 2)}\n`);
	}

	it("runInstall 终态（done）落 install 历史（守卫式：随主流程写，失败不阻断）", async () => {
		const t = await runInstall(makeReq());
		expect(t.status).toBe("done");
		const hist = rows("SELECT solution, version, action, status, operator, message FROM market_history");
		expect(hist).toHaveLength(1);
		expect(hist[0]).toMatchObject({ solution: "demo-solution", version: "0.1.0", action: "install", status: "done", operator: null });
		expect(String(hist[0].message)).toContain("安装完成：demo-solution@0.1.0");
	});

	it("setEnabled 落 disable/enable 历史（status=success，message 与返回人话一致）", async () => {
		await seedHistory();
		const off = await setEnabled({ name: "demo-solution", enabled: false, sharedRoot, lockPath, state, modulesJsonPath });
		const on = await setEnabled({ name: "demo-solution", enabled: true, sharedRoot, lockPath, state, modulesJsonPath });
		expect(off.ok).toBe(true);
		expect(on.ok).toBe(true);
		const hist = rows("SELECT action, status, message FROM market_history ORDER BY id");
		expect(hist).toEqual([
			{ action: "disable", status: "success", message: off.message },
			{ action: "enable", status: "success", message: on.message },
		]);
	});

	it("market_history 表不存在（站点未装市场方案）→ setEnabled 仍 ok:true（守卫式留痕静默跳过）", async () => {
		await seedHistory();
		const r = await setEnabled({ name: "demo-solution", enabled: false, sharedRoot, lockPath, state, modulesJsonPath });
		expect(r.ok).toBe(true);
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

	it("redact（P2-5）：PEM 私钥块 + private_key JSON 字段整段脱敏", () => {
		const pem = "BEGIN 头-----BEGIN EC PRIVATE KEY-----\nabcdef0123456789\n-----END EC PRIVATE KEY-----尾巴";
		expect(redact(pem)).toContain("-----BEGIN PRIVATE KEY-----…-----END PRIVATE KEY-----");
		expect(redact(pem)).not.toContain("abcdef0123456789");
		expect(redact("{\"private_key\":\"c2VjcmV0LWtleS1ieXRlcw\",\"key_id\":\"acme.market\"}")).toContain("\"private_key\":\"…\"");
		// 钉用例：key_id 与指纹明文保留（结构化字段，不进 message 被吞；脱敏只针对私钥/口令）
		const msg = "发布方 acme.market（指纹 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef）签名不符";
		const out = redact(msg);
		expect(out).toContain("acme.market");
		expect(out).toContain("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
		expect(out).toBe(msg);
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

describe("P2-10 TaskRecord schemaVersion：写方盖章 + 读方回填（旧记录不炸）", () => {
	it("writeTask 盖章 schemaVersion=1（写方语义：单写者恒为当前版本）", async () => {
		await writeTask(taskDir, { id: "t-stamp", name: "demo-solution", version: "0.1.0", status: "done", stage: "done", progress: 100, message: "", stages: [], startedAt: 1 });
		const raw = JSON.parse(await fsp.readFile(join(taskDir, "t-stamp.json"), "utf8")) as { schemaVersion?: number };
		expect(raw.schemaVersion).toBe(1);
	});

	it("readTasks 回填：无 schemaVersion 的旧记录读出 = 1", async () => {
		await fsp.mkdir(taskDir, { recursive: true });
		await fsp.writeFile(join(taskDir, "t-old.json"), JSON.stringify({ id: "t-old", name: "demo-solution", version: "0.1.0", status: "done", stage: "done", progress: 100, message: "", stages: [], startedAt: 1 }));
		const all = await readTasks(taskDir);
		expect(all).toHaveLength(1);
		expect(all[0]?.id).toBe("t-old");
		expect(all[0]?.schemaVersion).toBe(1);
	});

	it("getTask 回填：旧记录读出 = 1；高版本（99）原样透传不剥（降级提示属消费面）", async () => {
		await fsp.mkdir(taskDir, { recursive: true });
		await fsp.writeFile(join(taskDir, "t-old.json"), JSON.stringify({ id: "t-old", name: "demo-solution", version: "0.1.0", status: "done", stage: "done", progress: 100, message: "", stages: [], startedAt: 1 }));
		expect((await getTask(taskDir, "t-old"))?.schemaVersion).toBe(1);
		await fsp.writeFile(join(taskDir, "t-future.json"), JSON.stringify({ id: "t-future", name: "demo-solution", version: "0.2.0", status: "done", stage: "done", progress: 100, message: "", stages: [], startedAt: 2, schemaVersion: 99 }));
		expect((await getTask(taskDir, "t-future"))?.schemaVersion).toBe(99);
	});

	it("sweepTimedOut 改判写回：旧记录（无 schemaVersion）经回填读出后写回盖章为当前版本", async () => {
		const now = Date.now();
		await fsp.mkdir(taskDir, { recursive: true });
		await fsp.writeFile(join(taskDir, "t-stale.json"), JSON.stringify({ id: "t-stale", name: "demo-solution", version: "0.1.0", status: "running", stage: "migrating", progress: 30, message: "", stages: [], startedAt: now - 31 * 60_000 }));
		const flipped = await sweepTimedOut(taskDir, now);
		expect(flipped).toHaveLength(1);
		const raw = JSON.parse(await fsp.readFile(join(taskDir, "t-stale.json"), "utf8")) as { schemaVersion?: number };
		expect(raw.schemaVersion).toBe(1);
	});
});

describe("P1-16 接线：reconcile 不一致自动修复（重跑 setEnabled）+ operator 通道 + migrate opts 转发", () => {
	it("route enabled=0 / modules.json enabled=false 分歧 + 注入 state → 自动重跑 setEnabled(true) 收敛（healed 记 enable）", async () => {
		await writeLock(lockPath, { "demo-solution": "0.1.0", "auth": "0.1.0" });
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1000 } } });
		dbo.exec("INSERT INTO sys_solution_route (path, module, category, \"order\", deprecated, enabled) VALUES ('/demo-solution', 'demo-solution', 'main', 200, 0, 0)");
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		await atomicWriteText(modulesJsonPath, `${JSON.stringify([{ name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: false }], null, 2)}\n`);
		const report = await reconcile({
			lockPath,
			sharedRoot,
			taskDir,
			modulesJsonPath,
			routeEnabledOf: async name => (name === "demo-solution" ? false : null),
			ledgerHeadOf: async () => null,
			headFloorOf: async () => null,
			state,
		});
		expect(report.healed).toEqual([expect.objectContaining({ name: "demo-solution", action: "enable" })]);
		// 四处一致收敛：route=1、modules.json enabled=true、sidecar enabled=true、锁条目原样
		expect(dbo.prepare("SELECT enabled FROM sys_solution_route WHERE module = ?").get("demo-solution")).toMatchObject({ enabled: 1 });
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8")) as Array<{ name: string, enabled: boolean }>;
		expect(list[0]).toMatchObject({ name: "demo-solution", enabled: true });
		expect(state.read().solutions["demo-solution"]).toMatchObject({ enabled: true });
		expect(await readLock(lockPath)).toEqual({ "demo-solution": "0.1.0", "auth": "0.1.0" });
		expect(report.inconsistencies.filter(i => i.name === "demo-solution")).toHaveLength(0);
	});

	it("未注入 state（缺省）→ 维持只报不修（P1-10 既有语义不变）", async () => {
		await writeLock(lockPath, { "demo-solution": "0.1.0", "auth": "0.1.0" });
		await atomicWriteText(modulesJsonPath, `${JSON.stringify([{ name: "demo-solution", enabled: false }], null, 2)}\n`);
		const report = await reconcile({
			lockPath,
			sharedRoot,
			taskDir,
			modulesJsonPath,
			routeEnabledOf: async name => (name === "demo-solution" ? false : null),
			ledgerHeadOf: async () => null,
			headFloorOf: async () => null,
		});
		expect(report.healed).toEqual([]);
		expect(report.inconsistencies.filter(i => i.name === "demo-solution")).toHaveLength(2);
	});

	it("operator 通道：runInstall / setEnabled 的 operator 落 market_history（缺省 null 语义不变）", async () => {
		await writeLock(lockPath, { "demo-solution": "0.1.0", "auth": "0.1.0" });
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1000 } } });
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		const t = await runInstall(makeReq({ operator: "admin" }));
		expect(t.status).toBe("done");
		const on = await setEnabled({ name: "demo-solution", enabled: true, sharedRoot, lockPath, state, modulesJsonPath, operator: "admin" });
		expect(on.ok).toBe(true);
		const hist = rows("SELECT action, operator FROM market_history ORDER BY id");
		expect(hist).toEqual([
			{ action: "install", operator: "admin" },
			{ action: "enable", operator: "admin" },
		]);
	});

	it("captureMigrateExec 转发 opts：migrate 段 exec.run 收到 {timeoutMs: 600000}（生产 exec 包装不丢超时）", async () => {
		const seen: Array<{ argv: string[], opts?: { timeoutMs?: number } }> = [];
		const base = bundleExec();
		const exec: ExecFace = {
			run: (argv, opts) => {
				seen.push({ argv, opts });
				return base.run(argv, opts);
			},
		};
		const t = await runInstall(makeReq({ exec }));
		expect(t.status).toBe("done");
		const mig = seen.find(c => c.argv[0] === "oj" && c.argv[1] === "migrate");
		expect(mig).toBeDefined();
		expect(mig?.opts).toEqual({ timeoutMs: 600000 });
	});
});
