// BDD：编排端点 + 市场索引（P1-12，R9/ISP）。
// 四端点同挂 oj-market 模块 api 根（v4 起自 _platform/market 迁入，manifest deps 声明 _platform）：
//   POST /api/oj-market/install   superadmin——runInstall 编排（端点不重复编排，P1-10 状态机负责推进）
//   GET  /api/oj-market/task?id=  superadmin——任务轮询消费面（§10.2；内容写侧已脱敏，读侧无秘密可泄）
//   GET  /api/oj-market/meta      登录即可——{apiVersion}（peerPlatform 预检）
//   GET  /api/oj-market/index     superadmin——DB 目录分页（market_release 聚合）+ 本地 state 对比（v4 §四，索引机制退役）
// 简报 `task/:id` 段参数形态在模板 http 面无先例（contacts/detail?id= 同款 query 惯例），备案于任务报告。
// 步骤面全 stub 注入（DIP）：fetch/exec/reload 不真跑；register/smoke/audit 走真实内存库夹具。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（installer.spec 同约定） */
import type { FsFace } from "../../src/app/api/_platform/_lifecycle/atomic";
import type { FetchFace } from "../../src/app/api/_platform/_lifecycle/steps/download";
import type { ExecFace } from "../../src/app/api/_platform/_lifecycle/steps/extract";
import type { ReloadFace } from "../../src/app/api/_platform/_lifecycle/steps/reload";
import type { MarketEnv } from "../../src/oj-market/api/api";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { defaultTestKey, nodeVerifyEd25519, signedArchiveFor } from "../../../src/lifecycle/__tests__/helpers";
import { generateKeyPair } from "../../../src/lifecycle/keygen";
import { signCanonical } from "../../../src/lifecycle/sign";
import { readLock, writeLock } from "../../src/app/api/_platform/_lifecycle/lock";
import { createStateStore } from "../../src/app/api/_platform/_lifecycle/state";
import { getTask, writeTask } from "../../src/app/api/_platform/_lifecycle/tasks";
import { createTrustStore } from "../../src/app/api/_platform/_lifecycle/trust";
import { invalidateAllUsers } from "../../src/app/api/_platform/_shared/service/infra/access";
import { createMarketApi, marketEnv, parseVersionsJson, versionsJsonPathOf } from "../../src/oj-market/api/api";
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
		license: "MIT",
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
	// v4 §四：安装解析直读 DB 目录，fetch 只剩「包字节 + smoke 探针」两类出站
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
			// 迁移命令以子命令 "migrate" 标识（argv[1]），启动器名随平台变（bin/oj / oj.exe / oj），
			// 不能锚定 argv[0] 为 "oj"——35b60896 修根因后 launcher 改为 bin/oj 绕开 Linux 打包态 exit 127。
			if (argv[1] === "migrate") {
				return { code: 0, stdout: `${MIGRATE_LINE}\n`, stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		},
	};
}

// reload 桩：按被安装版本产出 applied 模块符号（+name@ver，v0.1.122 双符号契约），
// 供 reloadAndAssert 终态校验（R18）。默认 0.1.0 覆盖绝大多数用例；跨片索引用例（REG-CS5）
// 安装 1.0.2499 / 1.0.0，须按实装版本注入对应桩，否则符号不匹配 → reloading 段判 partial。
function reloadStubFor(version: string): ReloadFace {
	return {
		reloadConfig: async () => ({ generation: 1, unchanged: false, applied: [`+demo-solution@${version}`], restart_pending: [], kept_listener: [] }),
	};
}
const reloadStub: ReloadFace = reloadStubFor("0.1.0");

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
	// 站点 config.yaml 夹具（reloading 段仅做 anonymous_paths 接线；模板 config.yaml 随发形态）
	await fsp.writeFile(join(root, "config.yaml"), "mounts: []\nserver:\n  reload_api: true\nvars:\n  other: 1\nauth:\n  anonymous_paths:\n    - /auth/login\n");
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
		header: () => {},
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

/**
 * 直插 market_release 行（v4 §四 DB 目录：目录聚合/安装解析/releases 共同数据源；上传链路见 cdn-upload.spec）。
 *  signed（缺省 true）按 manifestFixture 同源签名落 sig 三列——install 用例 verify 段六码分流需要；
 *  manifest 缺省 null（目录聚合类用例只数行数；卡片字段用例显式传 manifest）。
 */
function seedRelease(product: string, version: string, opts: { key_id?: string | null, published_at?: number, yanked?: number, manifest?: unknown, signed?: boolean } = {}) {
	const at = opts.published_at ?? 1000;
	const sig = opts.signed === false
		? { alg: null, value: null, pk: null, reg: null }
		: (() => {
			const s = signedArchiveFor(ARCHIVE, product, version, { keyPair: TEST_KEY }).sig;
			return { alg: String(s.alg), value: String(s.value), pk: String(s.public_key), reg: String(s.registry_id) };
		})();
	dbo.prepare("INSERT INTO market_release (product,version,key_id,sha256,size,published_at,published_at_source,yanked,first_seen_at,sig_alg,sig_value,sig_public_key,sig_registry_id,manifest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
		.run(product, version, "key_id" in opts ? opts.key_id : "test.publisher", SHA256, ARCHIVE.byteLength, at, "upload", opts.yanked ?? 0, at, sig.alg, sig.value, sig.pk, sig.reg, opts.manifest === undefined ? null : JSON.stringify(opts.manifest));
}

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
		const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "../../src/app/api/_platform/manifest.yaml");
		const manifestVersion = (parse(readFileSync(manifestPath, "utf8")) as { version: string }).version;
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 } };
		await api.meta.get();
		expect((last?.data as { apiVersion?: string })?.apiVersion).toBe(manifestVersion);
	});
});

describe("0003 迁移（market_release 扩列演化，v4 §一：表演化非新建）", () => {
	it("sig_alg/sig_value/sig_public_key/manifest 四列就位，既有列与表不破坏（releases 端点照常读）", () => {
		const cols = (dbo.prepare("PRAGMA table_info(market_release)").all() as Array<{ name: string }>).map(c => c.name);
		// 新增四列（DB 目录化：签名三字段 + 包内嵌 manifest 抽取物）
		for (const c of ["sig_alg", "sig_value", "sig_public_key", "manifest"])
			expect(cols).toContain(c);
		// 既有九列不破坏（0002 形状原样保留，列名沿用 product 不改 name）
		for (const c of ["id", "product", "version", "key_id", "sha256", "size", "published_at", "published_at_source", "yanked", "first_seen_at"])
			expect(cols).toContain(c);
	});
});

describe("GET catalog（v4 §三：匿名分页目录 JSON，DB 直读合成单协议 shape）", () => {
	/** 直插 market_release 行（目录聚合数据源；上传链路见 cdn-upload.spec） */
	function seedRelease(product: string, version: string, opts: { key_id?: string | null, published_at?: number, yanked?: number, manifest?: unknown } = {}) {
		const at = opts.published_at ?? 1000;
		dbo.prepare("INSERT INTO market_release (product,version,key_id,sha256,size,published_at,published_at_source,yanked,first_seen_at,manifest) VALUES (?,?,?,?,?,?,?,?,?,?)")
			.run(product, version, "key_id" in opts ? opts.key_id : "test.publisher", SHA256, ARCHIVE.byteLength, at, "upload", opts.yanked ?? 0, at, opts.manifest === undefined ? null : JSON.stringify(opts.manifest));
	}

	it("25 包 ?page=2&size=10 → 第 11–20 条 + total=25 + page/size 回显 + api_version + items 形状", async () => {
		for (let i = 1; i <= 25; i++)
			seedRelease(`pkg-${String(i).padStart(2, "0")}`, "0.1.0", { published_at: 1000 + i, manifest: { name: `pkg-${String(i).padStart(2, "0")}`, version: "0.1.0", summary: `方案 ${i}` } });
		const api = createMarketApi(makeEnv());
		g.http = { query: { page: "2", size: "10" } };
		await api.catalog.get();
		expect(last?.status).toBe(200);
		const d = last?.data as { api_version: string, page: number, size: number, total: number, truncated: boolean, items: Array<Record<string, unknown>> };
		expect(d.api_version).toBe("v1");
		expect(d.page).toBe(2);
		expect(d.size).toBe(10);
		expect(d.total).toBe(25);
		expect(d.items).toHaveLength(10);
		// 排序 published_at desc → 第 11–20 条 = pkg-15 … pkg-06（published_at 1025..1016 倒序）
		expect((d.items[0] as { product: string }).product).toBe("pkg-15");
		expect((d.items[9] as { product: string }).product).toBe("pkg-06");
		// items 形状：product/latest/publisher(key_id)/versions_count/summary
		expect(d.items[0]).toMatchObject({ product: "pkg-15", latest: "0.1.0", publisher: "test.publisher", versions_count: 1, summary: "方案 15" });
		// 中间页截断标记
		expect(d.truncated).toBe(true);
	});

	it("响应顶层带 registry_id（签名推送 canonical 首段 = 站点身份，CLI 发现面）；未配置 → null", async () => {
		seedRelease("pkg-a", "0.1.0");
		// 显式注入站点身份（生产 = config.yaml vars.registry_id，经 readSiteVar 同源回落）
		g.http = { query: {} };
		await createMarketApi(makeEnv({ registryId: "test.registry" })).catalog.get();
		expect(last?.status).toBe(200);
		expect((last?.data as { registry_id: string }).registry_id).toBe("test.registry");
		// 未配置（注入缺省 + 无 config vars）→ null：CLI 侧据此给「站点未配置 registry_id」人话
		await createMarketApi(makeEnv({ registryId: undefined })).catalog.get();
		expect((last?.data as { registry_id: unknown }).registry_id).toBeNull();
	});

	it("非法 page/size 收敛不报错（pageArgs 口径数据表）；末页 truncated=false", async () => {
		seedRelease("pkg-a", "0.1.0");
		const api = createMarketApi(makeEnv());
		for (const [page, size, expectPage, expectSize] of [["0", "0", 1, 20], ["-1", "abc", 1, 20], ["abc", "500", 1, 200], ["2.9", "10", 2, 10]] as const) {
			g.http = { query: { page, size } };
			await api.catalog.get();
			expect(last?.status).toBe(200);
			const d = last?.data as { page: number, size: number };
			expect(d.page).toBe(expectPage);
			expect(d.size).toBe(expectSize);
		}
		g.http = { query: { page: "1", size: "20" } };
		await api.catalog.get();
		expect((last?.data as { truncated: boolean }).truncated).toBe(false);
	});

	it("排序稳定：同 published_at 按 product 升序（防翻页重复/丢条目）", async () => {
		seedRelease("pkg-b", "0.1.0", { published_at: 5000 });
		seedRelease("pkg-a", "0.1.0", { published_at: 5000 });
		seedRelease("pkg-c", "0.1.0", { published_at: 5000 });
		const api = createMarketApi(makeEnv());
		g.http = { query: { size: "2", page: "1" } };
		await api.catalog.get();
		expect(((last?.data as { items: Array<{ product: string }> }).items).map(i => i.product)).toEqual(["pkg-a", "pkg-b"]);
		g.http = { query: { size: "2", page: "2" } };
		await api.catalog.get();
		expect(((last?.data as { items: Array<{ product: string }> }).items).map(i => i.product)).toEqual(["pkg-c"]);
	});

	it("清单不含 yanked 行：yanked 版本不计入；全 yanked 的 product 整项消失", async () => {
		seedRelease("live-pkg", "0.1.0");
		seedRelease("live-pkg", "0.2.0", { yanked: 1 });
		seedRelease("gone-pkg", "0.1.0", { yanked: 1 });
		const api = createMarketApi(makeEnv());
		g.http = { query: {} };
		await api.catalog.get();
		const items = (last?.data as { items: Array<{ product: string, latest: string, versions_count: number }> }).items;
		expect(items.map(i => i.product)).toEqual(["live-pkg"]);
		expect(items[0]).toMatchObject({ latest: "0.1.0", versions_count: 1 });
	});

	it("latest = 未 yanked 的 semver max（非存储列，API 计算）；summary 取 latest 版 manifest", async () => {
		seedRelease("sem-pkg", "0.10.0", { published_at: 100, manifest: { summary: "旧" } });
		seedRelease("sem-pkg", "0.9.0", { published_at: 300, manifest: { summary: "新" } });
		seedRelease("no-manifest-pkg", "1.0.0", { key_id: null });
		const api = createMarketApi(makeEnv());
		g.http = { query: {} };
		await api.catalog.get();
		const items = (last?.data as { items: Array<Record<string, unknown>> }).items;
		const sem = items.find(i => i.product === "sem-pkg")!;
		expect(sem.latest).toBe("0.10.0"); // semver 序非字典序
		expect(sem.summary).toBe("旧"); // latest 0.10.0 的 manifest
		expect(sem.publisher).toBe("test.publisher");
		// 遗留行（manifest NULL、key_id NULL）：summary 缺省、publisher null
		const legacy = items.find(i => i.product === "no-manifest-pkg")!;
		expect(legacy.summary).toBeUndefined();
		expect(legacy.publisher).toBeNull();
	});

	it("匿名可读（无 user 也 200）+ Cache-Control: no-store 断言", async () => {
		seedRelease("anon-pkg", "0.1.0");
		const api = createMarketApi(makeEnv());
		const headers: Array<[string, string]> = [];
		g.json = {
			ok: (data: unknown) => {
				last = { status: 200, data };
			},
			fail: (status: number, msg: string) => {
				last = { status, msg };
			},
			header: (k: string, v: string) => {
				headers.push([k, v]);
			},
		};
		g.http = { query: {} };
		await api.catalog.get();
		expect(last?.status).toBe(200);
		expect(headers).toContainEqual(["Cache-Control", "no-store"]);
	});
});

describe("GET catalog/detail（v4 §三：详情保留 yanked 条目，安装解析数据源）", () => {
	function seedRelease(product: string, version: string, opts: { key_id?: string, yanked?: number, published_at?: number, manifest?: unknown } = {}) {
		const at = opts.published_at ?? 1000;
		dbo.prepare("INSERT INTO market_release (product,version,key_id,sha256,size,published_at,published_at_source,yanked,first_seen_at,manifest) VALUES (?,?,?,?,?,?,?,?,?,?)")
			.run(product, version, opts.key_id ?? "test.publisher", SHA256, ARCHIVE.byteLength, at, "upload", opts.yanked ?? 0, at, opts.manifest === undefined ? null : JSON.stringify(opts.manifest));
	}
	const MANIFEST_010 = { name: "demo-solution", version: "0.1.0", summary: "演示", archive: { file: "demo-solution-0.1.0.tgz" } };

	it("versions 全量含 yanked:true 条目、semver 降序；archive.file 正名 + signature 落位", async () => {
		seedRelease("demo-solution", "0.1.0", { manifest: MANIFEST_010 });
		seedRelease("demo-solution", "0.2.0", { yanked: 1, published_at: 2000, manifest: { name: "demo-solution", version: "0.2.0", archive: { file: "wrong-name.tgz" } } });
		const api = createMarketApi(makeEnv());
		g.http = { query: { name: "demo-solution" } };
		await api.catalog.detail.get();
		expect(last?.status).toBe(200);
		const d = last?.data as { product: string, latest: string, versions: Array<Record<string, unknown>> };
		expect(d.product).toBe("demo-solution");
		expect(d.latest).toBe("0.1.0"); // yanked 不计入 latest
		expect(d.versions.map(v => v.version)).toEqual(["0.2.0", "0.1.0"]); // semver 降序
		expect(d.versions[0]).toMatchObject({ version: "0.2.0", yanked: true });
		expect(d.versions[1]).toMatchObject({ version: "0.1.0", yanked: false, summary: "演示" });
		// archive.file 由服务端组表正名（存量 manifest 内嵌 file 不可信，逐字 <name>-<version>.tgz）
		for (const v of d.versions)
			expect((v.archive as { file: string }).file).toBe(`demo-solution-${v.version}.tgz`);
		expect((d.versions[0].archive as Record<string, unknown>).sha256).toBe(SHA256);
	});

	it("未知 name → 404；?version= 过滤；全 yanked 时 latest=null", async () => {
		seedRelease("demo-solution", "0.1.0");
		seedRelease("yanked-all", "0.1.0", { yanked: 1 });
		const api = createMarketApi(makeEnv());
		g.http = { query: { name: "nope" } };
		await api.catalog.detail.get();
		expect(last?.status).toBe(404);
		g.http = { query: { name: "demo-solution", version: "0.1.0" } };
		await api.catalog.detail.get();
		expect((last?.data as { versions: unknown[] }).versions).toHaveLength(1);
		g.http = { query: { name: "demo-solution", version: "9.9.9" } };
		await api.catalog.detail.get();
		expect((last?.data as { versions: unknown[] }).versions).toHaveLength(0);
		g.http = { query: { name: "yanked-all" } };
		await api.catalog.detail.get();
		expect((last?.data as { latest: string | null }).latest).toBeNull();
	});

	it("匿名可读 + 错误文案卫生（404 message 不含路径/SQL/内部拓扑）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { query: { name: "nope" } };
		await api.catalog.detail.get();
		expect(last?.status).toBe(404);
		expect(String(last?.msg)).not.toMatch(/\/|SELECT|sqlite|cdn\//i);
	});
});

describe("POST /market/yank（v4 §三：签名 yank，清单摘除/详情保留）", () => {
	const REGISTRY = "test.registry";
	function seedRelease(product: string, version: string, opts: { key_id?: string | null, yanked?: number, published_at?: number } = {}) {
		const at = opts.published_at ?? 1000;
		dbo.prepare("INSERT INTO market_release (product,version,key_id,sha256,size,published_at,published_at_source,yanked,first_seen_at) VALUES (?,?,?,?,?,?,?,?,?)")
			.run(product, version, "key_id" in opts ? opts.key_id : "test.publisher", SHA256, ARCHIVE.byteLength, at, "upload", opts.yanked ?? 0, at);
	}
	/** yank 签名面：canonical `market-yank:<registry>:<product>:<version>`（服务端重算口径同上传） */
	function yankSignature(product: string, version: string, key: typeof TEST_KEY = TEST_KEY, keyId = "test.publisher") {
		return { "x-ojm-key-id": keyId, "x-ojm-signature": signCanonical(key.privateKeyPem, `market-yank:${REGISTRY}:${product}:${version}`) };
	}

	it("签名 + key 匹配行 key_id → 200：行 yanked=1、catalog 清单即摘除、detail 标 yanked:true", async () => {
		seedRelease("demo-solution", "0.1.0");
		const api = createMarketApi(makeEnv({ registryId: REGISTRY }));
		g.http = { user: { id: 1 }, body: { product: "demo-solution", version: "0.1.0", by: "rel-ops", reason: "严重缺陷" }, headers: yankSignature("demo-solution", "0.1.0") };
		await api.yank.post();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: true, product: "demo-solution", version: "0.1.0", yanked: true });
		expect(dbo.prepare("SELECT yanked FROM market_release WHERE product=? AND version=?").get("demo-solution", "0.1.0").yanked).toBe(1);
		// 清单即摘除（匿名面直读）
		g.http = { query: {} };
		await api.catalog.get();
		expect((last?.data as { items: unknown[] }).items).toHaveLength(0);
		// 详情保留 + yanked 标记
		g.http = { query: { name: "demo-solution" } };
		await api.catalog.detail.get();
		const d = last?.data as { latest: string | null, versions: Array<{ yanked: boolean }> };
		expect(d.latest).toBeNull();
		expect(d.versions[0]!.yanked).toBe(true);
	});

	it("审计：by/reason 落 market_history（action=yank，operator=key_id）", async () => {
		seedRelease("demo-solution", "0.1.0");
		const api = createMarketApi(makeEnv({ registryId: REGISTRY }));
		g.http = { user: { id: 1 }, body: { product: "demo-solution", version: "0.1.0", by: "rel-ops", reason: "严重缺陷" }, headers: yankSignature("demo-solution", "0.1.0") };
		await api.yank.post();
		const rows = dbo.prepare("SELECT * FROM market_history WHERE action='yank'").all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ solution: "demo-solution", version: "0.1.0", status: "success", operator: "test.publisher" });
		expect(String(rows[0].message)).toContain("rel-ops");
		expect(String(rows[0].message)).toContain("严重缺陷");
	});

	it("数据表：未信任 key 403 / 非该行发布者 403 / 未知版本 404 / 重复幂等 200", async () => {
		seedRelease("demo-solution", "0.1.0");
		seedRelease("other-pkg", "0.1.0", { key_id: "other.publisher" });
		const foreign = generateKeyPair();
		const api = createMarketApi(makeEnv({ registryId: REGISTRY }));
		// 未信任 key
		g.http = { body: { product: "demo-solution", version: "0.1.0" }, headers: { ...yankSignature("demo-solution", "0.1.0", foreign, "foreign.publisher") } };
		await api.yank.post();
		expect(last?.status).toBe(403);
		// 受信但非该行发布者（other.publisher 未入信任库，先入再测——否则落 403 信任面）
		await createTrustStore(join(sharedRoot, ".solutions", "trusted-keys.yaml"), { audit: () => {} }).add("other.publisher", foreign.publicKeyHex);
		g.http = { body: { product: "demo-solution", version: "0.1.0" }, headers: { ...yankSignature("demo-solution", "0.1.0", foreign, "other.publisher") } };
		await api.yank.post();
		expect(last?.status).toBe(403);
		expect(String(last?.msg)).toContain("发布者");
		// 未知版本 404
		g.http = { body: { product: "demo-solution", version: "9.9.9" }, headers: yankSignature("demo-solution", "9.9.9") };
		await api.yank.post();
		expect(last?.status).toBe(404);
		// 重复 yank 幂等 200
		g.http = { body: { product: "demo-solution", version: "0.1.0" }, headers: yankSignature("demo-solution", "0.1.0") };
		await api.yank.post();
		expect(last?.status).toBe(200);
		g.http = { body: { product: "demo-solution", version: "0.1.0" }, headers: yankSignature("demo-solution", "0.1.0") };
		await api.yank.post();
		expect(last?.status).toBe(200);
		expect((last?.data as { idempotent: boolean }).idempotent).toBe(true);
	});

	it("伪造签名（canonical 不符）→ 401", async () => {
		seedRelease("demo-solution", "0.1.0");
		const api = createMarketApi(makeEnv({ registryId: REGISTRY }));
		g.http = { body: { product: "demo-solution", version: "0.1.0" }, headers: yankSignature("demo-solution", "0.2.0") };
		await api.yank.post();
		expect(last?.status).toBe(401);
	});

	it("unyank 恢复同模型：restore → 200、行 yanked=0、清单恢复；遗留行（key_id NULL）403 指向 superadmin 通道", async () => {
		seedRelease("demo-solution", "0.1.0", { yanked: 1 });
		seedRelease("legacy-pkg", "0.1.0", { key_id: null });
		const api = createMarketApi(makeEnv({ registryId: REGISTRY }));
		g.http = { body: { product: "demo-solution", version: "0.1.0", restore: true }, headers: yankSignature("demo-solution", "0.1.0") };
		await api.yank.post();
		expect(last?.status).toBe(200);
		expect((last?.data as { yanked: boolean }).yanked).toBe(false);
		expect(dbo.prepare("SELECT yanked FROM market_release WHERE product=? AND version=?").get("demo-solution", "0.1.0").yanked).toBe(0);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_history WHERE action='unyank'").all()[0].c).toBe(1);
		g.http = { query: {} };
		await api.catalog.get();
		expect((last?.data as { items: Array<{ product: string }> }).items.map(i => i.product)).toContain("demo-solution");
		// 遗留行（无发布者）→ 403，superadmin 管理通道兜底
		g.http = { body: { product: "legacy-pkg", version: "0.1.0" }, headers: yankSignature("legacy-pkg", "0.1.0") };
		await api.yank.post();
		expect(last?.status).toBe(403);
		expect(String(last?.msg)).toContain("superadmin");
	});
});

describe("POST install（cdn：DB 目录解析属市场侧，安装器不拼 URL；v4 §四）", () => {
	it("指定版本：目录行解析 → runInstall 推进至 done，task 文件全 stage 就位且零索引出站", async () => {
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		seedRelease("demo-solution", "0.2.0", { published_at: 2000, manifest: manifestFixture("0.2.0") });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id;
		expect(typeof taskId).toBe("string");
		// 解析直读 DB：出站只有分发包字节（绝不拉 catalog.yaml/shards）
		expect(fetchCalls).toContain(`${CDN}demo-solution-0.1.0.tgz`);
		expect(fetchCalls.some(u => u.endsWith(".yaml") || u.endsWith(".yaml.sig"))).toBe(false);
		// 后台推进：runInstall 状态机逐 stage 落盘，终态 done + 全 stage 明细
		const rec = await getTask(taskDir, taskId as string);
		expect(rec?.status).toBe("done");
		expect(rec?.stages.map(x => x.stage)).toEqual(STAGE_ORDER);
		expect(rec?.version).toBe("0.1.0");
		expect(rec?.appliedSeq).toBe(3);
	});

	it("version 缺省取 latest（未 yanked 的 semver max，API 计算）", async () => {
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		seedRelease("demo-solution", "0.2.0", { published_at: 2000, manifest: manifestFixture("0.2.0") });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		expect(fetchCalls).toContain(`${CDN}demo-solution-0.2.0.tgz`);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.version).toBe("0.2.0");
	});

	it("可读失败不崩：source 非法 400 / 未配置市场地址 503 / 目录无此方案 404（含回填指引）/ 目录无此版本 404", async () => {
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
		expect(String(last?.msg)).toContain("回填");
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "9.9.9", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(404);
		expect(String(last?.msg)).toContain("9.9.9");
	});
});

describe("REG-CS4 yank（安装侧精确版本拒装，DB 目录口径）", () => {
	it("精确安装被下线版本 → 409 拒装（含「下线」人话），不触碰 .tgz", async () => {
		seedRelease("demo-solution", "0.2.0", { yanked: 1, published_at: 2000, manifest: manifestFixture("0.2.0") });
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		const api = createMarketApi(makeEnv());
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.2.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(409);
		expect(String(last?.msg)).toContain("下线");
		expect(fetchCalls.some(u => u.endsWith(".tgz"))).toBe(false);
	});

	it("latest 路径自动跳过 yanked（API 计算的 latest 只数未下线版本）→ 正常装 0.1.0", async () => {
		seedRelease("demo-solution", "0.2.0", { yanked: 1, published_at: 2000, manifest: manifestFixture("0.2.0") });
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.version).toBe("0.1.0");
	});

	it("全部版本被下线 → 409 人话（latest 不可得）", async () => {
		seedRelease("demo-solution", "0.1.0", { yanked: 1, manifest: manifestFixture("0.1.0") });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: null, source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(409);
		expect(String(last?.msg)).toContain("下线");
	});
});

describe("相对基址（REG-CS6：/cdn 自供按配置的 canonical_origin 补全，绝不读请求 Host 头防 SSRF）", () => {
	const REL = "/cdn";
	const FORGED = "169.254.169.254"; // 伪造 Host（云元数据 IP）——绝不可牵引出站
	const relEnv = (overrides: Partial<MarketEnv> = {}) => makeEnv({ cdnBase: async () => REL, ...overrides });

	it("自供回归：canonical_origin 配置 → 相对 /cdn 包字节 URL 按配置 origin 补全绝对 URL（非 Host 头）", async () => {
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		const api = createMarketApi(relEnv({ canonicalOrigin: "http://127.0.0.1:5174" }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" }, headers: { host: FORGED } };
		await api.install.post();
		expect(last?.status).toBe(200);
		// 按配置的 canonical origin 补全，而非伪造 Host 头
		expect(fetchCalls).toContain("http://127.0.0.1:5174/cdn/demo-solution-0.1.0.tgz");
		expect(fetchCalls.some(u => String(u).includes(FORGED))).toBe(false);
	});

	it("install：canonical_origin 非法（ftp://）→ 明确报错指向 vars.canonical_origin", async () => {
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
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
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		const api = createMarketApi(makeEnv({ canonicalOrigin: undefined }));
		fetchCalls.length = 0;
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" }, headers: { host: FORGED } };
		await api.install.post();
		expect(last?.status).toBe(503);
		expect(last?.msg).toContain("vars.canonical_origin");
		expect(fetchCalls.length).toBe(0);
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
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
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
				// launcher 名随平台变（bin/oj / oj.exe / oj），以子命令 "migrate" 标识（argv[1]）。
				if (argv[1] === "migrate")
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
		// face 目录含条目旁车 .ojm-module.json（重建合并登记的重建真源，2026-11-07 支柱二）
		expect(await fsp.readdir(join(siteModulesDir, "demo-solution", "0.1.0"))).toEqual([".ojm-module.json", "entry.js", "main.css"]);
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

describe("GET /market/trust/review（发布管理「信任审核」区数据源）", () => {
	async function seedReviewTask(id: string, keyId: string, startedAt: number): Promise<void> {
		const { generateKeyPair } = await import("../../../src/lifecycle/keygen");
		const kp = generateKeyPair();
		await writeTask(taskDir, {
			id,
			name: "demo-solution",
			version: "0.1.0",
			status: "needs_trust",
			stage: "verifying",
			progress: 30,
			message: "待信任确认",
			stages: [],
			trust: { key_id: keyId, public_key: kp.publicKeyHex, fingerprint: createHash("sha256").update(hexToBytes(kp.publicKeyHex)).digest("hex") },
			startedAt,
			finishedAt: startedAt,
		});
	}

	it("超管视角：待审 needs_trust 任务列出 trust 三元组，done 任务被过滤，按 started_at 倒序", async () => {
		const api = createMarketApi(makeEnv());
		await seedReviewTask("install-old", "older.pub", 1000);
		await seedReviewTask("install-new", "newer.pub", 2000);
		await writeTask(taskDir, { id: "done-1", name: "d", version: "1.0.0", status: "done", stage: "done", progress: 100, message: "x", stages: [], startedAt: 3, finishedAt: 4 });
		g.http = { user: { id: 1 } };
		await api.trust.review.get();
		expect(last?.status).toBe(200);
		const rows = last?.data as Array<Record<string, unknown>>;
		expect(rows.map(r => r.task_id)).toEqual(["install-new", "install-old"]);
		expect(rows[0]).toMatchObject({ name: "demo-solution", version: "0.1.0", key_id: "newer.pub" });
		expect(String(rows[0]?.fingerprint)).toMatch(/^[0-9a-f]{64}$/);
	});

	it("门：非 superadmin 403（可见范围服务端决定，前端不重复判权）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 2 } };
		await api.trust.review.get();
		expect(last?.status).toBe(403);
	});

	it("已入库 key 的待审项不再回列表（审批/凭证表新增后列表即净，test.publisher 已在信任库）", async () => {
		const api = createMarketApi(makeEnv());
		await seedReviewTask("install-new", "newer.pub", 2000);
		await writeTask(taskDir, {
			id: "approved-1",
			name: "demo-solution",
			version: "0.1.0",
			status: "needs_trust",
			stage: "verifying",
			progress: 30,
			message: "待信任确认",
			stages: [],
			trust: { key_id: "test.publisher", public_key: TEST_KEY.publicKeyHex, fingerprint: createHash("sha256").update(hexToBytes(TEST_KEY.publicKeyHex)).digest("hex") },
			startedAt: 3000,
			finishedAt: 3000,
		});
		g.http = { user: { id: 1 } };
		await api.trust.review.get();
		expect(last?.status).toBe(200);
		const rows = last?.data as Array<Record<string, unknown>>;
		expect(rows.map(r => r.task_id)).toEqual(["install-new"]);
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

describe("GET index（v4 §四：DB 目录分页 + 本地 state 对比；索引机制退役）", () => {
	const LATEST_DESCRIPTION = "演示方案：提供示例 CRUD 与菜单路由，覆盖安装、升级、回滚与历史留痕全链路。";

	it("聚合对比：DB 最新版本 + 本地已装/enabled + upgradable + available/changelog/publisher/publisher_key/license/summary/description/trust_state/key_id/operator（P2-11）；本地独有方案也列出；零索引出站", async () => {
		const env = makeEnv();
		const state = await createStateStore(env.statePath);
		await state.write({
			solutions: {
				"demo-solution": { version: "0.1.0", enabled: true, installedAt: 1, trust_state: "trusted", archive: { sha256: "a", key_id: "test.publisher", signature: {} } },
				"legacy": { version: "9.9.9", enabled: false, installedAt: 2 },
			},
		});
		seedRelease("demo-solution", "0.1.0", { published_at: 1000, manifest: manifestFixture("0.1.0") });
		seedRelease("demo-solution", "0.2.0", { published_at: 2000, manifest: { ...manifestFixture("0.2.0"), description: LATEST_DESCRIPTION } });
		seedRelease("wiki", "1.3.0", { published_at: 1500 });
		const api = createMarketApi(env);
		await api.index.get();
		expect(last?.status).toBe(200);
		// 直读 DB：零索引出站
		expect(fetchCalls.some(u => u.endsWith(".yaml") || u.endsWith(".yaml.sig"))).toBe(false);
		const d = last?.data as { list: unknown[], total: number, page: number, size: number };
		expect(d.total).toBe(3);
		expect(d.page).toBe(1);
		expect(d.size).toBe(20);
		expect(d.list).toEqual([
			{ name: "demo-solution", latest: "0.2.0", installed: "0.1.0", enabled: true, upgradable: true, available: ["0.1.0", "0.2.0"], changelog: ["0.2.0 变更条目"], publisher: "oj-module", publisher_key: "test.publisher", license: "MIT", summary: "演示方案", description: LATEST_DESCRIPTION, trust_state: "trusted", key_id: "test.publisher", operator: null },
			{ name: "legacy", latest: null, installed: "9.9.9", enabled: false, upgradable: false, available: [], changelog: null, publisher: null, publisher_key: null, license: null, summary: null, description: null, trust_state: null, key_id: null, operator: null },
			{ name: "wiki", latest: "1.3.0", installed: null, enabled: null, upgradable: false, available: ["1.3.0"], changelog: null, publisher: null, publisher_key: "test.publisher", license: null, summary: null, description: null, trust_state: null, key_id: null, operator: null },
		]);
	});

	it("翻页：?page=&size= 截窗口（产品名字典序）；末页 truncated 语义由 total/size 承载", async () => {
		for (let i = 1; i <= 5; i++)
			seedRelease(`pkg-${String(i).padStart(2, "0")}`, "0.1.0");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { page: "2", size: "2" } };
		await api.index.get();
		expect(last?.status).toBe(200);
		const d = last?.data as { list: Array<{ name: string }>, total: number, page: number, size: number };
		expect(d.total).toBe(5);
		expect(d.page).toBe(2);
		expect(d.size).toBe(2);
		expect(d.list.map(r => r.name)).toEqual(["pkg-03", "pkg-04"]);
	});

	it("yanked 版本不计入 latest/available（卡片只见在架版本），全 yanked 产品 latest=null", async () => {
		seedRelease("demo-solution", "0.2.0", { yanked: 1, published_at: 2000, manifest: manifestFixture("0.2.0") });
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		seedRelease("gone", "1.0.0", { yanked: 1, manifest: { name: "gone", version: "1.0.0" } });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 } };
		await api.index.get();
		const d = last?.data as { list: Array<{ name: string, latest: string | null, available: string[] }> };
		const demo = d.list.find(r => r.name === "demo-solution")!;
		expect(demo.latest).toBe("0.1.0");
		expect(demo.available).toEqual(["0.1.0"]);
		expect(d.list.find(r => r.name === "gone")?.latest).toBeNull();
	});

	it("operator 回落 history 行（P2-11：最近一次 install 动作的 operator；表缺失/无行 → null 不炸）", async () => {
		dbo.prepare("insert into market_history (solution, version, action, status, operator, message, created_at) values (?, ?, ?, ?, ?, ?, ?)")
			.run("demo-solution", "0.1.0", "install", "done", "alice", "", 1700000000);
		seedRelease("demo-solution", "0.1.0");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(200);
		const d = last?.data as { list: Array<{ name: string, operator: string | null }> };
		expect(d.list.find(r => r.name === "demo-solution")?.operator).toBe("alice");
	});

	it("operator 批量口径一致（minor M6：一页多产品，每产品取各自最近一次 install operator，互不穿串）", async () => {
		const ins = dbo.prepare("insert into market_history (solution, version, action, status, operator, message, created_at) values (?, ?, ?, ?, ?, ?, ?)");
		ins.run("demo-solution", "0.1.0", "install", "done", "alice", "", 1700000000);
		ins.run("demo-solution", "0.1.1", "install", "done", "bob", "", 1700000001); // 更近一次 → demo 应取 bob
		ins.run("wiki", "1.0.0", "install", "done", "carol", "", 1700000002);
		seedRelease("demo-solution", "0.1.1");
		seedRelease("wiki", "1.0.0");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 } };
		await api.index.get();
		expect(last?.status).toBe(200);
		const d = last?.data as { list: Array<{ name: string, operator: string | null }> };
		expect(d.list.find(r => r.name === "demo-solution")?.operator).toBe("bob");
		expect(d.list.find(r => r.name === "wiki")?.operator).toBe("carol");
	});

	it("P2-12 bootstrap key（G3 双轨第一轨）：信任库为空 + bootstrapKey 注入 → cdn 首装直达 done 不落 needs_trust", async () => {
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
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
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		await fsp.rm(join(sharedRoot, ".solutions", "trusted-keys.yaml"), { force: true });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.status).toBe("needs_trust");
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
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
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
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
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
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
		const api = createMarketApi(makeEnv({ exec }));
		g.http = { user: { id: 1 }, body: { name: "demo-solution", version: "0.1.0", source: "cdn" } };
		await api.install.post();
		expect(last?.status).toBe(200);
		const taskId = (last?.data as { task_id?: unknown })?.task_id as string;
		expect((await getTask(taskDir, taskId))?.status).toBe("done");
		const mig = seen.find(c => c.argv[1] === "migrate");
		expect(mig).toBeDefined();
		expect(mig?.opts).toEqual({ timeoutMs: 600000 });
	});

	it("smoke 探针补全（REG-CS6）：按配置的 canonical_origin 补全相对探针，绝不读请求 Host 头", async () => {
		// 配置 canonical origin；伪造 Host 头（云元数据 IP）在场，验证出站不被其牵引
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
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
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
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
		seedRelease("demo-solution", "0.1.0", { manifest: manifestFixture("0.1.0") });
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

// ── 发布历史（GET /oj-market/releases；v4 §四：数据源 = market_release 上传写入行，索引 syncReleases 退役）──

interface ReleasePageData {
	list: Array<{ id: number, product: string, version: string, key_id: string | null, sha256: string | null, size: number | null, published_at: number, published_at_source: string, yanked: number }>
	total: number
	page: number
	size: number
}

describe("GET /oj-market/releases（发布历史：DB 目录行直读 + 分页）", () => {
	it("直读上传写入行：published_at 倒序分页，字段齐全（含 yanked 当前态与 published_at_source）", async () => {
		seedRelease("demo-solution", "0.1.0", { published_at: 1000, manifest: manifestFixture("0.1.0") });
		seedRelease("demo-solution", "0.2.0", { published_at: 3000, yanked: 1, manifest: manifestFixture("0.2.0") });
		seedRelease("wiki", "1.0.0", { published_at: 2000, key_id: null });
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 } };
		await api.releases.get();
		expect(last?.status).toBe(200);
		const d = last?.data as ReleasePageData;
		expect(d.total).toBe(3);
		expect(d.page).toBe(1);
		expect(d.size).toBe(20);
		expect(d.list.map(r => `${r.product}@${r.version}`)).toEqual(["demo-solution@0.2.0", "wiki@1.0.0", "demo-solution@0.1.0"]);
		expect(d.list[0]).toMatchObject({ product: "demo-solution", version: "0.2.0", key_id: "test.publisher", sha256: SHA256, size: ARCHIVE.byteLength, published_at: 3000, published_at_source: "upload", yanked: 1 });
		// 遗留行（key_id NULL）照常可读——历史是观测面
		expect(d.list[1]?.key_id).toBeNull();
		// 直读 DB：零索引出站、零 syncError 字段（退役不留双尸）
		expect(fetchCalls.length).toBe(0);
		expect("syncError" in d).toBe(false);
	});

	it("门与分页：匿名 401；page/limit 透传并按发布时间倒序取页", async () => {
		for (let i = 1; i <= 5; i++)
			seedRelease(`pkg-${String(i).padStart(2, "0")}`, "0.1.0", { published_at: 1000 + i });
		const api = createMarketApi(makeEnv());
		g.http = {};
		await api.releases.get();
		expect(last?.status).toBe(401);
		g.http = { user: { id: 1 }, query: { page: "2", limit: "2" } };
		await api.releases.get();
		const d = last?.data as ReleasePageData;
		expect(d.page).toBe(2);
		expect(d.size).toBe(2);
		expect(d.list.map(r => r.product)).toEqual(["pkg-03", "pkg-02"]);
	});
});

describe("DELETE /oj-market/history（删除未安装成功的版本；2026-11-08 用户需求）", () => {
	function seedInstall(solution: string, version: string, status: string): void {
		dbo.prepare("INSERT INTO market_history (solution, version, action, status, operator, message, created_at) VALUES (?,?,?,?,?,?,?)")
			.run(solution, version, "install", status, "u1", `message-${status}`, 1000);
	}
	const countOf = (name: string, version: string): number => Number(
		dbo.prepare("SELECT COUNT(*) c FROM market_history WHERE solution=? AND version=? AND action='install'").get(name, version).c,
	);

	it("门禁：非 superadmin 403；缺 name/version 400（判权先于取值）", async () => {
		seedInstall("demo-solution", "0.1.0", "failed");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 2 }, query: { name: "demo-solution", version: "0.1.0" } };
		await api.history.del();
		expect(last?.status).toBe(403);
		g.http = { user: { id: 1 }, query: { name: "demo-solution" } };
		await api.history.del();
		expect(last?.status).toBe(400);
		expect(countOf("demo-solution", "0.1.0")).toBe(1);
	});

	it("失败版本：清掉该版本全部 install 记录 + 删残留版本目录 + 审计落 oplog", async () => {
		// 同一版本两次失败（用户重试过）→ 一次删除等于「这个版本从历史里清干净」
		seedInstall("demo-solution", "0.2.0", "failed");
		seedInstall("demo-solution", "0.2.0", "needs_trust");
		seedInstall("demo-solution", "0.1.0", "done"); // 当前生效版本的记录不动
		const staleDir = join(sharedRoot, "demo-solution-0.2.0");
		await fsp.mkdir(join(staleDir, "migrations"), { recursive: true });
		await fsp.writeFile(join(staleDir, "manifest.yaml"), "name: demo-solution\n");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { name: "demo-solution", version: "0.2.0" } };
		await api.history.del();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: true, deleted: 2, removedDir: true });
		expect(countOf("demo-solution", "0.2.0")).toBe(0);
		expect(countOf("demo-solution", "0.1.0")).toBe(1);
		await expect(fsp.access(staleDir)).rejects.toThrow();
		// 审计（fire-and-forget）：动作名带 purge，detail 记删除条数与目录清理结果
		await new Promise(r => setTimeout(r, 20));
		const oplog = dbo.prepare("SELECT action, target, detail FROM sys_oplog WHERE action = 'solution.install.purge'").all() as Array<Record<string, unknown>>;
		expect(oplog).toHaveLength(1);
		expect(oplog[0]).toMatchObject({ target: "demo-solution@0.2.0" });
		expect(String(oplog[0]!.detail)).toContain("\"deleted\":2");
	});

	it("残留目录不存在也成功（锁前失败无目录可清）", async () => {
		seedInstall("demo-solution", "0.3.0", "failed");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { name: "demo-solution", version: "0.3.0" } };
		await api.history.del();
		expect(last?.status).toBe(200);
		expect(last?.data).toMatchObject({ ok: true, deleted: 1, removedDir: false });
		expect(String((last?.data as { message: string }).message)).toContain("无残留版本目录");
	});

	it("曾安装成功（done / partial）拒删：那不是失败版本，要走卸载或回滚", async () => {
		seedInstall("demo-solution", "1.0.0", "done");
		seedInstall("demo-solution", "1.1.0", "partial");
		const api = createMarketApi(makeEnv());
		for (const version of ["1.0.0", "1.1.0"]) {
			g.http = { user: { id: 1 }, query: { name: "demo-solution", version } };
			await api.history.del();
			expect(last?.status).toBe(200); // 领域拒绝走 200 + ok:false（与 uninstall 同款）
			expect(last?.data).toMatchObject({ ok: false, deleted: 0 });
			expect(String((last?.data as { message: string }).message)).toContain("曾安装成功");
			expect(countOf("demo-solution", version)).toBe(1);
		}
	});

	it("失败后重试成功：历史里既有 failed 也有 done → 拒删（该版本确实装上了）", async () => {
		seedInstall("demo-solution", "2.0.0", "failed");
		seedInstall("demo-solution", "2.0.0", "done");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { name: "demo-solution", version: "2.0.0" } };
		await api.history.del();
		expect(last?.data).toMatchObject({ ok: false });
		expect(countOf("demo-solution", "2.0.0")).toBe(2);
	});

	it("当前生效保护：锁或 sidecar 指向该版本即拒删（即便历史全是 failed）", async () => {
		seedInstall("demo-solution", "0.4.0", "failed");
		const api = createMarketApi(makeEnv());
		// 锁指向该版本（用户手改锁/回滚残留的极端态）
		await writeLock(join(sharedRoot, "manifests.yaml"), { "demo-solution": "0.4.0", "auth": "0.1.0" });
		g.http = { user: { id: 1 }, query: { name: "demo-solution", version: "0.4.0" } };
		await api.history.del();
		expect(last?.data).toMatchObject({ ok: false });
		expect(String((last?.data as { message: string }).message)).toContain("当前仍在生效");
		// sidecar 指向该版本（锁已回退但元数据未跟上的极端态）
		await writeLock(join(sharedRoot, "manifests.yaml"), { auth: "0.1.0" });
		await (await createStateStore(join(sharedRoot, ".solutions", "state.yaml")))
			.write({ solutions: { "demo-solution": { version: "0.4.0", enabled: true, installedAt: 1000 } } });
		await api.history.del();
		expect(last?.data).toMatchObject({ ok: false });
		expect(countOf("demo-solution", "0.4.0")).toBe(1);
	});

	it("平台内置模块与非法入参拒删：oj-market 不按方案版本删；版本含 ../ 过白名单即拒", async () => {
		seedInstall("oj-market", "0.2.4", "failed");
		seedInstall("demo-solution", "0.5.0", "failed");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { name: "oj-market", version: "0.2.4" } };
		await api.history.del();
		expect(last?.data).toMatchObject({ ok: false });
		expect(String((last?.data as { message: string }).message)).toContain("第一方平台模块");
		g.http = { user: { id: 1 }, query: { name: "demo-solution", version: "../../etc" } };
		await api.history.del();
		expect(last?.data).toMatchObject({ ok: false });
		expect(String((last?.data as { message: string }).message)).toContain("非法");
		expect(countOf("demo-solution", "0.5.0")).toBe(1);
	});

	it("没有该版本安装记录 → 人话拒绝（不误删其它版本）", async () => {
		seedInstall("demo-solution", "0.6.0", "failed");
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { name: "demo-solution", version: "9.9.9" } };
		await api.history.del();
		expect(last?.data).toMatchObject({ ok: false, deleted: 0 });
		expect(String((last?.data as { message: string }).message)).toContain("没有");
		expect(countOf("demo-solution", "0.6.0")).toBe(1);
	});
});

describe("GET /oj-market/history（操作历史消费面：前端据此标记结果与是否可删）", () => {
	it("返回 id（Table rowKey）且同秒多次尝试按 id 倒序（首行即最新，前端 latestInstallByVersion 依赖）", async () => {
		const ins = dbo.prepare("INSERT INTO market_history (solution, version, action, status, operator, message, created_at) VALUES (?,?,?,?,?,?,?)");
		ins.run("demo-solution", "0.1.0", "install", "failed", "u1", "第一次失败", 1000);
		ins.run("demo-solution", "0.1.0", "install", "done", "u1", "安装完成", 1000);
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 2 } }; // 读面登录即可（产品口径：admin 能看历史）
		await api.history.get();
		expect(last?.status).toBe(200);
		const rows = last?.data as Array<Record<string, unknown>>;
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ status: "done", message: "安装完成" });
		expect(rows[1]).toMatchObject({ status: "failed" });
		expect(typeof rows[0]!.id).toBe("number");
		expect(Number(rows[0]!.id)).toBeGreaterThan(Number(rows[1]!.id));
	});
});
