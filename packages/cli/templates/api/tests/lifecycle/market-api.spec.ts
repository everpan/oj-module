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
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStateStore } from "../../src/_platform/_lifecycle/state";
import { getTask, writeTask } from "../../src/_platform/_lifecycle/tasks";
import { invalidateAllUsers } from "../../src/_platform/_shared/service/access";
import { createMarketApi } from "../../src/_platform/market/api";
import { installDb } from "../fixture";

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
let dataDir: string;
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

/** bundle exec stub：tar list 返回 verbose listing、tar extract 写出全量 manifest 夹具（端点要真解析）、oj migrate 返回 S1-6 合同 JSON */
function bundleExec(): ExecFace {
	return {
		run: async (argv) => {
			if (argv[0] === "tar" && argv[1] === "-tvzf") {
				const v = /demo-solution-([\w.-]+)\.tgz$/.exec(argv[2] ?? "")?.[1] ?? "0.1.0";
				return { code: 0, stdout: `manifest.yaml\nweb/modules/demo-solution/${v}/entry.js\nweb/modules/demo-solution/${v}/main.css\n`, stderr: "" };
			}
			if (argv[0] === "tar" && argv[1] === "-xzf") {
				const v = /demo-solution-([\w.-]+)\.tgz$/.exec(argv[2] ?? "")?.[1] ?? "0.1.0";
				const dest = argv[4]!;
				const dir = join(dest, "web", "modules", "demo-solution", v);
				await fsp.mkdir(dir, { recursive: true });
				await fsp.writeFile(join(dest, "manifest.yaml"), JSON.stringify(manifestFixture(v)));
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
	reloadConfig: async () => ({ generation: 1, unchanged: false, applied: ["mounts"], restart_pending: [], kept_listener: [] }),
};

function makeEnv(overrides: Partial<MarketEnv> = {}): MarketEnv {
	return {
		sharedRoot,
		staging,
		taskDir,
		statePath: join(sharedRoot, ".solutions", "state.yaml"),
		dataDir,
		dbPath,
		siteModulesDir,
		modulesJsonPath,
		apiPrefix: "/api/demo-solution",
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
	dataDir = root;
	dbPath = join(root, "db.sqlite");
	await fsp.writeFile(dbPath, new TextEncoder().encode("sqlite-header\n"));
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
