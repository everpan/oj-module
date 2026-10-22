// BDD：深检后端四项 + 端点（P2-7，C2-42）+ SSRF 三钉。
// 纯 diff 函数 / 探针分类 / SSRF 钉（出站拦截 / header 清洗 / 不跟随重定向）+ 端点门（401/403/404）+ 编排。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（market-api.spec 同约定） */
import type { FsFace } from "../../src/_platform/api/_lifecycle/atomic";
import type { SolutionRouteRow } from "../../src/_platform/api/_lifecycle/verify-checks";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	declaredMigrationsOf,
	declaredSettingsOf,
	diffLedger,
	diffPermRows,
	diffSettingRows,
	diffWebIntegrity,
	probeUrlOf,
	sha384B64,

	verifyRouteReachability,
} from "../../src/_platform/api/_lifecycle/verify-checks";
import { siteOrigin } from "../../src/_platform/api/market/api";
import { createSolutionsApi, solutionsEnv } from "../../src/_platform/api/solutions/api";
import { installDb } from "../fixture";

const g = globalThis as any;

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

// ============ SSRF 钉①：探测 URL 永不出站 ============
describe("SSRF 钉①：探测 URL 永不出站（probeUrlOf）", () => {
	const origin = { proto: "http", host: "localhost:9778" };
	it("相对路径 → 绝对同源 URL", () => {
		expect(probeUrlOf("/api/x", origin)).toBe("http://localhost:9778/api/x");
	});
	it("scheme:// 出站 → 抛 400", () => {
		expect(() => probeUrlOf("http://evil.com/x", origin)).toThrow(/SSRF/);
	});
	it("协议相对 // → 抛 400", () => {
		expect(() => probeUrlOf("//evil.com/x", origin)).toThrow(/SSRF/);
	});
	it("非 / 开头 → 抛 400", () => {
		expect(() => probeUrlOf("api/x", origin)).toThrow(/SSRF/);
	});
});

// ============ SSRF 钉②：siteOrigin header 清洗 ============
describe("SSRF 钉②：siteOrigin 清洗 x-forwarded-proto", () => {
	afterEach(() => {
		g.http = undefined;
	});
	it("取首个且去空白", () => {
		g.http = { headers: { "host": "h", "x-forwarded-proto": " https , http " } };
		expect(siteOrigin()).toEqual({ proto: "https", host: "h" });
	});
	it("无 host → null（非请求上下文跳过探针）", () => {
		g.http = { headers: {} };
		expect(siteOrigin()).toBeNull();
	});
});

// ============ SSRF 钉③：探针不跟随重定向 ============
describe("SSRF 钉③：探针不跟随重定向", () => {
	const origin = { proto: "http", host: "localhost:9778" };
	const routes: SolutionRouteRow[] = [{ path: "/api/a", module: "m", category: "main", order: 1, title_key: null, required_permission: null, enabled: true }];
	it("302 裸返回 → 判异常（不跟随）且 init.redirect=manual", async () => {
		const fetchFn = vi.fn(async (_url: string, init?: { redirect?: string }) => {
			expect(init?.redirect).toBe("manual");
			return { ok: false, status: 302, arrayBuffer: async () => new ArrayBuffer(0) };
		});
		const items = await verifyRouteReachability(fetchFn, routes, origin);
		expect(items).toEqual([{ id: "routes", severity: "error", subject: "/api/a", advise_key: "lifecycle.verify.routes.redirect" }]);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});

// ============ 路由可达性分类 ============
describe("路由可达性分类（verifyRouteReachability）", () => {
	const origin = { proto: "http", host: "localhost:9778" };
	const mk = (path: string, perm: string | null): SolutionRouteRow => ({ path, module: "m", category: "main", order: 1, title_key: null, required_permission: perm, enabled: true });
	it("2xx → 不打项", async () => {
		const f = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
		expect(await verifyRouteReachability(f, [mk("/a", null)], origin)).toEqual([]);
	});
	it("401 → 不打项（需登录仍可达）", async () => {
		const f = async () => ({ ok: false, status: 401, arrayBuffer: async () => new ArrayBuffer(0) });
		expect(await verifyRouteReachability(f, [mk("/a", null)], origin)).toEqual([]);
	});
	it("404 → error(anomaly)", async () => {
		const f = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
		expect(await verifyRouteReachability(f, [mk("/a", null)], origin)).toEqual([{ id: "routes", severity: "error", subject: "/a", advise_key: "lifecycle.verify.routes.anomaly" }]);
	});
	it("5xx → error(anomaly)", async () => {
		const f = async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) });
		const items = await verifyRouteReachability(f, [mk("/a", null)], origin);
		expect(items[0]?.severity).toBe("error");
		expect(items[0]?.advise_key).toBe("lifecycle.verify.routes.anomaly");
	});
	it("403 + 声明权限点 → warn(unauthenticated)", async () => {
		const f = async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) });
		expect(await verifyRouteReachability(f, [mk("/a", "m.perm")], origin)).toEqual([{ id: "routes", severity: "warn", subject: "/a", advise_key: "lifecycle.verify.routes.unauthenticated" }]);
	});
	it("403 无权限点 → error(blocked)", async () => {
		const f = async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) });
		expect(await verifyRouteReachability(f, [mk("/a", null)], origin)).toEqual([{ id: "routes", severity: "error", subject: "/a", advise_key: "lifecycle.verify.routes.blocked" }]);
	});
	it("连不通 → error(unreachable)", async () => {
		const f = async () => {
			throw new Error("ECONNREFUSED");
		};
		expect(await verifyRouteReachability(f, [mk("/a", null)], origin)).toEqual([{ id: "routes", severity: "error", subject: "/a", advise_key: "lifecycle.verify.routes.unreachable" }]);
	});
	it("出站路径 → 400 上抛（SSRF 钉①）", async () => {
		const f = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }));
		await expect(verifyRouteReachability(f, [mk("http://evil.com", null)], origin)).rejects.toMatchObject({ status: 400 });
	});
	it("origin null → info 跳过（不发起请求）", async () => {
		const f = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }));
		expect(await verifyRouteReachability(f, [mk("/a", null)], null)).toEqual([{ id: "routes", severity: "info", subject: "*", advise_key: "lifecycle.verify.routes.skipped" }]);
		expect(f).not.toHaveBeenCalled();
	});
});

// P3-10（P2-16#2）：深检静态托管绿路径——web 路由由 SPA/静态宿主 200 即视作可达且健康（绿），
// 与 API 路由同口径；诚实 404 之外，静态托管形态下不应误报 anomaly（检测能力不退化）。
describe("p3-10 深检静态托管绿路径（web route 由 SPA/静态宿主 200 ⇒ 不打项）", () => {
	const origin = { proto: "http", host: "localhost:9778" };
	const mkWeb = (path: string, cat: "main" | "hidden" = "main", perm: string | null = null): SolutionRouteRow => ({ path, module: "demo-solution", category: cat, order: 1, title_key: null, required_permission: perm, enabled: true });
	const okFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
	it("web 路由（main）由静态宿主 200 ⇒ 不打项（绿）", async () => {
		expect(await verifyRouteReachability(okFetch, [mkWeb("/demo-solution")], origin)).toEqual([]);
	});
	it("web 路由（main + hidden）同由静态宿主 200 ⇒ 全绿（ok 语义不退化）", async () => {
		expect(await verifyRouteReachability(okFetch, [mkWeb("/demo-solution"), mkWeb("/demo-solution/ping", "hidden")], origin)).toEqual([]);
	});
	it("web 路由静态宿主缺失（404）⇒ error(anomaly)（与 API 路由同口径，诚实检测不退化）", async () => {
		const f = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
		expect(await verifyRouteReachability(f, [mkWeb("/demo-solution")], origin)).toEqual([{ id: "routes", severity: "error", subject: "/demo-solution", advise_key: "lifecycle.verify.routes.anomaly" }]);
	});
});

// ============ 纯 diff 函数 ============
describe("RBAC 完整性 diffPermRows", () => {
	it("声明缺失 → error", () => {
		expect(diffPermRows(["a.perm", "b.perm"], new Set(["a.perm"]))).toEqual([{ id: "rbac", severity: "error", subject: "b.perm", advise_key: "lifecycle.verify.rbac.missing_perm" }]);
	});
	it("全齐 → 空", () => {
		expect(diffPermRows(["a.perm"], new Set(["a.perm"]))).toEqual([]);
	});
});

describe("设置完整性 diffSettingRows", () => {
	it("声明缺失 → error（永不含值）", () => {
		expect(diffSettingRows(["m:s.k1", "m:s.k2"], new Set(["m:s.k1"]))).toEqual([{ id: "settings", severity: "error", subject: "m:s.k2", advise_key: "lifecycle.verify.settings.missing_key" }]);
	});
	it("全齐 → 空", () => {
		expect(diffSettingRows(["m:s.k1"], new Set(["m:s.k1"]))).toEqual([]);
	});
});

describe("迁移账本 diffLedger", () => {
	it("未应用 → error(not_applied)", () => {
		expect(diffLedger([{ module: "m", version: 3 }], new Map([["m", null]]))).toEqual([{ id: "ledger", severity: "error", subject: "m", advise_key: "lifecycle.verify.ledger.not_applied" }]);
	});
	it("落后 → error(stale)", () => {
		expect(diffLedger([{ module: "m", version: 3 }], new Map([["m", 2]]))).toEqual([{ id: "ledger", severity: "error", subject: "m", advise_key: "lifecycle.verify.ledger.stale" }]);
	});
	it("齐 → 空", () => {
		expect(diffLedger([{ module: "m", version: 3 }], new Map([["m", 3]]))).toEqual([]);
	});
});

// ============ manifest 声明提取 ============
describe("manifest 声明提取", () => {
	it("declaredSettingsOf 摊平 groups[].items[].key", () => {
		const m = { settings: { groups: [{ group: "g", items: [{ key: "m:s.k1" }, { key: "m:s.k2" }] }, { group: "g2", items: [{ key: "m:s.k3" }] }] } };
		expect(declaredSettingsOf(m).sort()).toEqual(["m:s.k1", "m:s.k2", "m:s.k3"]);
	});
	it("无 settings / null → 空", () => {
		expect(declaredSettingsOf({})).toEqual([]);
		expect(declaredSettingsOf(null)).toEqual([]);
	});
	it("declaredMigrationsOf 取最高版本，无文件 → 空", () => {
		expect(declaredMigrationsOf(["0001__a.sql", "0003__c.sql", "0002__b.sql"], "m")).toEqual([{ module: "m", version: 3 }]);
		expect(declaredMigrationsOf([], "m")).toEqual([]);
	});
});

// ============ 端点编排 ============
let dbo: any;
let root: string;
let last: { status: number, msg?: string, data?: unknown } | null;

// ============ P4-2 web 入口 integrity（diffWebIntegrity）============
describe("P4-2 深检 web 入口 integrity（diffWebIntegrity）", () => {
	const distRoot = () => join(root, "dist");
	const entry = "modules/demo/0.1.0/main.js";
	async function seedEntry(bytes: Uint8Array) {
		const p = join(distRoot(), entry);
		await fsp.mkdir(p.slice(0, p.lastIndexOf("/")), { recursive: true });
		await fsp.writeFile(p, bytes);
	}
	it("声明 integrity 与本地资产 sha384 相符 → 不打项", async () => {
		const bytes = new TextEncoder().encode("console.log('demo')");
		await seedEntry(bytes);
		const integrity = `sha384-${sha384B64(bytes)}`;
		expect(await diffWebIntegrity([{ name: "demo", entry, integrity }], distRoot(), sha384B64)).toEqual([]);
	});
	it("integrity 不符（被篡改/损坏）→ error(integrity_mismatch)", async () => {
		const bytes = new TextEncoder().encode("console.log('demo')");
		await seedEntry(bytes);
		const items = await diffWebIntegrity([{ name: "demo", entry, integrity: "sha384-WRONG" }], distRoot(), sha384B64);
		expect(items).toEqual([{ id: "web", severity: "error", subject: entry, advise_key: "lifecycle.verify.web.integrity_mismatch" }]);
	});
	it("缺失 integrity 声明 → info(no_integrity)，非阻断", async () => {
		await seedEntry(new TextEncoder().encode("x"));
		expect(await diffWebIntegrity([{ name: "demo", entry }], distRoot(), sha384B64)).toEqual([{ id: "web", severity: "info", subject: "demo", advise_key: "lifecycle.verify.web.no_integrity" }]);
	});
	it("无 entry 条目 → info(no_entry)，非阻断", async () => {
		expect(await diffWebIntegrity([{ name: "demo" }], distRoot(), sha384B64)).toEqual([{ id: "web", severity: "info", subject: "*", advise_key: "lifecycle.verify.web.no_entry" }]);
	});
	it("entry 资产缺失（未落位）→ info(asset_missing)，非阻断", async () => {
		expect(await diffWebIntegrity([{ name: "demo", entry, integrity: "sha384-abc" }], distRoot(), sha384B64)).toEqual([{ id: "web", severity: "info", subject: entry, advise_key: "lifecycle.verify.web.asset_missing" }]);
	});
});
const fetchCalls: string[] = [];
const fetchInits: unknown[] = [];

function okFetch() {
	return async (url: string, init?: unknown) => {
		fetchCalls.push(url);
		fetchInits.push(init);
		return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
	};
}
function statusFetch(status: number) {
	return async () => ({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) });
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-verify-"));
	g.fs = nodeFsFace();
	dbo = installDb();
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
	g.yaml = { parse: async (t: string) => JSON.parse(t) };
	g.fetch = okFetch();
	last = null;
	fetchCalls.length = 0;
	fetchInits.length = 0;
});

afterEach(async () => {
	g.fs = undefined;
	g.http = undefined;
	g.json = undefined;
	g.yaml = undefined;
	g.fetch = undefined;
	g.db = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

function setHttp(over: Record<string, unknown>) {
	g.http = { user: { id: 1 }, query: { name: "demo" }, headers: { host: "localhost:9778" }, ...over };
	g.json = {
		ok: (data: unknown) => { last = { status: 200, data }; },
		fail: (status: number, msg: string) => { last = { status, msg }; },
	};
}

function makeEnv() {
	return { ...solutionsEnv(), sharedRoot: root, statePath: join(root, "state.yaml") };
}

describe("深检端点门（admin 域）", () => {
	it("未登录 → 401", async () => {
		setHttp({ user: undefined });
		await createSolutionsApi(makeEnv()).verify.post();
		expect(last?.status).toBe(401);
	});
	it("非 admin → 403（拒权不泄露存在性）", async () => {
		setHttp({ user: { id: 2 } });
		await createSolutionsApi(makeEnv()).verify.post();
		expect(last?.status).toBe(403);
	});
	it("未装方案名 → 404（端点门）", async () => {
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		expect(last?.status).toBe(404);
	});
});

describe("深检端点编排（四项）", () => {
	it("全绿：路由 200 + 无声明权限/设置/迁移 + trusted → ok=true, checks=[]", async () => {
		dbo.prepare("INSERT INTO sys_solution_route (path, module, category, \"order\", title_key, required_permission, enabled, deprecated) VALUES (?,?,?,?,?,?,?,0)").run("/api/demo", "demo", "main", 200, "demo:menu", null, 1);
		// trusted 状态：无 trust 项、无检查项 → 干净报告（checks=[]）
		await fsp.writeFile(join(root, "state.yaml"), "solutions:\n  demo:\n    version: \"0.1.0\"\n    enabled: true\n    installedAt: 0\n    trust_state: trusted\n");
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		expect(last?.status).toBe(200);
		const data = last?.data as { ok: boolean, checks: unknown[], advise: string[] };
		expect(data.ok).toBe(true);
		expect(data.checks).toEqual([]);
		expect(data.advise).toEqual([]);
		// 探针用同源绝对 URL（SSRF 钉①②）
		expect(fetchCalls[0]).toBe("http://localhost:9778/api/demo");
	});

	it("路由 404 → routes error 项，ok=false", async () => {
		dbo.prepare("INSERT INTO sys_solution_route (path, module, category, \"order\", title_key, required_permission, enabled, deprecated) VALUES (?,?,?,?,?,?,?,0)").run("/api/demo", "demo", "main", 200, "demo:menu", null, 1);
		g.fetch = statusFetch(404);
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as { ok: boolean, checks: Array<{ id: string, severity: string }> };
		expect(data.ok).toBe(false);
		expect(data.checks.some(c => c.id === "routes" && c.severity === "error")).toBe(true);
	});

	it("四项全触发（manifest 声明 vs DB 实有）：rbac/settings/ledger 各 error", async () => {
		// 路由声明权限点 demo.p（sys_permission 无 → rbac 缺失）
		dbo.prepare("INSERT INTO sys_solution_route (path, module, category, \"order\", title_key, required_permission, enabled, deprecated) VALUES (?,?,?,?,?,?,?,0)").run("/api/demo", "demo", "main", 200, "demo:menu", "demo.p", 1);
		// sys_setting 仅 demo:s.k1（manifest 声明 demo:s.k2 → settings 缺失）
		dbo.prepare("INSERT INTO sys_setting (key, module, \"group\", type, value, default_value, label_key, options, secret, deprecated) VALUES (?,?,?,?,?,?,?,?,?,0)").run("demo:s.k1", "demo", "g", "string", "", "", "demo:settings.g.k1", null, 0);
		// state（parseState 为严格逐行解析，非通用 YAML）+ manifest + migrations 落盘
		await fsp.writeFile(join(root, "state.yaml"), "solutions:\n  demo:\n    version: \"0.1.0\"\n    enabled: true\n    installedAt: 0\n");
		await fsp.mkdir(join(root, "demo-0.1.0", "migrations"), { recursive: true });
		await fsp.writeFile(join(root, "demo-0.1.0", "manifest.yaml"), JSON.stringify({ settings: { groups: [{ group: "g", items: [{ key: "demo:s.k2" }] }] } }));
		await fsp.writeFile(join(root, "demo-0.1.0", "migrations", "0003__seed.sql"), "");
		setHttp({});
		await createSolutionsApi(makeEnv()).verify.post();
		const data = last?.data as { ok: boolean, checks: Array<{ id: string, subject: string }> };
		expect(data.ok).toBe(false);
		const ids = data.checks.map(c => c.id);
		expect(ids).toContain("rbac");
		expect(ids).toContain("settings");
		expect(ids).toContain("ledger");
		expect(data.checks.find(c => c.id === "rbac")?.subject).toBe("demo.p");
		expect(data.checks.find(c => c.id === "settings")?.subject).toBe("demo:s.k2");
		expect(data.checks.find(c => c.id === "ledger")?.subject).toBe("demo");
	});

	it("P4-2 web 入口 integrity 不符 → web error 项，ok=false", async () => {
		dbo.prepare("INSERT INTO sys_solution_route (path, module, category, \"order\", title_key, required_permission, enabled, deprecated) VALUES (?,?,?,?,?,?,?,0)").run("/api/demo", "demo", "main", 200, "demo:menu", null, 1);
		const mjPath = join(root, "dist", "modules.json");
		const entry = "modules/demo/0.1.0/main.js";
		await fsp.mkdir(join(root, "dist"), { recursive: true });
		await fsp.writeFile(mjPath, JSON.stringify([{ name: "demo", entry, integrity: "sha384-WRONG" }]));
		await fsp.mkdir(join(root, "dist", "modules", "demo", "0.1.0"), { recursive: true });
		await fsp.writeFile(join(root, "dist", "modules", "demo", "0.1.0", "main.js"), "console.log('demo')");
		setHttp({});
		await createSolutionsApi({ ...makeEnv(), modulesJsonPath: mjPath }).verify.post();
		const data = last?.data as { ok: boolean, checks: Array<{ id: string, severity: string, subject: string }> };
		expect(data.ok).toBe(false);
		const web = data.checks.find(c => c.id === "web");
		expect(web?.severity).toBe("error");
		expect(web?.subject).toBe(entry);
		expect(web?.advise_key).toBe("lifecycle.verify.web.integrity_mismatch");
	});

	it("P4-2 web 入口 integrity 相符 → 不打 web 项（其余全绿则 ok=true）", async () => {
		dbo.prepare("INSERT INTO sys_solution_route (path, module, category, \"order\", title_key, required_permission, enabled, deprecated) VALUES (?,?,?,?,?,?,?,0)").run("/api/demo", "demo", "main", 200, "demo:menu", null, 1);
		const mjPath = join(root, "dist", "modules.json");
		const entry = "modules/demo/0.1.0/main.js";
		const bytes = new TextEncoder().encode("console.log('demo')");
		const integrity = `sha384-${sha384B64(bytes)}`;
		await fsp.mkdir(join(root, "dist"), { recursive: true });
		await fsp.writeFile(mjPath, JSON.stringify([{ name: "demo", entry, integrity }]));
		await fsp.mkdir(join(root, "dist", "modules", "demo", "0.1.0"), { recursive: true });
		await fsp.writeFile(join(root, "dist", "modules", "demo", "0.1.0", "main.js"), bytes);
		setHttp({});
		await createSolutionsApi({ ...makeEnv(), modulesJsonPath: mjPath }).verify.post();
		const data = last?.data as { ok: boolean, checks: Array<{ id: string }> };
		expect(data.ok).toBe(true);
		expect(data.checks.some(c => c.id === "web")).toBe(false);
	});
});
