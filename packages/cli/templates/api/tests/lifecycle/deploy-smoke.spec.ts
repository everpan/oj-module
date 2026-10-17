// BDD：部署/热更/冒烟三步（P1-9，十阶段 stage 8~10）。
// deploy-web = staging/web 产物树真复制到站点 modules 目录 + modules.json 读-改-原子写 upsert
// （D13：读者永不见半截 JSON；R30：entry/css 路径 POSIX 分隔符序列化；同名整体替换、他条目原样保留）；
// reload = 注入 reloadConfig 面（platform 特权 API），unchanged = 改写未生效判失败（R18 终态断言），
// expected 段键（缺省 ["mounts"]）须逐一 ∈ applied；
// smoke = 探活（health 2xx / 缺省首个非匿名路由连通即可）+ integrity（部署落位后重算 sha384 vs
// modules.json 条目，R10 包内容口径；缺失 fail-closed）+ 注册一致性（升级态「包含非相等」：
// 快照逐数组 ⊇ 声明，少 = 注册丢失判失败）collect-all 全败齐报。
// entry 浏览器加载不在安装器验（Node import 必假绿——设计 §4.1），注释钉口径。
// fetch/sha384/query/reload 面经 ctx 注入 stub（同 steps-fs 范式），fs 为 globalThis.fs 面。
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import type { StateStore } from "../../src/_platform/_lifecycle/state";
import type { DeployWebContext, ModuleEntry } from "../../src/_platform/_lifecycle/steps/deploy-web";
import type { ReloadContext, ReloadFace, ReloadResult } from "../../src/_platform/_lifecycle/steps/reload";
import type { SmokeContext } from "../../src/_platform/_lifecycle/steps/smoke";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deployWeb, posixPath, upsertModulesJson } from "../../src/_platform/_lifecycle/steps/deploy-web";
import { reloadAndAssert } from "../../src/_platform/_lifecycle/steps/reload";
import { probeUrlOf, smoke } from "../../src/_platform/_lifecycle/steps/smoke";

const g = globalThis as any;

const ENTRY = new TextEncoder().encode("console.log(\"demo entry\");\n");
const CSS = new TextEncoder().encode(".demo{color:red}\n");
const sha384b64 = (d: Uint8Array) => createHash("sha384").update(d).digest("base64");
const INT = `sha384-${sha384b64(ENTRY)}`;

let root: string;
let staging: string;
let dist: string;
let siteModulesDir: string;
let modulesJsonPath: string;

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-deploy-smoke-"));
	staging = join(root, "staging");
	dist = join(root, "dist");
	siteModulesDir = join(dist, "modules");
	modulesJsonPath = join(dist, "modules.json");
	g.fs = nodeFsFace();
});

afterEach(async () => {
	g.fs = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

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

function stateStore(): StateStore {
	return { read: () => ({ solutions: {} }), write: async () => {} };
}

function solManifest(overrides: Record<string, unknown> = {}): any {
	return {
		name: "demo-solution",
		version: "0.1.0",
		peerRuntime: ">=0.0.0",
		api: { prefix: "/api/demo-solution", anonymous: ["demo-solution/ping"] },
		web: {
			entry: "modules/demo-solution/0.1.0/entry.js",
			css: ["modules/demo-solution/0.1.0/main.css"],
		},
		routes: [
			{ path: "/demo-solution/ping", category: "hidden", order: 205, title_key: "demo-solution:menu.ping" },
			{ path: "/demo-solution", category: "main", order: 200, title_key: "demo-solution:menu.main" },
			{ path: "/demo-solution/report", category: "hidden", order: 210, title_key: "demo-solution:menu.report" },
		],
		permissions: [{ code: "demo-solution.view", title_key: "demo-solution:perm.view" }],
		roles: [{ name: "demo-solution.admin", title_key: "demo-solution:role.admin", permissions: ["demo-solution.view"] }],
		settings: {
			groups: [{
				group: "display",
				label_key: "demo-solution:settings.group.display",
				items: [{ key: "demo-solution.display.theme", type: "enum" }],
			}],
		},
		...overrides,
	};
}

function dwCtx(overrides: Partial<DeployWebContext> = {}): DeployWebContext {
	return {
		manifest: solManifest(),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		stagingDir: staging,
		siteModulesDir,
		modulesJsonPath,
		integrity: INT,
		...overrides,
	};
}

function smCtx(overrides: Partial<SmokeContext> = {}): SmokeContext {
	return {
		manifest: solManifest(),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		apiPrefix: "/api/demo-solution",
		fetch: async () => ({ ok: true, status: 200 }),
		sha384B64: sha384b64,
		modulesJsonPath,
		query: async () => ({
			module: "demo-solution",
			routes: ["/demo-solution", "/demo-solution/ping", "/demo-solution/report"],
			settings: ["demo-solution.display.theme"],
			roles: ["demo-solution.admin"],
			permissions: ["demo-solution.view"],
		}),
		...overrides,
	};
}

/** 种出「已部署落位」状态：产物文件 + modules.json 条目（smoke integrity 比对基准；withIntegrity=false 验缺 integrity fail-closed） */
async function seedDeployed(withIntegrity = true): Promise<void> {
	const out = join(siteModulesDir, "demo-solution", "0.1.0");
	await fsp.mkdir(out, { recursive: true });
	await fsp.writeFile(join(out, "entry.js"), ENTRY);
	await fsp.writeFile(join(out, "main.css"), CSS);
	await fsp.mkdir(dist, { recursive: true });
	const entry: Record<string, unknown> = {
		name: "demo-solution",
		entry: "modules/demo-solution/0.1.0/entry.js",
		enabled: true,
		css: ["modules/demo-solution/0.1.0/main.css"],
	};
	if (withIntegrity) {
		entry.integrity = INT;
	}
	await fsp.writeFile(modulesJsonPath, `${JSON.stringify([entry])}\n`);
}

/** 种出 staging web 产物树（deployWeb 复制来源；含子目录验证递归复制） */
async function seedStagingWeb(): Promise<string> {
	const src = join(staging, "web", "modules", "demo-solution", "0.1.0");
	await fsp.mkdir(join(src, "assets"), { recursive: true });
	await fsp.writeFile(join(src, "entry.js"), ENTRY);
	await fsp.writeFile(join(src, "main.css"), CSS);
	await fsp.writeFile(join(src, "assets", "logo.svg"), new TextEncoder().encode("<svg/>"));
	return src;
}

describe("upsertModulesJson（R30 POSIX + D13 读-改-原子写）", () => {
	it("反斜杠路径序列化为 POSIX（R30）：entry/css 统一 / 落盘", async () => {
		await upsertModulesJson({
			name: "demo-solution",
			entry: "modules\\demo-solution\\0.1.0\\entry.js",
			enabled: true,
			css: ["modules\\demo-solution\\0.1.0\\main.css"],
		}, { modulesJsonPath });
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
		expect(list[0].entry).toBe("modules/demo-solution/0.1.0/entry.js");
		expect(list[0].css).toEqual(["modules/demo-solution/0.1.0/main.css"]);
		expect(posixPath("a\\b\\c.js")).toBe("a/b/c.js");
	});

	it("首次 upsert 创建清单：JSON 完整解析（无半截），条目字段齐", async () => {
		await upsertModulesJson({ name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: true }, { modulesJsonPath });
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
		expect(list).toHaveLength(1);
		expect(list[0]).toEqual({ name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: true });
	});

	it("同名整体替换 + 他模块条目原样保留；重复 upsert 幂等", async () => {
		const other = { name: "other", entry: "modules/other/1.0.0/entry.js", enabled: true, chunks: [{ url: "modules/other/1.0.0/entry.js", integrity: "sha384-x", lazy: false }] };
		await fsp.mkdir(dist, { recursive: true });
		await fsp.writeFile(modulesJsonPath, `${JSON.stringify([other], null, 2)}\n`);
		const first: ModuleEntry = { name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: true, integrity: INT };
		await upsertModulesJson(first, { modulesJsonPath });
		await upsertModulesJson({ ...first, entry: "modules/demo-solution/9.9.9/entry.js" }, { modulesJsonPath });
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
		expect(list).toHaveLength(2);
		expect(list.find((e: ModuleEntry) => e.name === "other")).toEqual(other);
		const mine = list.filter((e: ModuleEntry) => e.name === "demo-solution");
		expect(mine).toHaveLength(1);
		expect(mine[0].entry).toBe("modules/demo-solution/9.9.9/entry.js");
	});

	it("损坏 modules.json 拒绝 upsert（不覆盖丢失他模块条目）", async () => {
		await fsp.mkdir(dist, { recursive: true });
		await fsp.writeFile(modulesJsonPath, "{\"name\": \"other\", \"entr");
		await expect(upsertModulesJson(
			{ name: "demo-solution", entry: "modules/demo-solution/0.1.0/entry.js", enabled: true },
			{ modulesJsonPath },
		)).rejects.toThrow("拒绝 upsert");
	});
});

describe("deployWeb（stage=deploying：staging/web 树 → 站点 modules 目录 + 清单 upsert）", () => {
	it("真复制：落位文件树与来源一致（含子目录），modules.json 条目 entry POSIX + integrity 透传", async () => {
		const src = await seedStagingWeb();
		const r = await deployWeb(dwCtx());
		expect(r.stage).toBe("deploying");
		expect(r.ok).toBe(true);
		const out = join(siteModulesDir, "demo-solution", "0.1.0");
		expect(new Uint8Array(await fsp.readFile(join(out, "entry.js")))).toEqual(ENTRY);
		expect(new Uint8Array(await fsp.readFile(join(out, "main.css")))).toEqual(CSS);
		expect(new Uint8Array(await fsp.readFile(join(out, "assets", "logo.svg")))).toEqual(new TextEncoder().encode("<svg/>"));
		expect(await fsp.readdir(join(out, "assets"))).toEqual(await fsp.readdir(join(src, "assets")));
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
		expect(list[0]).toEqual({
			name: "demo-solution",
			entry: "modules/demo-solution/0.1.0/entry.js",
			enabled: true,
			css: ["modules/demo-solution/0.1.0/main.css"],
			integrity: INT,
			peerRuntime: ">=0.0.0",
		});
	});

	it("ctx.integrity 优先于 manifest.web.integrity（P1-10 验签后重算口径，R10）", async () => {
		await seedStagingWeb();
		await deployWeb(dwCtx({
			manifest: solManifest({ web: { entry: "modules/demo-solution/0.1.0/entry.js", integrity: "sha384-STALE" } }),
		}));
		const list = JSON.parse(await fsp.readFile(modulesJsonPath, "utf8"));
		expect(list[0].integrity).toBe(INT);
	});

	it("manifest 无 web 段：api-only no-op ok，零落盘零清单变更", async () => {
		const r = await deployWeb(dwCtx({ manifest: solManifest({ web: undefined }) }));
		expect(r.ok).toBe(true);
		await expect(fsp.readdir(siteModulesDir)).rejects.toThrow();
		await expect(fsp.readFile(modulesJsonPath)).rejects.toThrow();
	});

	it("web.entry 已声明而 staging/web 缺失：ok=false retryable=false（包结构违约，C2-27）", async () => {
		const r = await deployWeb(dwCtx());
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("web");
	});

	it("modules.json 损坏：部署失败且清单不被半写", async () => {
		await seedStagingWeb();
		await fsp.mkdir(dist, { recursive: true });
		await fsp.writeFile(modulesJsonPath, "not-json");
		const r = await deployWeb(dwCtx());
		expect(r.ok).toBe(false);
		expect(await fsp.readFile(modulesJsonPath, "utf8")).toBe("not-json");
	});
});

describe("reloadAndAssert（stage=reloading：R18 unchanged=失败）", () => {
	function rlCtx(result?: ReloadResult, throws = false): ReloadContext {
		const face: ReloadFace = {
			reloadConfig: throws
				? async () => {
					throw new Error("server.reloadConfig: reload in progress (busy)");
				}
				: async () => result ?? { generation: 8, unchanged: false, applied: ["mounts"], restart_pending: [], kept_listener: [] },
		};
		return { manifest: solManifest(), name: "demo-solution", version: "0.1.0", state: stateStore(), reload: face };
	}

	it("成功：applied 含 mounts → ok=true，message 含 generation", async () => {
		const r = await reloadAndAssert(rlCtx());
		expect(r.stage).toBe("reloading");
		expect(r.ok).toBe(true);
		expect(r.message).toContain("8");
	});

	it("unchanged → ok=false（R18：幂等回显 = config 改写未生效）", async () => {
		const r = await reloadAndAssert(rlCtx({ generation: 7, unchanged: true, applied: [] }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("unchanged");
	});

	it("face 抛错（并发 busy）→ ok=false retryable=true", async () => {
		const r = await reloadAndAssert(rlCtx(undefined, true));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("busy");
	});

	it("expected 段键未生效：applied 缺 vars → ok=false（R18 以实际生效值断言）", async () => {
		const r = await reloadAndAssert({ ...rlCtx(), expected: ["mounts", "vars"] });
		expect(r.ok).toBe(false);
		expect(r.message).toContain("vars");
	});

	it("返回形状违约（applied 非数组）→ ok=false retryable=false", async () => {
		const r = await reloadAndAssert(rlCtx({ unchanged: false, applied: "mounts" } as unknown as ReloadResult));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
	});
});

describe("probeUrlOf（探针 URL 形态：apiPrefix/<path 去前导斜杠>，与 C2-26 段内收敛一致）", () => {
	it("health /demo-solution/ping → /api/demo-solution/demo-solution/ping", () => {
		expect(probeUrlOf("/api/demo-solution", "/demo-solution/ping")).toBe("/api/demo-solution/demo-solution/ping");
	});
});

describe("smoke 探活（D14/Q-A：health 不强制）", () => {
	it("health 声明：探 <apiPrefix>/<health>，2xx 过", async () => {
		await seedDeployed();
		const urls: string[] = [];
		const r = await smoke(smCtx({
			manifest: solManifest({ health: "/demo-solution/ping" }),
			fetch: async (url) => {
				urls.push(url);
				return { ok: true, status: 200 };
			},
		}));
		expect(urls).toEqual(["/api/demo-solution/demo-solution/ping"]);
		expect(r.ok).toBe(true);
	});

	it("health 非 2xx → 探活失败", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({
			manifest: solManifest({ health: "/demo-solution/ping" }),
			fetch: async () => ({ ok: false, status: 500 }),
		}));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("探活");
		expect(r.message).toContain("500");
	});

	it("无 health：首个非匿名路由连通即可（401 亦过），匿名路由被跳过", async () => {
		await seedDeployed();
		const urls: string[] = [];
		const r = await smoke(smCtx({
			fetch: async (url) => {
				urls.push(url);
				return { ok: false, status: 401 };
			},
		}));
		expect(urls).toEqual(["/api/demo-solution/demo-solution"]);
		expect(r.ok).toBe(true);
	});

	it("无 health 且 fetch 抛错 → 探活失败", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({
			fetch: async () => {
				throw new Error("ECONNREFUSED");
			},
		}));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("探活");
	});

	it("无 health 无路由：无事可验视为过", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({
			manifest: solManifest({ routes: undefined, api: undefined, roles: undefined, permissions: undefined, settings: undefined }),
			query: async () => null,
		}));
		expect(r.ok).toBe(true);
	});
});

describe("smoke integrity（R10：部署落位后重算 sha384 vs modules.json）", () => {
	it("落位产物与清单一致 → 过", async () => {
		await seedDeployed();
		const r = await smoke(smCtx());
		expect(r.ok).toBe(true);
	});

	it("篡改一字节 → 失败，message 含期望与实得摘要", async () => {
		await seedDeployed();
		await fsp.writeFile(join(siteModulesDir, "demo-solution", "0.1.0", "entry.js"), new TextEncoder().encode("console.log(\"demo entrY\");\n"));
		const r = await smoke(smCtx());
		expect(r.ok).toBe(false);
		expect(r.message).toContain("integrity");
		expect(r.message).toContain(INT);
		expect(r.message).toContain(`sha384-${sha384b64(new TextEncoder().encode("console.log(\"demo entrY\");\n"))}`);
	});

	it("modules.json 条目缺 integrity → 失败（fail-closed，P1-10 必传）", async () => {
		await seedDeployed(false);
		const r = await smoke(smCtx());
		expect(r.ok).toBe(false);
		expect(r.message).toContain("fail-closed");
	});

	it("声明 css 未落位 → 失败", async () => {
		await seedDeployed();
		await fsp.rm(join(siteModulesDir, "demo-solution", "0.1.0", "main.css"));
		const r = await smoke(smCtx());
		expect(r.ok).toBe(false);
		expect(r.message).toContain("main.css");
	});

	it("manifest 无 web 段：integrity 项不适用（api-only 不因清单缺条目失败）", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({ manifest: solManifest({ web: undefined, api: undefined, routes: undefined, settings: undefined, roles: undefined, permissions: undefined }) }));
		expect(r.ok).toBe(true);
	});
});

describe("smoke 注册一致性（升级态「包含非相等」）", () => {
	it("快照超集（含已废弃遗留行）→ 过", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({
			query: async () => ({
				module: "demo-solution",
				routes: ["/demo-solution", "/demo-solution/ping", "/demo-solution/report", "/demo-solution/legacy"],
				settings: ["demo-solution.display.theme", "demo-solution.display.legacy"],
				roles: ["demo-solution.admin"],
				permissions: ["demo-solution.view"],
			}),
		}));
		expect(r.ok).toBe(true);
	});

	it("快照缺声明项 → 失败（注册丢失判失败，少 = 不可）", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({
			query: async () => ({
				module: "demo-solution",
				routes: ["/demo-solution"],
				settings: [],
				roles: ["demo-solution.admin"],
				permissions: ["demo-solution.view"],
			}),
		}));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("demo-solution.display.theme");
		expect(r.message).toContain("demo-solution/report");
	});

	it("快照 null + 声明全空 → 过（首装无 RBAC/设置/路由声明）", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({
			manifest: solManifest({ routes: undefined, roles: undefined, permissions: undefined, settings: undefined, api: undefined, web: undefined }),
			query: async () => null,
		}));
		expect(r.ok).toBe(true);
	});

	it("快照 null + 声明非空 → 失败", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({ query: async () => null }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("注册");
	});

	it("快照查询抛错 → 失败", async () => {
		await seedDeployed();
		const r = await smoke(smCtx({ query: async () => {
			throw new Error("db locked");
		} }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("db locked");
	});
});

describe("smoke collect-all（失败全量齐报）", () => {
	it("探活与 integrity 同败：两项原因齐入 message", async () => {
		await seedDeployed();
		await fsp.writeFile(join(siteModulesDir, "demo-solution", "0.1.0", "entry.js"), new TextEncoder().encode("tampered"));
		const r = await smoke(smCtx({
			manifest: solManifest({ health: "/demo-solution/ping" }),
			fetch: async () => ({ ok: false, status: 503 }),
		}));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("【探活】");
		expect(r.message).toContain("【integrity】");
	});

	it("全过 → ok=true，三项齐名；entry 浏览器加载口径入 message（设计 §4.1）", async () => {
		await seedDeployed();
		const r = await smoke(smCtx());
		expect(r.ok).toBe(true);
		expect(r.message).toContain("探活");
		expect(r.message).toContain("integrity");
		expect(r.message).toContain("注册一致性");
		expect(r.message).toContain("浏览器");
	});
});
