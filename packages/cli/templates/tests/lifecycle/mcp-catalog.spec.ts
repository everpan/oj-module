// BDD：MCP 目录代理端点消费面（20261110-1027 §4.1，T5/US-4）。
// fetchMcpCatalog：站点 {base}/mcp tools/list 代理 + tags[0] 分组归一 + _system/config 代际
// 顺带探测。§4.1 数据表（HTTP → 归一）为验收锚点；api.ts 端点只做门禁+取参+origin 解析
// （R9 superadmin / 同 upload·trust 纪律，编排归本模块）。v1 无 audit 联查（§10 #11）。
import type { MarketEnv } from "../../src/oj-market/api/api";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateAllUsers } from "../../src/app/api/_platform/_shared/service/infra/access";
import { createMarketApi } from "../../src/oj-market/api/api";
import { fetchMcpCatalog } from "../../src/oj-market/api/mcp-catalog";
import { installDb } from "../fixture";

const ORIGIN = "http://site.example:9781";

/** tools/list JSON-RPC 夹具：wiki(读+危险)/order/无 tags 四工具，覆盖归一与分组口径 */
const TOOLS_LIST = {
	jsonrpc: "2.0",
	id: 1,
	result: {
		tools: [
			{
				name: "wiki_search",
				description: "搜索 wiki 页面",
				tags: ["wiki"],
				annotations: { readOnlyHint: true },
				inputSchema: { properties: { path: {}, query: {} } },
			},
			{
				name: "wiki_delete",
				tags: ["wiki"],
				annotations: { destructiveHint: true },
				inputSchema: { properties: { path: {} } },
			},
			{
				name: "order_create",
				tags: ["order"],
				inputSchema: { properties: { path: {}, query: {}, body: {} } },
			},
			{ name: "no_tag_tool" },
		],
	},
};

interface FetchStubCall {
	url: string
	init?: { headers?: Record<string, string> }
}

/** 顺序响应桩：第 n 次调用按 routes[n] 回（路由 = URL 含 /mcp 或 /_system/config 的判定函数） */
function seqFetch(routes: Array<{ match: (url: string) => boolean, res: () => unknown | Promise<unknown> }>) {
	const calls: FetchStubCall[] = [];
	const fn = async (url: string, init?: { headers?: Record<string, string> }) => {
		calls.push({ url, init });
		for (const r of routes) {
			if (r.match(url)) {
				return await r.res() as { ok: boolean, status: number, arrayBuffer: () => Promise<ArrayBuffer> };
			}
		}
		throw new TypeError(`unexpected fetch ${url}`);
	};
	return { fn, calls };
}

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => enc(JSON.stringify(body)) });
const GEN_OK = { match: (url: string) => url.includes("/_system/config"), res: () => jsonRes(200, { generation: 7, modules: ["wiki"] }) };

describe("fetchMcpCatalog：§4.1 数据表（HTTP → 归一）", () => {
	it("当 {base}/mcp 对 tools/list 返回 200，则 status=mounted：tools 归一（tags[0]=模块名/hints/params 三键子集）+ 分组稳定 + generation 顺带探得", async () => {
		const { fn, calls } = seqFetch([
			{ match: u => u.includes("/mcp"), res: () => jsonRes(200, TOOLS_LIST) },
			GEN_OK,
		]);
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok" });

		expect(r.status).toBe("mounted");
		expect(r.generation).toBe(7);
		// 分组：按 tags[0]，首现顺序稳定；无 tags 归空串组
		expect(r.groups.map(g => g.module)).toEqual(["wiki", "order", ""]);
		expect(r.groups[0]!.tools.map(t => t.name)).toEqual(["wiki_search", "wiki_delete"]);
		const search = r.groups[0]!.tools[0]!;
		expect(search).toMatchObject({ name: "wiki_search", description: "搜索 wiki 页面", module: "wiki", readOnly: true, destructive: false, params: ["path", "query"] });
		expect(r.groups[0]!.tools[1]).toMatchObject({ readOnly: false, destructive: true, params: ["path"] });
		expect(r.groups[1]!.tools[0]).toMatchObject({ module: "order", params: ["path", "query", "body"] });
		expect(r.groups[2]!.tools[0]).toMatchObject({ module: "", params: [] });
		// 出站形态：POST {origin}/mcp；显式 Accept: application/json（F6 406 陷阱服务端规避）+ JWT 透传
		expect(calls[0]!.url).toBe(`${ORIGIN}/mcp`);
		expect(calls[0]!.init?.headers?.accept).toBe("application/json");
		expect(calls[0]!.init?.headers?.authorization).toBe("Bearer tok");
		expect(calls[1]!.url).toBe(`${ORIGIN}/_system/config`);
	});

	it("当 上游各异常形态，则按数据表归一（404=unmounted / 401·403=auth 透传 msg / 5xx·形状违约=unreachable）", async () => {
		const cases: Array<{ name: string, status: number, body: unknown, status2: string, msg?: string }> = [
			{ name: "404（mcp 未启用或 oj < 0.1.110）", status: 404, body: { error: "not found" }, status2: "unmounted" },
			{ name: "401 鉴权失败", status: 401, body: "token 过期", status2: "auth", msg: "token 过期" },
			{ name: "403 拒绝", status: 403, body: "\"forbidden\"", status2: "auth", msg: "forbidden" },
			{ name: "500 上游错误", status: 500, body: "boom", status2: "unreachable", msg: "HTTP 500" },
			{ name: "200 但非 tools/list 形状", status: 200, body: { foo: 1 }, status2: "unreachable", msg: "形状" },
		];
		for (const c of cases) {
			const { fn } = seqFetch([
				{ match: u => u.includes("/mcp"), res: () => jsonRes(c.status, c.body) },
				GEN_OK,
			]);
			const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok" });
			expect(r.status, c.name).toBe(c.status2);
			expect(r.groups, c.name).toEqual([]);
			if (c.msg !== undefined)
				expect(r.message ?? "", c.name).toContain(c.msg);
		}
	});

	it("当 网络失败（fetch reject），则 unreachable 且文案含「网络不可达」——与 canonical_origin 未配置区分", async () => {
		const fn = async () => {
			throw new TypeError("connection refused");
		};
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok" });
		expect(r.status).toBe("unreachable");
		expect(r.message ?? "").toContain("网络不可达");
	});

	it("当 canonical_origin 未解析（origin 空串），则 unreachable 且文案点名 canonical_origin，不发起任何出站", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			return jsonRes(200, TOOLS_LIST);
		};
		const r = await fetchMcpCatalog({ fetch: fn, origin: "", token: "tok" });
		expect(r.status).toBe("unreachable");
		expect(r.message ?? "").toContain("canonical_origin");
		expect(calls).toBe(0);
	});

	it("当 代际探测 404（reload_api 关闭）或抛错，则 generation 省略、目录状态不受影响", async () => {
		const { fn } = seqFetch([
			{ match: u => u.includes("/mcp"), res: () => jsonRes(200, TOOLS_LIST) },
			{ match: u => u.includes("/_system/config"), res: () => jsonRes(404, { error: "disabled" }) },
		]);
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok" });
		expect(r.status).toBe("mounted");
		expect(r.generation).toBeUndefined();

		const fn2 = async (url: string) => {
			if (url.includes("/mcp"))
				return jsonRes(200, TOOLS_LIST) as any;
			throw new TypeError("config probe down");
		};
		const r2 = await fetchMcpCatalog({ fetch: fn2, origin: ORIGIN, token: "tok" });
		expect(r2.status).toBe("mounted");
		expect(r2.generation).toBeUndefined();
	});
});

// —— api.ts 端点管道（门禁 + JWT 取参 + origin 解析；§4.1 场景的消费面接线）——
const g = globalThis as any;

let root: string;
let last: { status: number, msg?: string, data?: unknown } | null = null;

function makeEnv(overrides: Partial<MarketEnv> = {}): MarketEnv {
	const sharedRoot = join(root, "modules");
	return {
		sharedRoot,
		staging: join(sharedRoot, ".staging"),
		taskDir: join(sharedRoot, ".install-tasks"),
		statePath: join(sharedRoot, ".solutions", "state.yaml"),
		trustPath: join(sharedRoot, ".solutions", "trusted-keys.yaml"),
		dbPath: join(root, "db.sqlite"),
		siteModulesDir: join(root, "dist", "modules"),
		modulesJsonPath: join(root, "dist", "modules.json"),
		apiPrefix: "/api/demo-solution",
		canonicalOrigin: "http://site.example:9781",
		...overrides,
	};
}

const MCP_FETCH = (async (url: string) => {
	if (url.includes("/mcp"))
		return jsonRes(200, TOOLS_LIST) as any;
	return jsonRes(200, { generation: 3 }) as any;
}) as any;

describe("gET /api/oj-market/mcp/catalog 端点管道（superadmin，R9）", () => {
	beforeEach(async () => {
		root = await fsp.mkdtemp(join(tmpdir(), "ojm-mcp-catalog-"));
		g.fs = undefined;
		g.http = {};
		g.json = {
			ok: (data: unknown) => {
				last = { status: 200, data };
			},
			fail: (status: number, msg: string) => {
				last = { status, msg };
			},
		};
		// installDb 返回裸句柄（.prepare 断言用）并装配 globalThis.db（.table 查询构造器）
		installDb().prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
		last = null;
	});

	afterEach(async () => {
		g.http = undefined;
		g.json = undefined;
		g.db = undefined;
		invalidateAllUsers();
		await fsp.rm(root, { recursive: true, force: true });
	});

	it("当 非 superadmin 访问，则 403（拒权不泄露存在性，R9 同款）", async () => {
		const api = createMarketApi(makeEnv({ fetch: MCP_FETCH }));
		g.http = { user: { id: 2 }, headers: { authorization: "Bearer tok" } };
		await api["mcp/catalog"].get();
		expect(last?.status).toBe(403);
	});

	it("当 superadmin 但无 Authorization 头，则 401 可读（/mcp 上游同样以该 JWT 鉴权）", async () => {
		const api = createMarketApi(makeEnv({ fetch: MCP_FETCH }));
		g.http = { user: { id: 1 }, headers: {} };
		await api["mcp/catalog"].get();
		expect(last?.status).toBe(401);
		expect(String(last?.msg)).toContain("Bearer");
	});

	it("当 superadmin 带登录态 JWT，则转发站点 canonical origin 的 /mcp（REG-CS6 不读 Host）并返回目录", async () => {
		const seen: string[] = [];
		const fetchSpy = (async (url: string, init?: { headers?: Record<string, string> }) => {
			seen.push(`${url}|${init?.headers?.authorization ?? ""}|${init?.headers?.accept ?? ""}`);
			return MCP_FETCH(url, init);
		}) as any;
		const api = createMarketApi(makeEnv({ fetch: fetchSpy }));
		// 头键大小写随客户端（wecom/api.ts 同款口径）
		g.http = { user: { id: 1 }, headers: { Authorization: "Bearer browser-jwt" } };
		await api["mcp/catalog"].get();
		expect(last?.status).toBe(200);
		expect(seen[0]).toContain("http://site.example:9781/mcp");
		expect(seen[0]).toContain("Bearer browser-jwt");
		expect(seen[0]).toContain("application/json");
		expect((last?.data as { status?: string })?.status).toBe("mounted");
	});
});
