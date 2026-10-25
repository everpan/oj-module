// BDD：编排端点 + 市场索引（P1-12，R9/ISP）。
// 四端点同挂 _platform/market 组（oj v0.1.64 嵌套 handler 组，notification/api.ts 同形态）：
//   POST /api/_platform/market/install   superadmin——runInstall 编排（端点不重复编排，P1-10 状态机负责推进）
//   GET  /api/_platform/market/task?id=  superadmin——任务轮询消费面（§10.2；内容写侧已脱敏，读侧无秘密可泄）
//   GET  /api/_platform/market/meta      登录即可——{apiVersion}（peerPlatform 预检）
//   GET  /api/_platform/market/index     superadmin——CDN 三级索引（catalog.yaml + shards/<n>.yaml，ETag/If-None-Match 条件请求）+ 本地 state 对比
// 简报 `task/:id` 段参数形态在模板 http 面无先例（contacts/detail?id= 同款 query 惯例），备案于任务报告。
// 步骤面全 stub 注入（DIP）：fetch/exec/reload 不真跑；register/smoke/audit 走真实内存库夹具。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（installer.spec 同约定） */
import type { FsFace } from "../../src/_platform/api/_lifecycle/atomic";
import type { FetchFace } from "../../src/_platform/api/_lifecycle/steps/download";
import type { ExecFace } from "../../src/_platform/api/_lifecycle/steps/extract";
import type { ReloadFace } from "../../src/_platform/api/_lifecycle/steps/reload";
import type { MarketEnv } from "../../src/_platform/api/market/api";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { defaultTestKey, nodeVerifyEd25519, signedArchiveFor } from "../../../src/lifecycle/__tests__/helpers";
import { signIndex } from "../../../src/publish";
import { readLock, writeLock } from "../../src/_platform/api/_lifecycle/lock";
import { compareVersions } from "../../src/_platform/api/_lifecycle/semver";
import { createStateStore } from "../../src/_platform/api/_lifecycle/state";
import { getTask, writeTask } from "../../src/_platform/api/_lifecycle/tasks";
import { createTrustStore } from "../../src/_platform/api/_lifecycle/trust";
import { invalidateAllUsers } from "../../src/_platform/api/_shared/service/infra/access";
import { createMarketApi, marketEnv, parseVersionsJson, versionsJsonPathOf } from "../../src/_platform/api/market/api";
import { localIndexSource } from "../../src/_platform/api/market/index-source";
import { installDb } from "../fixture";

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++)
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

const g = globalThis as any;

const ARCHIVE = new TextEncoder().encode("demo-archive-bytes\n");
const SHA256 = createHash("sha256").update(ARCHIVE).digest("hex");
/** 共享测试 key（P2-3：Form B 签名与信任库播种同一把；无私钥入仓） */
const TEST_KEY = defaultTestKey();
/** file 源签名侧车载荷（JSON .sig 文本字节） */
const SIG_BYTES = new TextEncoder().encode(JSON.stringify(signedArchiveFor(ARCHIVE, "demo-solution", "0.1.0", { keyPair: TEST_KEY }).sig));
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
		author: "oj-module",
		changelog: [`${version} 变更条目`],
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

/** REG-CS2 时效：签发时刻与失效时刻（epoch 秒；用例里取「刚签发」以免被判过期） */
const ISSUED_AT = Math.floor(Date.now() / 1000);
const EXPIRES_AT = ISSUED_AT + 7 * 24 * 60 * 60;

/**
 * Form B 三级索引夹具（REG-CS5：catalog + shards）。JSON 序列充当 yaml.parse 全局的载荷——
 *  解析面是 oj 全局，端点只管喂文本取对象。catalog 只记「包名 → 分片号」无版本明细。
 */
const CATALOG = JSON.stringify({
	// REG-CS1/CS2：catalog = 代次与时效真源，所有索引签名必须与它同代
	seq: 1,
	issued_at: ISSUED_AT,
	expires_at: EXPIRES_AT,
	generated_at: "2026-10-17T00:00:00Z",
	cdn: CDN,
	// 片号 → 代次钉值（REG-CS1③：分片签名 seq 必须等于钉值；byte 相同的分片可跨代复用）
	shards: { 1: 1 },
	// 包名 → 分片号（无版本明细；版本明细在分片里）
	solutions: [
		{ name: "demo-solution", shards: [1] },
		{ name: "wiki", shards: [1] },
	],
});
/** 分片正文（纯内容无 meta：版本条目即 Form B manifest——原 manifests.yaml 聚合清单并入分片） */
const SHARD_1 = JSON.stringify({
	solutions: [
		{ name: "demo-solution", latest: "0.2.0", versions: [manifestFixture("0.2.0"), manifestFixture("0.1.0")] },
		{ name: "wiki", latest: "1.3.0", versions: [{ name: "wiki", version: "1.3.0", archive: { file: "wiki-1.3.0.tgz", sha256: "x", size: 1 } }] },
	],
});

/** 基线代次 */
const SEQ = 1;
/** 索引签名（REG-CS1：签名覆盖 (kind, seq)——换 kind 或换代都验不过） */
const CATALOG_SIG = JSON.stringify(signIndex("catalog", SEQ, CATALOG, TEST_KEY.privateKeyPem, "test.publisher"));
const SHARD_1_SIG = JSON.stringify(signIndex("shard", 1, SHARD_1, TEST_KEY.privateKeyPem, "test.publisher"));

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
	// 基线 CDN 已签名（REG-CS1：缺签名即拒，故所有「正常路径」夹具都必须带 .sig）。
	// .sig 判定先行：`catalog.yaml.sig` 也以 `.yaml` 结尾，顺序反了会把签名当正文。
	if (url.endsWith("catalog.yaml.sig"))
		return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(CATALOG_SIG).buffer as ArrayBuffer };
	if (url.endsWith("shards/1.yaml.sig"))
		return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(SHARD_1_SIG).buffer as ArrayBuffer };
	const text = url.endsWith("catalog.yaml")
		? CATALOG
		: url.endsWith("shards/1.yaml")
			? SHARD_1
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
		trustPath: join(sharedRoot, ".solutions", "trusted-keys.yaml"),
		dbPath,
		siteModulesDir,
		modulesJsonPath,
		apiPrefix: "/api/demo-solution",
		configPath: join(root, "config.yaml"),
		// REG-CS6：安装全程需 canonical origin（相对基址补全 + 冒烟探针 URL 恒相对）。生产由
		// config.yaml vars.canonical_origin 供给；此处给固定值让既有安装用例不受缺失影响，
		// 缺失/非法的专门用例显式覆盖为 undefined。
		canonicalOrigin: "http://127.0.0.1:9778",
		cdnBase: async () => CDN,
		fetch: cdnFetch,
		exec: bundleExec(),
		reload: reloadStub,
		sha256Hex: d => createHash("sha256").update(d).digest("hex"),
		verifyEd25519: nodeVerifyEd25519,
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
	await fsp.writeFile(join(root, "config.yaml"), "mounts: []\nserver:\n  reload_api: true\nvars:\n  ojm_install_seq: 0\nauth:\n  anonymous_paths:\n    - /auth/login\n");
	g.fs = nodeFsFace();
	dbo = installDb();
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
	// 播种信任库（P2-3：Form B 签名夹具同一把 TEST_KEY；走真实 store）
	await createTrustStore(join(sharedRoot, ".solutions", "trusted-keys.yaml"), { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).add("test.publisher", TEST_KEY.publicKeyHex);
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

	it("pair-pin：meta apiVersion === _platform/manifest.yaml version（手工镜像漂移防护，P2-9）", async () => {
		// API_VERSION（market/api.ts）与 _platform/manifest.yaml version 为手工同步的双真源；
		// 本测试经 meta 端点间接钉住 API_VERSION，漂移即红（peerPlatform 预检口径失真）。
		const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "../../src/_platform/api/manifest.yaml");
		const manifestVersion = (parse(readFileSync(manifestPath, "utf8")) as { version: string }).version;
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 } };
		await api.meta.get();
		expect((last?.data as { apiVersion?: string })?.apiVersion).toBe(manifestVersion);
	});
});

describe("POST install（cdn：Form B 索引解析属市场侧，安装器不拼 URL）", () => {
	it("指定版本：解析 catalog+shard → runInstall 推进至 done，task 文件全 stage 就位且索引拉取不带 no-cache", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id;
		expect(typeof taskId).toBe("string");
		// 索引解析：catalog.yaml + shards/1.yaml + 分发包，URL 由 base 归一化拼装
		expect(fetchCalls[0]).toBe(`${CDN}catalog.yaml`);
		expect(fetchCalls).toContain(`${CDN}shards/1.yaml`);
		expect(fetchCalls).toContain(`${CDN}demo-solution-0.1.0.tgz`);
		// REG-CS5④：读面不再发 cache-control: no-cache——新鲜度由服务端 max-age=60,
		// stale-while-revalidate=60 + ETag/If-None-Match 条件请求承载（Q8）
		expect(fetchInits.every(i => (i as { headers?: Record<string, string> } | undefined)?.headers?.["cache-control"] === undefined)).toBe(true);
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

describe("REG-CS4 yank（安装侧精确版本拒装）", () => {
	/** 带 yanked 标记的三级索引：0.2.0 被下线、0.1.0 正常；latest 已被源方改为 0.1.0 */
	function yankedCdnFetch(): FetchFace {
		const catalog = JSON.stringify({
			seq: 1,
			issued_at: ISSUED_AT,
			expires_at: EXPIRES_AT,
			shards: { 1: 1 },
			solutions: [{ name: "demo-solution", shards: [1] }],
		});
		const shard = JSON.stringify({
			solutions: [{
				name: "demo-solution",
				latest: "0.1.0",
				versions: [
					{ ...manifestFixture("0.2.0"), yanked: true, yanked_at: ISSUED_AT },
					manifestFixture("0.1.0"),
				],
			}],
		});
		const catalogSig = JSON.stringify(signIndex("catalog", SEQ, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
		const shardSig = JSON.stringify(signIndex("shard", 1, shard, TEST_KEY.privateKeyPem, "test.publisher"));
		return ((url: string) => {
			const text = String(url).endsWith("catalog.yaml")
				? catalog
				: String(url).endsWith("shards/1.yaml") ? shard : null;
			if (text !== null)
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
			if (String(url).endsWith(".yaml.sig")) {
				const sig = String(url).includes("shards") ? shardSig : catalogSig;
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer };
			}
			if (String(url).endsWith(".tgz"))
				return { ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer as ArrayBuffer };
			return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
		}) as FetchFace;
	}

	it("精确安装被下线版本 → 409 拒装（含「下线」人话），不触碰 .tgz", async () => {
		const api = createMarketApi(makeEnv({ fetch: yankedCdnFetch() }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.2.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(409);
		expect(String(last?.msg)).toContain("下线");
		expect(fetchCalls.some(u => u.endsWith(".tgz"))).toBe(false);
	});

	it("latest 路径不命中 yanked（源方已把 latest 改为未下线版本）→ 正常装 0.1.0", async () => {
		const api = createMarketApi(makeEnv({ fetch: yankedCdnFetch() }));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.version).toBe("0.1.0");
	});
});

describe("相对基址（REG-CS6：/cdn 自供按配置的 canonical_origin 补全，绝不读请求 Host 头防 SSRF）", () => {
	const REL = "/cdn";
	const FORGED = "169.254.169.254"; // 伪造 Host（云元数据 IP）——绝不可牵引出站
	const relEnv = (overrides: Partial<MarketEnv> = {}) => makeEnv({ cdnBase: async () => REL, ...overrides });

	it("自供回归：canonical_origin 配置 → 相对 /cdn URL 按配置 origin 补全绝对 URL（非 Host 头）", async () => {
		const api = createMarketApi(relEnv({ canonicalOrigin: "http://127.0.0.1:5174" }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" }, headers: { host: FORGED } };
		await api.install.post();
		expect(last?.status).toBe(200);
		// 按配置的 canonical origin 补全，而非伪造 Host 头
		expect(fetchCalls).toContain("http://127.0.0.1:5174/cdn/demo-solution-0.1.0.tgz");
		expect(fetchCalls.some(u => String(u).includes(FORGED))).toBe(false);
	});

	it("index：canonical_origin 配置 → 索引与分片拉取按配置 origin 补全（非 Host 头）", async () => {
		const api = createMarketApi(relEnv({ canonicalOrigin: "http://127.0.0.1:5174" }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, headers: { host: FORGED } };
		await api.index.get();
		expect(last?.status).toBe(200);
		expect(fetchCalls).toContain("http://127.0.0.1:5174/cdn/catalog.yaml");
		expect(fetchCalls).toContain("http://127.0.0.1:5174/cdn/shards/1.yaml");
		expect(fetchCalls.some(u => String(u).includes(FORGED))).toBe(false);
	});

	it("index：canonical_origin 缺失 + 相对基址 → 明确报错指向 vars.canonical_origin（不回落 Host）", async () => {
		const api = createMarketApi(relEnv({ canonicalOrigin: undefined }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, headers: { host: FORGED } };
		await api.index.get();
		expect(last?.status).toBe(503);
		expect(last?.msg).toContain("vars.canonical_origin");
		// 未发起任何出站；伪造 Host 头绝不被采用
		expect(fetchCalls.length).toBe(0);
		expect(fetchCalls.some(u => String(u).includes(FORGED))).toBe(false);
	});

	it("install：canonical_origin 非法（ftp://）→ 明确报错指向 vars.canonical_origin", async () => {
		const api = createMarketApi(relEnv({ canonicalOrigin: "ftp://nope" }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" }, headers: { host: FORGED } };
		await api.install.post();
		expect(last?.status).toBe(503);
		expect(last?.msg).toContain("vars.canonical_origin");
		expect(fetchCalls.length).toBe(0);
	});

	it("install：canonical_origin 缺失（冒烟探针 URL 恒相对）→ 明确报错指向 vars.canonical_origin", async () => {
		// 绝对基址（外部 CDN）也要 canonical origin——冒烟探针 URL 恒为站点相对路径
		const api = createMarketApi(makeEnv({ canonicalOrigin: undefined }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" }, headers: { host: FORGED } };
		await api.install.post();
		expect(last?.status).toBe(503);
		expect(last?.msg).toContain("vars.canonical_origin");
		expect(fetchCalls.length).toBe(0);
	});

	it("绝对基址（外部 CDN）index + canonical_origin 缺失 → 无需 origin，索引照常", async () => {
		const api = createMarketApi(makeEnv({ canonicalOrigin: undefined }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, headers: { host: FORGED } };
		await api.index.get();
		expect(last?.status).toBe(200);
		expect(fetchCalls).toContain(`${CDN}catalog.yaml`);
		expect(fetchCalls.some(u => String(u).includes(FORGED))).toBe(false);
	});
});

describe("POST install/cancel（P3-12 端点接线，U5/P3-8 令牌的消费面）", () => {
	it("无进行中安装 → 404（取消只对 running 态有效，任务终态后信号已注销）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution" } };
		await api.install.cancel.post();
		expect(last?.status).toBe(404);
	});

	it("进行中（extracting 段门控阻塞）→ cancel 200 置位旗标 → install 终态 failed+cancelled、staging 清场", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const base = bundleExec(); // tar 真写出 §2.9 产物树（extract 复核不误报失败）
		const api = createMarketApi(makeEnv({
			exec: {
				run: async (argv) => {
					if (argv[0] === "tar" && argv[1] === "-xzf")
						await gate; // extracting 段阻塞——模拟长安装窗口，取消旗标在途置位
					return await base.run(argv);
				},
			},
		}));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		const running = api.install.post(); // 不 await——在途安装
		await vi.waitFor(async () => {
			// 任务文件可见（preflight 段已落盘）即可取消——不必等特定 stage
			expect((await fsp.readdir(taskDir)).filter(f => f.endsWith(".json")).length).toBeGreaterThan(0);
		});
		g.http = { user: { id: 1 }, body: { name: "demo-solution" } };
		await api.install.cancel.post();
		expect(last?.status).toBe(200);
		expect((last?.data as { ok?: boolean })?.ok).toBe(true);
		release(); // 放行 extract → 下一段间探测命中旗标 → h.kill 语义（未进 migrate 即回退）
		await running;
		// 终态断言读最后落盘的任务记录（respond 互斥写 last，此处绕开）
		const id = (await fsp.readdir(taskDir)).find(f => f.endsWith(".json"))!;
		const rec = await getTask(taskDir, id.replace(/\.json$/, ""));
		expect(rec?.status).toBe("failed");
		expect(rec?.cancelled).toBe(true);
		// 清场：staging 回退装前（D11①锁前语义）
		await expect(fsp.access(staging)).rejects.toThrow();
	});
});

describe("POST install（file：上传载荷，upload/api.ts 先例双路径）", () => {
	it("multipart 上传 tgz → 验列解包读 manifest（version 由 manifest 兜底）→ runInstall done", async () => {
		const api = createMarketApi(makeEnv());
		g.http = {
			user: { id: 1 },
			body: { name: "demo-solution", version: null, source: "file" },
			files: [{ name: "demo-solution-0.1.0.tgz", content_type: "application/gzip" }, { name: "demo-solution-0.1.0.tgz.sig", content_type: "application/json" }],
			file: async (i: number) => (i === 0 ? ARCHIVE : SIG_BYTES),
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
			files: [{ name: "demo-solution-0.1.0.tgz", content_type: "application/gzip" }, { name: "demo-solution-0.1.0.tgz.sig", content_type: "application/json" }],
			file: async (i: number) => (i === 0 ? ARCHIVE : SIG_BYTES),
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

	it("file 源缺 .sig 侧车 → runInstall 终态 failed@verifying code=sig_missing（G4 硬 fail-closed，无逃生门）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = {
			user: { id: 1 },
			body: { name: "demo-solution", version: null, source: "file" },
			files: [{ name: "demo-solution-0.1.0.tgz", content_type: "application/gzip" }],
			file: async () => ARCHIVE,
		};
		await api.install.post();
		expect(last?.status).toBe(200); // 编排返回任务 id（失败在任务终态，人话在任务记录）
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		const rec = await getTask(taskDir, taskId);
		expect(rec?.status).toBe("failed");
		expect(rec?.stage).toBe("verifying");
		expect(rec?.error?.hintKey).toBe("lifecycle.stage.verifying.sig_missing");
		expect(rec?.stages.find(s => s.stage === "verifying")?.message).toContain("sig_missing");
		// 锁前清场（失败语义①）：staging 删、锁/库表零改
		await expect(fsp.access(staging)).rejects.toThrow();
		await expect(fsp.access(join(sharedRoot, "manifests.yaml"))).rejects.toThrow();
	});

	it(".sig 非 JSON → 400 可读失败（不进安装器）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = {
			user: { id: 1 },
			body: { name: "demo-solution", version: null, source: "file" },
			files: [{ name: "demo-solution-0.1.0.tgz", content_type: "application/gzip" }, { name: "x.sig", content_type: "application/json" }],
			file: async (i: number) => (i === 0 ? ARCHIVE : new TextEncoder().encode("not json")),
		};
		await api.install.post();
		expect(last?.status).toBe(400);
		expect(String(last?.msg)).toContain("不是合法 JSON");
	});
});

describe("POST /market/trust {task_id}（P2-3 TOFU 确认：混淆代理防线）", () => {
	async function seedNeedsTrust(keyId: string, publicKey: string, fingerprint?: string): Promise<string> {
		const id = `install-${Date.now()}-confirm`;
		await writeTask(taskDir, {
			id,
			name: "demo-solution",
			version: "0.1.0",
			status: "needs_trust",
			stage: "verifying",
			progress: 30,
			message: "待信任确认",
			stages: [],
			trust: { key_id: keyId, public_key: publicKey, fingerprint: fingerprint ?? createHash("sha256").update(hexToBytes(publicKey)).digest("hex") },
			startedAt: Date.now(),
			finishedAt: Date.now(),
		});
		return id;
	}

	it("确认成功：任务 needs_trust → 指纹复算一致 → 入信任库 added", async () => {
		const api = createMarketApi(makeEnv());
		const { generateKeyPair } = await import("../../../src/lifecycle/keygen");
		const kp = generateKeyPair();
		const id = await seedNeedsTrust("stranger.pub", kp.publicKeyHex);
		g.http = { user: { id: 1 }, body: { task_id: id } };
		await api.trust.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ result: "added", key_id: "stranger.pub" });
		// 信任库真落库
		const keys = await createTrustStore(join(sharedRoot, ".solutions", "trusted-keys.yaml")).list();
		expect(keys.map(k => k.key_id)).toContain("stranger.pub");
		// 审计留痕（operator=admin，fire-and-forget 等一拍）
		await new Promise(r => setTimeout(r, 20));
		const oplog = dbo.prepare("select action, target from sys_oplog where action = 'solution.trust.add'").all();
		expect(oplog).toHaveLength(1);
	});

	it("门与形态：非 superadmin 403；缺 task_id 400；任务不存在 404；非 needs_trust 409", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 2 }, body: { task_id: "x" } };
		await api.trust.post();
		expect(last?.status).toBe(403);
		g.http = { user: { id: 1 }, body: {} };
		await api.trust.post();
		expect(last?.status).toBe(400);
		g.http = { user: { id: 1 }, body: { task_id: "install-1-nope" } };
		await api.trust.post();
		expect(last?.status).toBe(404);
		// done 任务无需确认
		await writeTask(taskDir, { id: "done-1", name: "d", version: "1.0.0", status: "done", stage: "done", progress: 100, message: "x", stages: [], startedAt: 1, finishedAt: 2 });
		g.http = { user: { id: 1 }, body: { task_id: "done-1" } };
		await api.trust.post();
		expect(last?.status).toBe(409);
	});

	it("混淆代理：任务记录指纹与公钥不符 → 409 拒，信任库零变化", async () => {
		const api = createMarketApi(makeEnv());
		const { generateKeyPair } = await import("../../../src/lifecycle/keygen");
		const kp = generateKeyPair();
		const id = await seedNeedsTrust("stranger.pub", kp.publicKeyHex, "f".repeat(64)); // 指纹造假
		g.http = { user: { id: 1 }, body: { task_id: id } };
		await api.trust.post();
		expect(last?.status).toBe(409);
		expect(String(last?.msg)).toContain("篡改");
		const keys = await createTrustStore(join(sharedRoot, ".solutions", "trusted-keys.yaml")).list();
		expect(keys.map(k => k.key_id)).not.toContain("stranger.pub");
	});

	it("撞绑定：key_id 已绑其他公钥 → 409 trust_bound_mismatch，库内不动", async () => {
		const api = createMarketApi(makeEnv());
		const { generateKeyPair } = await import("../../../src/lifecycle/keygen");
		const kp = generateKeyPair();
		const id = await seedNeedsTrust("test.publisher", kp.publicKeyHex); // 已播种的 key_id
		g.http = { user: { id: 1 }, body: { task_id: id } };
		await api.trust.post();
		expect(last?.status).toBe(409);
		expect(String(last?.msg)).toContain("首次绑定不可改");
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

describe("GET index（CDN catalog + shards 拉取 + 本地 state 对比）", () => {
	it("未配置市场地址 → 503 可读错误（「未配置市场地址」卡片区口径，PRD §5.3）", async () => {
		const api = createMarketApi(makeEnv({ cdnBase: async () => null }));
		await api.index.get();
		expect(last?.status).toBe(503);
		expect(String(last?.msg)).toContain("未配置市场地址");
	});

	it("聚合对比：CDN 最新版本 + 本地已装/enabled + upgradable + available/changelog/publisher/trust/key_id/operator（P2-11）；本地独有方案也列出；拉取不带 no-cache", async () => {
		const env = makeEnv();
		const state = await createStateStore(env.statePath);
		await state.write({
			solutions: {
				"demo-solution": { version: "0.1.0", enabled: true, installedAt: 1, trust_state: "trusted", archive: { sha256: "a", key_id: "test.publisher", signature: {} } },
				"legacy": { version: "9.9.9", enabled: false, installedAt: 2 },
			},
		});
		const api = createMarketApi(env);
		await api.index.get();
		expect(last?.status).toBe(200);
		expect(fetchCalls[0]).toBe(`${CDN}catalog.yaml`);
		// REG-CS5④：读面不再发 cache-control: no-cache（服务端缓存头 + 条件请求承载新鲜度）
		expect(fetchInits.every(i => (i as { headers?: Record<string, string> } | undefined)?.headers?.["cache-control"] === undefined)).toBe(true);
		expect(last?.data).toEqual([
			{ name: "demo-solution", latest: "0.2.0", installed: "0.1.0", enabled: true, upgradable: true, available: ["0.1.0", "0.2.0"], changelog: ["0.2.0 变更条目"], publisher: "oj-module", trust_state: "trusted", key_id: "test.publisher", operator: null },
			{ name: "wiki", latest: "1.3.0", installed: null, enabled: null, upgradable: false, available: ["1.3.0"], changelog: null, publisher: null, trust_state: null, key_id: null, operator: null },
			{ name: "legacy", latest: null, installed: "9.9.9", enabled: false, upgradable: false, available: [], changelog: null, publisher: null, trust_state: null, key_id: null, operator: null },
		]);
	});

	it("operator 回落 history 行（P2-11：最近一次 install 动作的 operator；表缺失/无行 → null 不炸）", async () => {
		dbo.prepare("insert into market_history (solution, version, action, status, operator, message, created_at) values (?, ?, ?, ?, ?, ?, ?)")
			.run("demo-solution", "0.1.0", "install", "done", "alice", "", 1700000000);
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(200);
		const rows = last?.data as Array<{ name: string, operator: string | null }>;
		expect(rows.find(r => r.name === "demo-solution")?.operator).toBe("alice");
		expect(rows.find(r => r.name === "wiki")?.operator).toBeNull();
	});

	it("shards/1.yaml 签名不可达 → 502 index_sig_missing 不降级（REG-CS1 fail-closed：可用性不再压过完整性）", async () => {
		const fetchFn = (async (url: string) => {
			if (String(url).endsWith("shards/1.yaml.sig"))
				return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
			return cdnFetch(url);
		}) as FetchFace;
		const api = createMarketApi(makeEnv({ fetch: fetchFn }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_sig_missing");
	});

	it("P2-12 bootstrap key（G3 双轨第一轨）：信任库为空 + bootstrapKey 注入 → cdn 首装直达 done 不落 needs_trust", async () => {
		await fsp.rm(join(sharedRoot, ".solutions", "trusted-keys.yaml"), { force: true }); // beforeEach 已播种，删库文件模拟全新站点
		const env = makeEnv({ bootstrapKey: { key_id: "test.publisher", public_key: TEST_KEY.publicKeyHex } });
		const api = createMarketApi(env);
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		const rec = await getTask(taskDir, taskId);
		expect(rec?.status).toBe("done"); // 免 TOFU 直接过验签
		// 播种落库可读
		expect(await createTrustStore(join(sharedRoot, ".solutions", "trusted-keys.yaml")).get("test.publisher")).toBe(TEST_KEY.publicKeyHex);
	});

	it("P2-12：无 bootstrapKey（内置未回填口径）+ 信任库为空 → needs_trust（双轨第二轨 TOFU 不失守）", async () => {
		await fsp.rm(join(sharedRoot, ".solutions", "trusted-keys.yaml"), { force: true });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.status).toBe("needs_trust");
	});

	it("archive.file 邪例表（P2-11 索引投毒加固：file 逐字 <name>-<version>.tgz）→ 502 拒", async () => {
		for (const file of ["../evil.tgz", "/etc/hosts.tgz", "other-0.1.0.tgz", "demo-solution-9.9.9.tgz"]) {
			const catalog = JSON.stringify({ seq: 1, issued_at: ISSUED_AT, expires_at: EXPIRES_AT, shards: { 1: 1 }, solutions: [{ name: "demo-solution", shards: [1] }] });
			const base = manifestFixture("0.1.0");
			const shard = JSON.stringify({ solutions: [{ name: "demo-solution", latest: "0.1.0", versions: [{ ...base, archive: { ...base.archive, file } }] }] });
			// 本用例聚焦 file 逐字校验：索引照常签名，否则会先被「缺签名」挡下而测不到 file 分支
			const catalogSig = JSON.stringify(signIndex("catalog", 1, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
			const shardSig = JSON.stringify(signIndex("shard", 1, shard, TEST_KEY.privateKeyPem, "test.publisher"));
			const fetchFn = (async (url: string) => {
				const text = String(url).endsWith("catalog.yaml") ? catalog : String(url).endsWith("shards/1.yaml") ? shard : null;
				if (text !== null)
					return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
				if (String(url).endsWith(".yaml.sig")) {
					const sig = String(url).includes("shards") ? shardSig : catalogSig;
					return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer };
				}
				return { ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer as ArrayBuffer }; // .tgz 下载字节
			}) as FetchFace;
			const api = createMarketApi(makeEnv({ fetch: fetchFn }));
			g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
			await api.install.post();
			expect(last?.status, `file=${file}`).toBe(502);
			expect(String(last?.msg), `file=${file}`).toContain("逐字");
		}
	});

	it("索引不可达 → 502 可读错误不崩", async () => {
		const api = createMarketApi(makeEnv({
			fetch: (async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) })) as FetchFace,
		}));
		await api.index.get();
		expect(last?.status).toBe(502);
	});
});

describe("REG-CS1 索引签名强制（G4 fail-closed：署名相符采用 / 篡改拒 / 缺失即拒 / 不同代即拒）", () => {
	/** 注入 .sig 的三级 CDN：非空 .sig 进验签分支；缺/空 .sig → 404（REG-CS1 起即拒，不再容忍） */
	function signingCdnFetch(sigs: { catalog?: string, shard?: string }): FetchFace {
		return ((url: string, init?: unknown) => {
			fetchCalls.push(url);
			fetchInits.push(init);
			if (String(url).endsWith(".yaml.sig")) {
				const kind = String(url).includes("shards") ? "shard" : "catalog";
				const body = sigs[kind];
				if (body !== undefined && body.trim() !== "")
					return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer };
				return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; // 缺失/空 .sig
			}
			const text = String(url).endsWith("catalog.yaml")
				? CATALOG
				: String(url).endsWith("shards/1.yaml") ? SHARD_1 : null;
			if (text !== null)
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
			if (String(url).endsWith(".tgz"))
				return { ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer as ArrayBuffer };
			return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
		}) as FetchFace;
	}

	/**
	 * 代次可配的三级 CDN：catalog 正文 seq、catalog 签名 seq、catalog 对 shard 1 的钉值、
	 * shard 1 签名 seq 分别可设——用来造「新总目录 + 旧分片」「改了正文没换签名」等中间态。
	 * 分片正文恒为 SHARD_1（纯内容无 seq：代次只由签名与 catalog 钉值携带）。
	 */
	function generationCdnFetch(args: { catalogSeq: number, shardPin: number, shardSigSeq: number }): FetchFace {
		const catalog = JSON.stringify({ seq: args.catalogSeq, issued_at: ISSUED_AT, expires_at: EXPIRES_AT, shards: { 1: args.shardPin }, solutions: [{ name: "demo-solution", shards: [1] }] });
		const catalogSig = JSON.stringify(signIndex("catalog", args.catalogSeq, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
		const shardSig = JSON.stringify(signIndex("shard", args.shardSigSeq, SHARD_1, TEST_KEY.privateKeyPem, "test.publisher"));
		return ((url: string) => {
			fetchCalls.push(url);
			if (String(url).endsWith(".yaml.sig")) {
				const sig = String(url).includes("shards") ? shardSig : catalogSig;
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer };
			}
			const text = String(url).endsWith("catalog.yaml") ? catalog : String(url).endsWith("shards/1.yaml") ? SHARD_1 : null;
			if (text !== null)
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
			if (String(url).endsWith(".tgz"))
				return { ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer as ArrayBuffer };
			return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
		}) as FetchFace;
	}

	it("署名相符：catalog/shard 均带合法 .sig → index 照常 200（G4 采用，验签分支确已触发）", async () => {
		const api = createMarketApi(makeEnv({ fetch: signingCdnFetch({ catalog: CATALOG_SIG, shard: SHARD_1_SIG }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(200);
		expect((last?.data as unknown[]).length).toBeGreaterThan(0);
		expect(fetchCalls.some(u => u.endsWith("catalog.yaml.sig"))).toBe(true);
		expect(fetchCalls.some(u => u.endsWith("shards/1.yaml.sig"))).toBe(true);
	});

	it("篡改拒：catalog .sig 对别的字节签名（非索引真值）→ verifyIndexSig 不符 → 502 fail-closed（G4 不吞）", async () => {
		const catalogSig = JSON.stringify(signIndex("catalog", SEQ, `${CATALOG}\n# tampered`, TEST_KEY.privateKeyPem, "test.publisher"));
		const api = createMarketApi(makeEnv({ fetch: signingCdnFetch({ catalog: catalogSig, shard: SHARD_1_SIG }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_sig_mismatch");
	});

	it("缺失即拒：CDN 不回 .sig → 502 index_sig_missing（不再「滚动发布期容忍」）＋两步补签提示", async () => {
		const api = createMarketApi(makeEnv({ fetch: signingCdnFetch({}) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_sig_missing");
		expect(String(last?.msg)).toContain("ojm market build-index");
		expect(String(last?.msg)).toContain("ojm publish");
	});

	it("空 .sig 等同缺失 → 502 index_sig_missing（不能靠空体绕过）", async () => {
		const api = createMarketApi(makeEnv({ fetch: signingCdnFetch({ catalog: "   ", shard: "   " }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_sig_missing");
	});

	it("签名未覆盖代次（旧格式无 seq）→ 502 index_sig_mismatch（不默认通过）", async () => {
		const legacy = JSON.stringify({ alg: "Ed25519", key_id: "test.publisher", public_key: TEST_KEY.publicKeyHex, value: "AAAA", canon: "v1" });
		const api = createMarketApi(makeEnv({ fetch: signingCdnFetch({ catalog: legacy, shard: legacy }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_sig_mismatch");
	});

	it("跨文件不同代（红队 F2）：总目录第 7 代钉 shard 7、分片签名第 6 代 → 502 index_generation_mismatch（提示源在重建，不是「被篡改」）", async () => {
		const api = createMarketApi(makeEnv({ fetch: generationCdnFetch({ catalogSeq: 7, shardPin: 7, shardSigSeq: 6 }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_generation_mismatch");
		expect(String(last?.msg)).toContain("源正在重建索引，请稍后重试");
		expect(String(last?.msg)).not.toContain("被篡改");
	});

	it("正文与签名不同代（改了正文没换签名）→ 502 index_generation_mismatch", async () => {
		// catalog 正文 seq=7 但签名 seq=6：body-seq 与 sig-seq 对不上（半个写入）
		const catalog = JSON.stringify({ seq: 7, issued_at: ISSUED_AT, expires_at: EXPIRES_AT, shards: { 1: 6 }, solutions: [{ name: "demo-solution", shards: [1] }] });
		const catalogSig = JSON.stringify(signIndex("catalog", 6, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
		const shardSig = JSON.stringify(signIndex("shard", 6, SHARD_1, TEST_KEY.privateKeyPem, "test.publisher"));
		const fetchFn = ((url: string) => {
			fetchCalls.push(url);
			if (String(url).endsWith(".yaml.sig")) {
				const sig = String(url).includes("shards") ? shardSig : catalogSig;
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer };
			}
			const text = String(url).endsWith("catalog.yaml") ? catalog : String(url).endsWith("shards/1.yaml") ? SHARD_1 : null;
			if (text !== null)
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
			return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
		}) as FetchFace;
		const api = createMarketApi(makeEnv({ fetch: fetchFn }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_generation_mismatch");
	});

	it("同代放行：catalog 第 7 代、钉 shard 7、分片签名第 7 代 → 200（不误伤正常重建）", async () => {
		const api = createMarketApi(makeEnv({ fetch: generationCdnFetch({ catalogSeq: 7, shardPin: 7, shardSigSeq: 7 }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(200);
	});

	it("byte 相同分片跨代复用：catalog 第 7 代钉 shard 3、分片签名第 3 代 → 200（钉值口径，非恒等 catalog 代次）", async () => {
		const api = createMarketApi(makeEnv({ fetch: generationCdnFetch({ catalogSeq: 7, shardPin: 3, shardSigSeq: 3 }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(200);
	});

	it("安装侧同判定：缺签名 → install 502 index_sig_missing（离线 verify 与站点安装不能一个拒一个放）", async () => {
		const api = createMarketApi(makeEnv({ fetch: signingCdnFetch({}) }));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_sig_missing");
	});
});

describe("REG-CS2 索引新鲜度（过期即拒 / 代次回退即拒 / 状态损坏 fail-closed）", () => {
	/** 代次与时效可配的三级 CDN：catalog 正文 seq 与时效封套可设；分片与 catalog 同代（钉值 = seq，签名 seq = 钉值） */
	function timedCdnFetch(args: { seq: number, shardPin?: number, expiresAt?: number | null }): FetchFace {
		const pin = args.shardPin ?? args.seq;
		const catalog = JSON.stringify({
			seq: args.seq,
			// expiresAt = null → 索引不带时效封套（旧 ojm 产物）
			...(args.expiresAt === null ? {} : { issued_at: ISSUED_AT, expires_at: args.expiresAt ?? EXPIRES_AT }),
			shards: { 1: pin },
			solutions: [{ name: "demo-solution", shards: [1] }],
		});
		const catalogSig = JSON.stringify(signIndex("catalog", args.seq, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
		const shardSig = JSON.stringify(signIndex("shard", pin, SHARD_1, TEST_KEY.privateKeyPem, "test.publisher"));
		return ((url: string) => {
			fetchCalls.push(url);
			if (String(url).endsWith(".yaml.sig")) {
				const sig = String(url).includes("shards") ? shardSig : catalogSig;
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer };
			}
			const text = String(url).endsWith("catalog.yaml") ? catalog : String(url).endsWith("shards/1.yaml") ? SHARD_1 : null;
			if (text !== null)
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
			return { ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer as ArrayBuffer };
		}) as FetchFace;
	}

	it("索引已过期（expires_at 已过）→ 502 index_expired", async () => {
		const api = createMarketApi(makeEnv({ fetch: timedCdnFetch({ seq: 1, expiresAt: ISSUED_AT - 1 }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_expired");
	});

	it("索引不带时效（旧 ojm 产物）→ 502 index_expired（不可判定即按过期处理）", async () => {
		const api = createMarketApi(makeEnv({ fetch: timedCdnFetch({ seq: 1, expiresAt: null }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_expired");
	});

	it("源返回更旧的代次（镜像落后 / 旧快照回放）→ 502 index_stale，且水位不被拉低", async () => {
		// 先见第 7 代（水位落库），同源再返回第 3 代 → 回放被挡
		const seen7 = createMarketApi(makeEnv({ fetch: timedCdnFetch({ seq: 7 }) }));
		g.http = { user: { id: 1 } };
		await seen7.index.get();
		expect(last?.status).toBe(200);

		const replayed = createMarketApi(makeEnv({ fetch: timedCdnFetch({ seq: 3 }) }));
		g.http = { user: { id: 1 } };
		await replayed.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_stale");
		const row = dbo.prepare("SELECT max_seq FROM reg_source_seq WHERE source_url = ?").get(CDN.replace(/\/$/, "")) as { max_seq: number } | undefined;
		expect(row?.max_seq).toBe(7);
	});

	it("同代重复拉取 → 放行（幂等，不误伤正常重复请求）", async () => {
		const fetchFn = timedCdnFetch({ seq: 4 });
		g.http = { user: { id: 1 } };
		await createMarketApi(makeEnv({ fetch: fetchFn })).index.get();
		expect(last?.status).toBe(200);
		await createMarketApi(makeEnv({ fetch: fetchFn })).index.get();
		expect(last?.status).toBe(200);
	});

	it("代次水位表缺失（未 migrate）→ 502 index_state_corrupt（fail-closed，不静默当「第一次见」）", async () => {
		dbo.exec("DROP TABLE reg_source_seq");
		const api = createMarketApi(makeEnv({ fetch: timedCdnFetch({ seq: 1 }) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_state_corrupt");
	});
});

describe("REG-CS5 三级索引（装箱分片 + 条件请求 + DIP 读取源 + 读写两侧半写防线）", () => {
	/**
	 * 2500 版本跨 3 片的装箱索引（BDD①；装箱口径与写侧 sharding.ts 同参：单片 ≤1000 版本）：
	 * 1 号片持 1.0.0..1.0.999、2 号片持 1.0.1000..1.0.1999、3 号片持 1.0.2000..1.0.2499，
	 * 最高片持最新版。两端界版本给完整 Form B manifest（安装链消费面），
	 * 其余条目只要 name/version/archive 三要素（latest 单调与 available 消费）。
	 */
	function bigIndexFetch(): FetchFace {
		const cut = 1000;
		const entryOf = (v: string, full: boolean): Record<string, unknown> => full
			? manifestFixture(v)
			: { name: "demo-solution", version: v, archive: { file: `demo-solution-${v}.tgz`, sha256: SHA256, size: ARCHIVE.byteLength } };
		const range = (from: number, to: number, fullAt: number[]): Array<Record<string, unknown>> =>
			Array.from({ length: to - from + 1 }, (_, i) => entryOf(`1.0.${from + i}`, fullAt.includes(from + i)));
		const shard1 = JSON.stringify({ solutions: [{ name: "demo-solution", latest: `1.0.${cut - 1}`, versions: range(0, cut - 1, [0]) }] });
		const shard2 = JSON.stringify({ solutions: [{ name: "demo-solution", latest: `1.0.${cut * 2 - 1}`, versions: range(cut, cut * 2 - 1, []) }] });
		const shard3 = JSON.stringify({ solutions: [{ name: "demo-solution", latest: "1.0.2499", versions: range(cut * 2, 2499, [2499]) }] });
		const catalog = JSON.stringify({ seq: 1, issued_at: ISSUED_AT, expires_at: EXPIRES_AT, shards: { 1: 1, 2: 1, 3: 1 }, solutions: [{ name: "demo-solution", shards: [1, 2, 3] }] });
		const catalogSig = JSON.stringify(signIndex("catalog", 1, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
		const shardSigs = [shard1, shard2, shard3].map(body => JSON.stringify(signIndex("shard", 1, body, TEST_KEY.privateKeyPem, "test.publisher")));
		return ((url: string) => {
			fetchCalls.push(url);
			if (String(url).endsWith(".yaml.sig")) {
				const hit = /shards\/(\d+)\.yaml\.sig$/.exec(String(url));
				const sig = hit === null ? catalogSig : shardSigs[Number(hit[1]) - 1]!;
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer };
			}
			const text = String(url).endsWith("catalog.yaml")
				? catalog
				: String(url).endsWith("shards/1.yaml") ? shard1 : String(url).endsWith("shards/2.yaml") ? shard2 : String(url).endsWith("shards/3.yaml") ? shard3 : null;
			if (text !== null)
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
			if (String(url).endsWith(".tgz"))
				return { ok: true, status: 200, arrayBuffer: async () => ARCHIVE.slice().buffer as ArrayBuffer };
			return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
		}) as FetchFace;
	}

	it("BDD① 装箱分片：2500 版本跨 3 片，latest 安装只拉最高片（≤ 1 catalog + 1 shard）→ done", async () => {
		const api = createMarketApi(makeEnv({ fetch: bigIndexFetch() }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		expect(fetchCalls).toContain(`${CDN}catalog.yaml`);
		expect(fetchCalls).toContain(`${CDN}shards/3.yaml`);
		// 降序尝试：最高片即中，低片一次都不拉（索引请求 ≤ 1 catalog + 1 shard）
		expect(fetchCalls.some(u => u.endsWith("shards/1.yaml"))).toBe(false);
		expect(fetchCalls.some(u => u.endsWith("shards/2.yaml"))).toBe(false);
		expect(fetchCalls).toContain(`${CDN}demo-solution-1.0.2499.tgz`);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		const rec = await getTask(taskDir, taskId);
		expect(rec?.version).toBe("1.0.2499");
		expect(rec?.status).toBe("done");
	});

	it("BDD① 回落低片：显式指定最低版本 → 先试最高片未中，逐片回落到 1 号片命中 → done", async () => {
		const api = createMarketApi(makeEnv({ fetch: bigIndexFetch() }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "1.0.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		expect(fetchCalls).toContain(`${CDN}shards/3.yaml`); // 仍先试最高片
		expect(fetchCalls).toContain(`${CDN}shards/2.yaml`); // 未中 → 回落中片
		expect(fetchCalls).toContain(`${CDN}shards/1.yaml`); // 仍未中 → 回落低片命中
		expect(fetchCalls).toContain(`${CDN}demo-solution-1.0.0.tgz`);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		const rec = await getTask(taskDir, taskId);
		expect(rec?.version).toBe("1.0.0");
		expect(rec?.status).toBe("done");
	});

	it("页面 available 全集（回滚候选要版本全集）：3 片 2500 版跨片全局升序，latest 取最高片", async () => {
		const api = createMarketApi(makeEnv({ fetch: bigIndexFetch() }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(200);
		const row = (last?.data as Array<{ name: string, latest: string | null, available: string[], changelog: string[] | null, publisher: string | null }>).find(r => r.name === "demo-solution");
		expect(row?.latest).toBe("1.0.2499");
		expect(row?.available).toHaveLength(2500);
		expect(row?.available[0]).toBe("1.0.0");
		expect(row?.available[999]).toBe("1.0.999"); // 1 号片末条
		expect(row?.available[1000]).toBe("1.0.1000"); // 2 号片首条——跨片拼接处仍升序
		expect(row?.available[1999]).toBe("1.0.1999"); // 2 号片末条
		expect(row?.available[2000]).toBe("1.0.2000"); // 3 号片首条
		expect(row?.available[2499]).toBe("1.0.2499");
		expect([...row!.available].sort(compareVersions)).toEqual(row!.available);
		// latest 的 changelog/publisher 直接取分片条目（无独立聚合清单）
		expect(row?.changelog).toEqual(["1.0.2499 变更条目"]);
		expect(row?.publisher).toBe("oj-module");
	});

	it("条件请求缓存（Q8 可用性通道）：第二轮索引拉取带 If-None-Match → 304 不重传正文，缓存副本照常出数", async () => {
		// 独立基址：etagCache 是模块级（url → {etag, body}），与其余用例的 CDN 基址隔离
		const ETAG_BASE = "https://etag.example.com/cdn/";
		let notModified = 0;
		const fetchFn = ((url: string, init?: unknown) => {
			fetchCalls.push(url);
			fetchInits.push(init);
			const conditional = (init as { headers?: Record<string, string> } | undefined)?.headers?.["if-none-match"];
			const text = String(url).endsWith("catalog.yaml")
				? CATALOG
				: String(url).endsWith("shards/1.yaml") ? SHARD_1 : null;
			const sigText = String(url).endsWith("catalog.yaml.sig")
				? CATALOG_SIG
				: String(url).endsWith("shards/1.yaml.sig") ? SHARD_1_SIG : null;
			// 带条件头的请求：服务端认 ETag → 304 空正文（ok=false 但语义是「未变」）
			if (conditional !== undefined) {
				notModified++;
				return { ok: false, status: 304, arrayBuffer: async () => new ArrayBuffer(0) };
			}
			const body = text ?? sigText;
			if (body !== null) {
				return {
					ok: true,
					status: 200,
					arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
					// 响应头读取面（site-facade 扩展）：读 ETag 供下一轮 If-None-Match
					headers: { get: (name: string) => (name.toLowerCase() === "etag" ? `"idx-${body.length}"` : null) },
				};
			}
			return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
		}) as FetchFace;
		const api = createMarketApi(makeEnv({ cdnBase: async () => ETAG_BASE, fetch: fetchFn }));
		g.http = { user: { id: 1 } };
		// 第一轮：无缓存 → 四项索引请求（catalog 正文+签名、shard 正文+签名）全量 200 + ETag
		await api.index.get();
		expect(last?.status).toBe(200);
		const first = last?.data;
		expect(notModified).toBe(0);
		expect(fetchInits.every(i => (i as { headers?: Record<string, string> } | undefined)?.headers?.["if-none-match"] === undefined)).toBe(true);
		// 读面不发 no-cache：新鲜度由服务端缓存头 + 条件请求承载
		expect(fetchInits.every(i => (i as { headers?: Record<string, string> } | undefined)?.headers?.["cache-control"] === undefined)).toBe(true);
		// 第二轮：四项全部带 If-None-Match → 全部 304 不重传，缓存副本出数与首轮逐字一致
		await api.index.get();
		expect(last?.status).toBe(200);
		expect(last?.data).toEqual(first);
		const second = fetchInits.slice(4);
		expect(second).toHaveLength(4);
		expect(second.every(i => (i as { headers?: Record<string, string> }).headers?.["if-none-match"] !== undefined)).toBe(true);
		expect(notModified).toBe(4);
	});

	it("DIP 本地目录索引源：indexSource 注入 → 零 HTTP 直读 catalog+shards，校验语义与 HTTP 实现同构", async () => {
		const dir = join(root, "cdn-mirror");
		await fsp.mkdir(join(dir, "shards"), { recursive: true });
		await fsp.writeFile(join(dir, "catalog.yaml"), CATALOG);
		await fsp.writeFile(join(dir, "catalog.yaml.sig"), CATALOG_SIG);
		await fsp.writeFile(join(dir, "shards", "1.yaml"), SHARD_1);
		await fsp.writeFile(join(dir, "shards", "1.yaml.sig"), SHARD_1_SIG);
		const api = createMarketApi(makeEnv({ indexSource: localIndexSource(dir) }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(200);
		expect(fetchCalls.length).toBe(0); // 本地直读，零出站
		const row = (last?.data as Array<{ name: string, latest: string | null }>).find(r => r.name === "demo-solution");
		expect(row?.latest).toBe("0.2.0");
	});

	it("本地目录索引源同构拒载：缺 .sig → 502 index_sig_missing（与 HTTP 实现一个判定）", async () => {
		const dir = join(root, "cdn-mirror-nosig");
		await fsp.mkdir(join(dir, "shards"), { recursive: true });
		await fsp.writeFile(join(dir, "catalog.yaml"), CATALOG);
		await fsp.writeFile(join(dir, "shards", "1.yaml"), SHARD_1);
		await fsp.writeFile(join(dir, "shards", "1.yaml.sig"), SHARD_1_SIG); // 只缺 catalog 的签名
		const api = createMarketApi(makeEnv({ indexSource: localIndexSource(dir) }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("index_sig_missing");
	});

	it("读侧半写防线：catalog 钉了 shards/2.yaml 但 CDN 缺该文件 → 502 fail-closed（不是「没有该方案」）", async () => {
		// 写侧原子落地序：分片正文 → 分片签名 → catalog 正文 → catalog 签名。
		// 此夹具 = catalog 已提交、shard 2 尚未落盘的中间态（读侧视角的半写）
		const catalog = JSON.stringify({ seq: 1, issued_at: ISSUED_AT, expires_at: EXPIRES_AT, shards: { 1: 1, 2: 1 }, solutions: [{ name: "demo-solution", shards: [1, 2] }] });
		const catalogSig = JSON.stringify(signIndex("catalog", 1, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
		const fetchFn = ((url: string) => {
			fetchCalls.push(url);
			if (String(url).includes("shards/2"))
				return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; // 分片还没落盘
			if (String(url).endsWith("catalog.yaml.sig"))
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(catalogSig).buffer as ArrayBuffer };
			if (String(url).endsWith("shards/1.yaml.sig"))
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(SHARD_1_SIG).buffer as ArrayBuffer };
			const text = String(url).endsWith("catalog.yaml") ? catalog : String(url).endsWith("shards/1.yaml") ? SHARD_1 : null;
			if (text !== null)
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
			return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
		}) as FetchFace;
		const api = createMarketApi(makeEnv({ fetch: fetchFn }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("shards/2.yaml");
	});

	it("索引结构破损邪例表（签名过的不可信输入，G4：结构破损与字节被改同类）→ 502 index_generation_mismatch", async () => {
		const brokenCatalogs = [
			// 分片钉值为空
			JSON.stringify({ seq: 1, issued_at: ISSUED_AT, expires_at: EXPIRES_AT, shards: {}, solutions: [{ name: "demo-solution", shards: [1] }] }),
			// 方案指向未钉分片（不静默跳过——那会伪装成「没有该方案」）
			JSON.stringify({ seq: 1, issued_at: ISSUED_AT, expires_at: EXPIRES_AT, shards: { 1: 1 }, solutions: [{ name: "demo-solution", shards: [2] }] }),
		];
		for (const catalog of brokenCatalogs) {
			const catalogSig = JSON.stringify(signIndex("catalog", 1, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
			const fetchFn = ((url: string) => {
				if (String(url).endsWith("catalog.yaml.sig"))
					return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(catalogSig).buffer as ArrayBuffer };
				if (String(url).endsWith("catalog.yaml"))
					return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(catalog).buffer as ArrayBuffer };
				return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
			}) as FetchFace;
			const api = createMarketApi(makeEnv({ fetch: fetchFn }));
			g.http = { user: { id: 1 } };
			await api.index.get();
			expect(last?.status).toBe(502);
			expect(String(last?.msg)).toContain("index_generation_mismatch");
		}
	});

	it("分片结构破损（签名过但缺 solutions 数组）→ 502 fail-closed（不猜、不降级）", async () => {
		const shard = JSON.stringify({ packages: [] }); // 旧键名/畸形：分片解析面拒
		const catalog = JSON.stringify({ seq: 1, issued_at: ISSUED_AT, expires_at: EXPIRES_AT, shards: { 1: 1 }, solutions: [{ name: "demo-solution", shards: [1] }] });
		const catalogSig = JSON.stringify(signIndex("catalog", 1, catalog, TEST_KEY.privateKeyPem, "test.publisher"));
		const shardSig = JSON.stringify(signIndex("shard", 1, shard, TEST_KEY.privateKeyPem, "test.publisher"));
		const fetchFn = ((url: string) => {
			if (String(url).endsWith(".yaml.sig")) {
				const sig = String(url).includes("shards") ? shardSig : catalogSig;
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(sig).buffer as ArrayBuffer };
			}
			const text = String(url).endsWith("catalog.yaml") ? catalog : String(url).endsWith("shards/1.yaml") ? shard : null;
			if (text !== null)
				return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
			return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
		}) as FetchFace;
		const api = createMarketApi(makeEnv({ fetch: fetchFn }));
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(502);
		expect(String(last?.msg)).toContain("shards/1.yaml");
		expect(String(last?.msg)).toContain("solutions");
	});
});

describe("hostVersions 缺省接线（B-11：C2-09 比对真源 = <dist>/versions.json，ojm 宿主构建产物）", () => {
	it("versionsJsonPathOf 布局推导：release 根下的 versions.json（相对/绝对/尾斜杠同构）", () => {
		expect(versionsJsonPathOf("api/dist")).toBe("api/dist/versions.json");
		expect(versionsJsonPathOf("/site/api/dist")).toBe("/site/api/dist/versions.json");
		expect(versionsJsonPathOf("api/dist/")).toBe("api/dist/versions.json");
		expect(versionsJsonPathOf("")).toBe("versions.json");
	});

	it("parseVersionsJson：{packageName: version} 全字符串表 → 解析；任何违约（非对象/值非字符串/坏 JSON）→ undefined（fail-closed 不猜）", () => {
		expect(parseVersionsJson(JSON.stringify({ "@oj-module/runtime": "0.1.77", "react": "19.0.0" })))
			.toEqual({ "@oj-module/runtime": "0.1.77", "react": "19.0.0" });
		for (const bad of ["not-json", "[]", "42", JSON.stringify({ react: 19 }), JSON.stringify({ a: null })]) {
			expect(parseVersionsJson(bad)).toBeUndefined();
		}
	});

	it("集成：env 未注入 hostVersions + <release 根>/versions.json 在盘 → install 全链 done（C2-09 比对走缺省真源）", async () => {
		await fsp.mkdir(sharedRoot, { recursive: true });
		await fsp.writeFile(join(sharedRoot, "versions.json"), JSON.stringify({ "@oj-module/runtime": "0.1.77" }));
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
	it("marketEnv() 缺省 = 布局 v3 生产口径：版本目录与 versions.json 在 release 根 dist/api，站点 modules 在 dist/web；暂存/任务/sidecar 留 jail 根", () => {
		const env = marketEnv();
		expect(env.sharedRoot).toBe("dist/api");
		expect(env.siteModulesDir).toBe("dist/web/modules");
		expect(env.modulesJsonPath).toBe("dist/web/modules.json");
		expect(versionsJsonPathOf(env.sharedRoot)).toBe("dist/api/versions.json");
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

	it("smoke 探针补全（REG-CS6）：按配置的 canonical_origin 补全相对探针，绝不读请求 Host 头", async () => {
		// 配置 canonical origin；伪造 Host 头（云元数据 IP）在场，验证出站不被其牵引
		const api = createMarketApi(makeEnv({ canonicalOrigin: "http://site.example:9781" }));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" }, headers: { host: "169.254.169.254" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.status).toBe("done");
		// 夹具 manifest 无 health → 探首个非匿名路由 /demo-solution → env.apiPrefix=/api/demo-solution
		// → 相对探针 /api/demo-solution/demo-solution 按 canonical_origin 补全为绝对 URL
		expect(fetchCalls).toContain("http://site.example:9781/api/demo-solution/demo-solution");
		// 伪造 Host 头（169.254.169.254）绝不牵引出站
		expect(fetchCalls.some(u => String(u).includes("169.254.169.254"))).toBe(false);
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
