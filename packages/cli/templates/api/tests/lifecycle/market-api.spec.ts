// BDD：编排端点 + 市场索引（P1-12，R9/ISP）。
// 四端点同挂 _platform/market 组（oj v0.1.64 嵌套 handler 组，notification/api.ts 同形态）：
//   POST /api/_platform/market/install   superadmin——runInstall 编排（端点不重复编排，P1-10 状态机负责推进）
//   GET  /api/_platform/market/task?id=  superadmin——任务轮询消费面（§10.2；内容写侧已脱敏，读侧无秘密可泄）
//   GET  /api/_platform/market/meta      登录即可——{apiVersion}（peerPlatform 预检）
//   GET  /api/_platform/market/index     superadmin——CDN bundles.yaml（no-cache 拉取）+ 本地 state 对比
// 简报 `task/:id` 段参数形态在模板 http 面无先例（contacts/detail?id= 同款 query 惯例），备案于任务报告。
// 步骤面全 stub 注入（DIP）：fetch/exec/reload 不真跑；register/smoke/audit 走真实内存库夹具。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（installer.spec 同约定） */
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import type { FetchFace } from "../../src/_platform/_lifecycle/steps/download";
import type { ExecFace } from "../../src/_platform/_lifecycle/steps/extract";
import type { ReloadFace } from "../../src/_platform/_lifecycle/steps/reload";
import type { MarketEnv } from "../../src/_platform/market/api";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLock, writeLock } from "../../src/_platform/_lifecycle/lock";
import { createStateStore } from "../../src/_platform/_lifecycle/state";
import { getTask, writeTask } from "../../src/_platform/_lifecycle/tasks";
import { invalidateAllUsers } from "../../src/_platform/_shared/service/access";
import { createMarketApi, marketEnv, parseVersionsJson, versionsJsonPathOf } from "../../src/_platform/market/api";
import { installDb, MARKET_HISTORY_DDL } from "../fixture";

const g = globalThis as any;

const ARCHIVE = new TextEncoder().encode("demo-archive-bytes\n");
const SHA256 = createHash("sha256").update(ARCHIVE).digest("hex");
const ENTRY = new TextEncoder().encode("console.log(\"demo entry\");\n");
const CSS = new TextEncoder().encode(".demo{color:red}\n");
const MIGRATE_LINE = JSON.stringify({ results: [{ module: "demo-solution", ok: true, applied: [{ version: 3, name: "create_todos" }] }] });

/** 十阶段表（契约附录 A stage 名逐字：lock_commit 为 D11①扩展组，audit 恒末位） */
const STAGE_ORDER = ["preflight", "downloading", "verifying", "extracting", "migrating", "lock_commit", "registering", "deploying_web", "reloading", "smoke", "audit"];

/** 末尾斜杠 CDN（顺带钉 base 归一化口径） */
const CDN = "https://cdn.example.com/solutions/";

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

/** Form B CDN 索引（JSON 序列充当 yaml.parse 全局的载荷——解析面是 oj 全局，端点只管喂文本取对象） */
const BUNDLES = JSON.stringify({
	generated_at: "2026-10-17T00:00:00Z",
	cdn: CDN,
	solutions: [
		{
			name: "demo-solution",
			latest: "0.2.0",
			versions: [
				{ version: "0.2.0", file: "demo-solution-0.2.0.tgz", sha256: SHA256, size: ARCHIVE.byteLength },
				{ version: "0.1.0", file: "demo-solution-0.1.0.tgz", sha256: SHA256, size: ARCHIVE.byteLength },
			],
		},
		{ name: "wiki", latest: "1.3.0", versions: [{ version: "1.3.0", file: "wiki-1.3.0.tgz", sha256: "x", size: 1 }] },
	],
});
/** manifests.yaml 聚合数组（PRD §5.3：按 name+version 精确取） */
const MANIFESTS = JSON.stringify([manifestFixture("0.2.0"), manifestFixture("0.1.0")]);

let root: string;
let sharedRoot: string;
let staging: string;
let taskDir: string;
let siteModulesDir: string;
let modulesJsonPath: string;
let dbPath: string;
let dbo: any;

/** 捕获 json.ok/json.fail 出口（respond 收口后恰一次调用） */
let last: { status: number, msg?: string, data?: unknown } | null = null;

const fetchCalls: string[] = [];
const fetchInits: unknown[] = [];

const cdnFetch = ((url: string, init?: unknown) => {
	fetchCalls.push(url);
	fetchInits.push(init);
	const text = url.endsWith("bundles.yaml")
		? BUNDLES
		: url.endsWith("manifests.yaml")
			? MANIFESTS
			: null;
	if (text !== null) {
		return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
	}
	if (url.endsWith(".tgz")) {
		return { ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer as ArrayBuffer };
	}
	// smoke 探针等其余 URL：连通即可
	return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
}) as FetchFace;

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

/** bundle exec stub：tar list 返回 verbose listing、tar extract 写出 §2.9 全量夹具（端点要真解析）、oj migrate 返回 S1-6 合同 JSON */
function bundleExec(): ExecFace {
	return {
		run: async (argv) => {
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
				await fsp.writeFile(join(dest, "manifest.yaml"), JSON.stringify(manifestFixture(v)));
				// oj 原生清单（api 模块目录内，desc === summary，C2-31 消费面）
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

const reloadStub: ReloadFace = {
	reloadConfig: async () => ({ generation: 1, unchanged: false, applied: ["vars"], restart_pending: [], kept_listener: [] }),
};

function makeEnv(overrides: Partial<MarketEnv> = {}): MarketEnv {
	return {
		sharedRoot,
		staging,
		taskDir,
		statePath: join(sharedRoot, ".solutions", "state.yaml"),
		dbPath,
		siteModulesDir,
		modulesJsonPath,
		apiPrefix: "/api/demo-solution",
		configPath: join(root, "config.yaml"),
		cdnBase: async () => CDN,
		fetch: cdnFetch,
		exec: bundleExec(),
		reload: reloadStub,
		sha256Hex: d => createHash("sha256").update(d).digest("hex"),
		sha384B64: d => createHash("sha384").update(d).digest("base64"),
		ledgerHead: null,
		hostVersions: { "@oj-module/runtime": "0.1.77" },
		...overrides,
	};
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-market-"));
	sharedRoot = join(root, "modules");
	staging = join(sharedRoot, ".staging");
	taskDir = join(sharedRoot, ".install-tasks");
	siteModulesDir = join(root, "dist", "modules");
	modulesJsonPath = join(root, "dist", "modules.json");
	dbPath = join(root, "db.sqlite");
	await fsp.writeFile(dbPath, new TextEncoder().encode("sqlite-header\n"));
	// 站点 config.yaml 夹具（reloading 段 vars.ojm_install_seq 自增消费面；模板 config.yaml 随发形态）
	await fsp.writeFile(join(root, "config.yaml"), "mounts: []\nserver:\n  reload_api: true\nvars:\n  ojm_install_seq: 0\n");
	g.fs = nodeFsFace();
	dbo = installDb();
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
	g.yaml = { parse: async (t: string) => JSON.parse(t) };
	g.http = { user: { id: 1 } };
	g.json = {
		ok: (data: unknown) => {
			last = { status: 200, data };
		},
		fail: (status: number, msg: string) => {
			last = { status, msg };
		},
	};
	last = null;
	fetchCalls.length = 0;
	fetchInits.length = 0;
});

afterEach(async () => {
	g.fs = undefined;
	g.http = undefined;
	g.json = undefined;
	g.yaml = undefined;
	g.db = undefined;
	invalidateAllUsers();
	await fsp.rm(root, { recursive: true, force: true });
});

describe("权限门（R9：市场编排 superadmin 独占，meta 登录即可）", () => {
	it("非 superadmin 访问 install/task/index 一律 403（拒权不泄露存在性）", async () => {
		g.http = { user: { id: 2 } };
		const api = createMarketApi(makeEnv());
		await api.install.post();
		expect(last?.status).toBe(403);
		await api.task.get();
		expect(last?.status).toBe(403);
		await api.index.get();
		expect(last?.status).toBe(403);
	});

	it("meta 登录即可：匿名 401，任意登录用户得 {apiVersion}（peerPlatform 预检）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = {};
		await api.meta.get();
		expect(last?.status).toBe(401);
		g.http = { user: { id: 1 } };
		await api.meta.get();
		expect(last?.status).toBe(200);
		expect(last?.data).toEqual({ apiVersion: "0.1.0" });
	});
});

describe("POST install（cdn：Form B 索引解析属市场侧，安装器不拼 URL）", () => {
	it("指定版本：解析 bundles+manifests → runInstall 推进至 done，task 文件全 stage 就位且索引拉取带 no-cache", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id;
		expect(typeof taskId).toBe("string");
		// 索引解析：bundles.yaml + manifests.yaml + 分发包，URL 由 base 归一化拼装
		expect(fetchCalls[0]).toBe(`${CDN}bundles.yaml`);
		expect(fetchCalls).toContain(`${CDN}manifests.yaml`);
		expect(fetchCalls).toContain(`${CDN}demo-solution-0.1.0.tgz`);
		// CDN 拉取禁缓存（索引时效性）
		expect((fetchInits[0] as { headers?: Record<string, string> })?.headers?.["cache-control"]).toBe("no-cache");
		// 后台推进：runInstall 状态机逐 stage 落盘，终态 done + 全 stage 明细
		const rec = await getTask(taskDir, taskId as string);
		expect(rec?.status).toBe("done");
		expect(rec?.stages.map(s => s.stage)).toEqual(STAGE_ORDER);
		expect(rec?.version).toBe("0.1.0");
		expect(rec?.appliedSeq).toBe(3);
	});

	it("version 缺省取 latest（同名只展示最高版本，PRD §5.3）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		expect(fetchCalls).toContain(`${CDN}demo-solution-0.2.0.tgz`);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.version).toBe("0.2.0");
	});

	it("可读失败不崩：source 非法 400 / 未配置市场地址 503 / 索引无此方案 404", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "git" } };
		await api.install.post();
		expect(last?.status).toBe(400);
		const unconfigured = createMarketApi(makeEnv({ cdnBase: async () => null }));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "cdn" } };
		await unconfigured.install.post();
		expect(last?.status).toBe(503);
		expect(String(last?.msg)).toContain("未配置市场地址");
		g.http = { user: { id: 1 }, body: { name: "nope", version: null, source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(404);
	});
});

describe("POST install（file：上传载荷，upload/api.ts 先例双路径）", () => {
	it("multipart 上传 tgz → 验列解包读 manifest（version 由 manifest 兜底）→ runInstall done", async () => {
		const api = createMarketApi(makeEnv());
		g.http = {
			user: { id: 1 },
			body: { name: "demo-solution", version: null, source: "file" },
			files: [{ name: "demo-solution-0.1.0.tgz", content_type: "application/gzip" }],
			file: async () => ARCHIVE,
		};
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		const rec = await getTask(taskDir, taskId);
		expect(rec?.status).toBe("done");
		expect(rec?.version).toBe("0.1.0");
	});

	it("Form A 包（manifest 无 archive 摘要，ojm build --bundle 产物形态）：端点补算 sha256/size 注入 archive → runInstall done（附录 B-10）", async () => {
		const exec: ExecFace = {
			run: async (argv) => {
				if (argv[0] === "tar" && argv[1] === "-tvzf")
					return { code: 0, stdout: "demo-solution-0.1.0/manifest.yaml\ndemo-solution-0.1.0/api/demo-solution-0.1.0/manifest.yaml\ndemo-solution-0.1.0/api/demo-solution-0.1.0/routes.js\ndemo-solution-0.1.0/web/modules/demo-solution/0.1.0/entry.js\n", stderr: "" };
				if (argv[0] === "tar" && argv[1] === "-xzf") {
					// §2.9 单根布局原样解包 + flattenBundleRoot 归平（由 manifestOfUpload 调用）
					const dest = argv[4]!;
					const rootDir = join(dest, "demo-solution-0.1.0");
					await fsp.mkdir(join(rootDir, "api", "demo-solution-0.1.0"), { recursive: true });
					await fsp.mkdir(join(rootDir, "web", "modules", "demo-solution", "0.1.0"), { recursive: true });
					const { archive: _archive, ...formA } = manifestFixture("0.1.0");
					await fsp.writeFile(join(rootDir, "manifest.yaml"), JSON.stringify(formA));
					// oj 原生清单（api 模块目录内，desc === summary，C2-31 消费面）
					await fsp.writeFile(join(rootDir, "api", "demo-solution-0.1.0", "manifest.yaml"), JSON.stringify({ name: "demo-solution", desc: "演示方案", version: "0.1.0" }));
					await fsp.writeFile(join(rootDir, "api", "demo-solution-0.1.0", "routes.js"), "export {};\n");
					await fsp.writeFile(join(rootDir, "web", "modules", "demo-solution", "0.1.0", "entry.js"), ENTRY);
					await fsp.writeFile(join(rootDir, "web", "modules", "demo-solution", "0.1.0", "main.css"), "/* demo */");
					return { code: 0, stdout: "", stderr: "" };
				}
				if (argv[0] === "oj" && argv[1] === "migrate")
					return { code: 0, stdout: `${MIGRATE_LINE}\n`, stderr: "" };
				return { code: 0, stdout: "", stderr: "" };
			},
		};
		const api = createMarketApi(makeEnv({ exec }));
		g.http = {
			user: { id: 1 },
			body: { name: "demo-solution", version: null, source: "file" },
			files: [{ name: "demo-solution-0.1.0.tgz", content_type: "application/gzip" }],
			file: async () => ARCHIVE,
		};
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		const rec = await getTask(taskDir, taskId);
		// verify 段对 injected sha256 fail-closed 复核同批字节（R10 语义保持）→ done
		expect(rec?.status).toBe("done");
		expect(rec?.stages.map(s => s.stage)).toEqual(STAGE_ORDER);
		// 单根归平 + B-11 发布面：lockCommit rename 后版本目录 = api 模块目录（原生清单在根），
		// web 树经 deploying_web 段从 staging 复制进站点 <dist>/modules
		const versionDir = join(root, "modules", "demo-solution-0.1.0");
		expect(await fsp.readFile(join(versionDir, "manifest.yaml"), "utf8")).toContain("demo-solution");
		expect(await fsp.readdir(join(versionDir))).toEqual(["manifest.yaml", "routes.js"]);
		expect(await fsp.readdir(join(siteModulesDir, "demo-solution", "0.1.0"))).toEqual(["entry.js", "main.css"]);
	});

	it("缺文件 → 400 可读失败", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "file" } };
		await api.install.post();
		expect(last?.status).toBe(400);
	});
});

describe("GET task（§10.2 轮询消费面）", () => {
	it("脱敏断言：任务内容写侧已 redact，读侧无秘密可泄；缺 id 400 / 未知 id 404", async () => {
		await writeTask(taskDir, {
			id: "leaky",
			name: "demo-solution",
			version: "0.1.0",
			status: "failed",
			stage: "downloading",
			progress: 10,
			message: "下载失败：https://cdn.example.com/a.tgz?token=secret123",
			stages: [{ stage: "downloading", ok: false, message: "凭证 Bearer abc123xyz 泄漏" }],
			startedAt: 1,
			finishedAt: 2,
			error: { reason: "参数 password=hunter2 泄漏", retryable: true },
		});
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { id: "leaky" } };
		await api.task.get();
		expect(last?.status).toBe(200);
		const raw = JSON.stringify(last?.data);
		expect(raw).not.toContain("secret123");
		expect(raw).not.toContain("abc123xyz");
		expect(raw).not.toContain("hunter2");
		g.http = { user: { id: 1 }, query: {} };
		await api.task.get();
		expect(last?.status).toBe(400);
		g.http = { user: { id: 1 }, query: { id: "nope" } };
		await api.task.get();
		expect(last?.status).toBe(404);
	});
});

describe("POST enable（生命周期开关：P1-13 瘦客户端触发面，四处同写归 setEnabled，D12/AC-P1-6）", () => {
	/** 预置「已装」形态：锁两条目（单条目禁用会触发空锁拒启，S1-1.2）+ sidecar + route 行 + modules.json 条目 + 版本目录 */
	async function seedInstalled(): Promise<void> {
		await writeLock(join(sharedRoot, "manifests.yaml"), { "demo-solution": "0.1.0", "other": "1.0.0" });
		const state = await createStateStore(join(sharedRoot, ".solutions", "state.yaml"));
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1 } } });
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		await fsp.mkdir(dirname(modulesJsonPath), { recursive: true });
		await fsp.writeFile(modulesJsonPath, `${JSON.stringify([{ name: "demo-solution", enabled: true, src: "modules/demo-solution/" }])}\n`);
		dbo.prepare("INSERT INTO sys_solution_route (path, module, category) VALUES (?, ?, ?)").run("/demo-solution", "demo-solution", "main");
	}

	it("禁用再启用：锁摘除/恢复 + sidecar + sys_solution_route + modules.json 四处同写", async () => {
		await seedInstalled();
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", enabled: false } };
		await api.enable.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: true });
		// ① 锁摘除（other 条目保留——空锁拒启防线未被波及）
		expect(await readLock(join(sharedRoot, "manifests.yaml"))).toEqual({ other: "1.0.0" });
		// ② sidecar enabled=false，version 保留（启用恢复依据）
		const state = await createStateStore(join(sharedRoot, ".solutions", "state.yaml"));
		expect(state.read().solutions["demo-solution"]).toMatchObject({ version: "0.1.0", enabled: false });
		// ③ route enabled=0
		expect(dbo.prepare("SELECT enabled FROM sys_solution_route WHERE module = ?").get("demo-solution")).toMatchObject({ enabled: 0 });
		// ④ modules.json enabled=false
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8")) as Array<{ name: string, enabled: boolean }>;
		expect(list[0]).toMatchObject({ name: "demo-solution", enabled: false });
		// 启用：从 sidecar 记录恢复锁条目
		g.http = { user: { id: 1 }, body: { name: "demo-solution", enabled: true } };
		await api.enable.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: true });
		expect(await readLock(join(sharedRoot, "manifests.yaml"))).toEqual({ "demo-solution": "0.1.0", "other": "1.0.0" });
	});

	it("门禁与可读失败：非 superadmin 403；name 缺失/enabled 非布尔 400；未装方案 ok:false 不崩", async () => {
		await seedInstalled();
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 2 }, body: { name: "demo-solution", enabled: false } };
		await api.enable.post();
		expect(last?.status).toBe(403);
		g.http = { user: { id: 1 }, body: { enabled: false } };
		await api.enable.post();
		expect(last?.status).toBe(400);
		g.http = { user: { id: 1 }, body: { name: "demo-solution", enabled: "yes" } };
		await api.enable.post();
		expect(last?.status).toBe(400);
		g.http = { user: { id: 1 }, body: { name: "nope", enabled: false } };
		await api.enable.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: false });
	});
});

describe("GET index（CDN bundles.yaml no-cache 拉取 + 本地 state 对比）", () => {
	it("未配置市场地址 → 503 可读错误（「未配置市场地址」卡片区口径，PRD §5.3）", async () => {
		const api = createMarketApi(makeEnv({ cdnBase: async () => null }));
		await api.index.get();
		expect(last?.status).toBe(503);
		expect(String(last?.msg)).toContain("未配置市场地址");
	});

	it("聚合对比：CDN 最新版本 + 本地已装/enabled + upgradable；本地独有方案也列出；拉取带 no-cache", async () => {
		const env = makeEnv();
		const state = await createStateStore(env.statePath);
		await state.write({
			solutions: {
				"demo-solution": { version: "0.1.0", enabled: true, installedAt: 1 },
				"legacy": { version: "9.9.9", enabled: false, installedAt: 2 },
			},
		});
		const api = createMarketApi(env);
		await api.index.get();
		expect(last?.status).toBe(200);
		expect(fetchCalls[0]).toBe(`${CDN}bundles.yaml`);
		expect((fetchInits[0] as { headers?: Record<string, string> })?.headers?.["cache-control"]).toBe("no-cache");
		expect(last?.data).toEqual([
			{ name: "demo-solution", latest: "0.2.0", installed: "0.1.0", enabled: true, upgradable: true },
			{ name: "wiki", latest: "1.3.0", installed: null, enabled: null, upgradable: false },
			{ name: "legacy", latest: null, installed: "9.9.9", enabled: false, upgradable: false },
		]);
	});

	it("索引不可达 → 502 可读错误不崩", async () => {
		const api = createMarketApi(makeEnv({
			fetch: (async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) })) as FetchFace,
		}));
		await api.index.get();
		expect(last?.status).toBe(502);
	});
});

describe("hostVersions 缺省接线（B-11：C2-09 比对真源 = <dist>/versions.json，ojm 宿主构建产物）", () => {
	it("versionsJsonPathOf 布局推导：modules.json 同目录 versions.json（相对/绝对同构）", () => {
		expect(versionsJsonPathOf("dist/modules.json")).toBe("dist/versions.json");
		expect(versionsJsonPathOf("/site/dist/modules.json")).toBe("/site/dist/versions.json");
		expect(versionsJsonPathOf("modules.json")).toBe("versions.json");
	});

	it("parseVersionsJson：{packageName: version} 全字符串表 → 解析；任何违约（非对象/值非字符串/坏 JSON）→ undefined（fail-closed 不猜）", () => {
		expect(parseVersionsJson(JSON.stringify({ "@oj-module/runtime": "0.1.77", "react": "19.0.0" })))
			.toEqual({ "@oj-module/runtime": "0.1.77", "react": "19.0.0" });
		for (const bad of ["not-json", "[]", "42", JSON.stringify({ react: 19 }), JSON.stringify({ a: null })]) {
			expect(parseVersionsJson(bad)).toBeUndefined();
		}
	});

	it("集成：env 未注入 hostVersions + dist/versions.json 在盘 → install 全链 done（C2-09 比对走缺省真源）", async () => {
		await fsp.mkdir(dirname(modulesJsonPath), { recursive: true });
		await fsp.writeFile(join(dirname(modulesJsonPath), "versions.json"), JSON.stringify({ "@oj-module/runtime": "0.1.77" }));
		const env = makeEnv();
		delete (env as Partial<MarketEnv>).hostVersions;
		const api = createMarketApi(env);
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.status).toBe("done");
	});

	it("集成：versions.json 缺失且未注入 → C2-09 fail-closed，install 终态 failed@preflight", async () => {
		const env = makeEnv();
		delete (env as Partial<MarketEnv>).hostVersions;
		const api = createMarketApi(env);
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		const rec = await getTask(taskDir, taskId);
		expect(rec?.status).toBe("failed");
		expect(rec?.stage).toBe("preflight");
		expect(rec?.stages[0]?.message).toContain("C2-09");
	});
});

describe("P1-16 接线：marketEnv 生产口径 / exec opts 转发 / operator 通道 / 账本真源 / index 即对账入口", () => {
	it("marketEnv() 缺省 = oj serve release 布局：锁与版本目录在 serve 根 dist（B3），versions.json 同根推导（B4）；暂存/任务/sidecar 留根外", () => {
		const env = marketEnv();
		expect(env.sharedRoot).toBe("dist");
		expect(env.siteModulesDir).toBe("dist/modules");
		expect(env.modulesJsonPath).toBe("dist/modules.json");
		expect(versionsJsonPathOf(env.modulesJsonPath)).toBe("dist/versions.json");
		expect(env.staging).toBe("modules/.staging");
		expect(env.taskDir).toBe("modules/.install-tasks");
		expect(env.statePath).toBe("modules/.solutions/state.yaml");
		expect(env.dbPath).toBe("db.sqlite");
		expect(env.apiPrefix).toBe("/api");
	});

	it("平台 exec 包装转发 opts：migrate 段收到 {timeoutMs: 600000}（oj 0.1.78 缺省 30s 会杀长迁移，P1-13c 遗嘱）", async () => {
		const seen: Array<{ argv: string[], opts?: { timeoutMs?: number } }> = [];
		const base = bundleExec();
		const exec: ExecFace = {
			run: (argv, opts) => {
				seen.push({ argv, opts });
				return base.run(argv, opts);
			},
		};
		const api = createMarketApi(makeEnv({ exec }));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.status).toBe("done");
		const mig = seen.find(c => c.argv[0] === "oj" && c.argv[1] === "migrate");
		expect(mig).toBeDefined();
		expect(mig?.opts).toEqual({ timeoutMs: 600000 });
	});

	it("smoke 探针同源补全：http.headers.host 在场时相对探针 URL 按请求源补全为绝对 URL（isolate fetch = deno_fetch 无同源 base，相对恒 TypeError——P1-16 接线④）", async () => {
		const api = createMarketApi(makeEnv({}));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" }, headers: { host: "site.example:9781" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.status).toBe("done");
		// 夹具 manifest 无 health → 探首个非匿名路由 /demo-solution → env.apiPrefix=/api/demo-solution
		// → 相对探针 /api/demo-solution/demo-solution 补全为请求源绝对 URL
		expect(fetchCalls).toContain("http://site.example:9781/api/demo-solution/demo-solution");
		// CDN 拉取（绝对 URL）不受补全影响
		expect(fetchCalls.some(u => u.startsWith("https://cdn.example.com/"))).toBe(true);
	});

	it("ledgerHead 接真源：env.ledgerHeadOf 注入时 migrate 段按其值判禁降版（head 高于目标 seq → 拒切 failed@migrating）", async () => {
		const api = createMarketApi(makeEnv({ ledgerHeadOf: async () => 99 }));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		const rec = await getTask(taskDir, taskId);
		expect(rec?.status).toBe("failed");
		expect(rec?.stage).toBe("migrating");
		expect(rec?.stages.find(s => s.stage === "migrating")?.message).toContain("禁降版");
	});

	it("operator 通道：install/enable 端点按 http.user.id 反查 username 落 market_history（uninstall 同款反查）", async () => {
		dbo.exec(MARKET_HISTORY_DDL);
		// 预置「已装」最小形态（enable 用例同款：单条目禁用会触发空锁拒启，S1-1.2）
		await writeLock(join(sharedRoot, "manifests.yaml"), { "demo-solution": "0.1.0", "other": "1.0.0" });
		const state = await createStateStore(join(sharedRoot, ".solutions", "state.yaml"));
		await state.write({ solutions: { "demo-solution": { version: "0.1.0", enabled: true, installedAt: 1 } } });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		g.http = { user: { id: 1 }, body: { name: "demo-solution", enabled: false } };
		await api.enable.post();
		expect(last?.data).toMatchObject({ ok: true });
		const rows = dbo.prepare("SELECT action, operator FROM market_history ORDER BY rowid").all() as Array<{ action: string, operator: string | null }>;
		expect(rows.find(r => r.action === "install")).toMatchObject({ operator: "admin" });
		expect(rows.find(r => r.action === "disable")).toMatchObject({ operator: "admin" });
	});

	it("index 即对账入口（P1-10 接线③）：M004 分歧（锁指新版、账本 head 落后）经 index 刷新自愈回指旧版", async () => {
		await writeLock(join(sharedRoot, "manifests.yaml"), { "demo-solution": "0.2.0" });
		await fsp.writeFile(`${join(sharedRoot, "manifests.yaml")}.bak`, "demo-solution: 0.1.0\n");
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.2.0"), { recursive: true });
		// oj journal 真源形态：_oj_migrations (module, version, ...)；head=3 < 任务记录 appliedSeq=5
		dbo.exec("CREATE TABLE _oj_migrations (module TEXT NOT NULL, version INTEGER NOT NULL, name TEXT, applied_on TEXT, checksum TEXT, PRIMARY KEY (module, version))");
		dbo.prepare("INSERT INTO _oj_migrations (module, version) VALUES (?, ?)").run("demo-solution", 3);
		await writeTask(taskDir, { id: "t1", name: "demo-solution", version: "0.2.0", status: "done", stage: "done", progress: 100, message: "", stages: [], startedAt: 1, appliedSeq: 5 });
		const api = createMarketApi(makeEnv());
		await api.index.get();
		expect(last?.status).toBe(200);
		expect(await readLock(join(sharedRoot, "manifests.yaml"))).toEqual({ "demo-solution": "0.1.0" });
	});

	it("对账自愈失败降级静默（禁 console——release isolate console 抛 BadResource 会把市场页打 500，Finding A）：index 仍 200", async () => {
		// 锁有条目保证 reconcile 真走到 ledgerHeadOf；注入恒拒 → reconcile 拒约 → reconcileOf 降级
		await writeLock(join(sharedRoot, "manifests.yaml"), { "demo-solution": "0.1.0" });
		await fsp.mkdir(join(sharedRoot, "demo-solution-0.1.0"), { recursive: true });
		const api = createMarketApi(makeEnv({
			ledgerHeadOf: async () => {
				throw new Error("journal 查询炸了");
			},
		}));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await api.index.get();
			expect(last?.status).toBe(200);
			expect(warn).not.toHaveBeenCalled();
		}
		finally {
			warn.mockRestore();
		}
	});
});
