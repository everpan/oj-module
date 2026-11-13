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
const GEN_OK = { match: (url: string) => url.includes("/_system/config"), res: () => jsonRes(200, { generation: 7, sha256: "loaded-sha", modules: ["wiki"] }) };
// sha256/modules 字段仅为真实响应形状备忘（真机 2026-11-10 演练）；两态判定已不消费 sha。

describe("fetchMcpCatalog：§4.1 数据表（HTTP → 归一）", () => {
	it("当 {base}/mcp 对 tools/list 返回 200，则 status=mounted：tools 归一（tags[0]=模块名/hints/params 三键子集）+ 分组稳定 + generation 顺带探得", async () => {
		const { fn, calls } = seqFetch([
			{ match: u => u.includes("/mcp"), res: () => jsonRes(200, TOOLS_LIST) },
			GEN_OK,
		]);
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok", base: "/api", tenant: "default" });

		expect(r.status).toBe("mounted");
		expect(r.generation).toBe(7);
		// 上游事实修正（真机演练钉出，F10 作废）：/api/mcp 在外层 tenant 中间件之后——缺
		// X-TENANT-ID 即 400「missing tenant header」。出站必须透传租户头。
		expect(calls[0]!.init?.headers?.["x-tenant-id"]).toBe("default");
		expect(calls[1]!.init?.headers?.["x-tenant-id"]).toBe("default");
		// 结果透出 tenant（页面接入配置要给外部 MCP client 写全请求头）
		expect(r.tenant).toBe("default");
		// 分组：按 tags[0]，首现顺序稳定；无 tags 归空串组
		expect(r.groups.map(g => g.module)).toEqual(["wiki", "order", ""]);
		expect(r.groups[0]!.tools.map(t => t.name)).toEqual(["wiki_search", "wiki_delete"]);
		const search = r.groups[0]!.tools[0]!;
		expect(search).toMatchObject({ name: "wiki_search", description: "搜索 wiki 页面", module: "wiki", readOnly: true, destructive: false, params: ["path", "query"] });
		expect(r.groups[0]!.tools[1]).toMatchObject({ readOnly: false, destructive: true, params: ["path"] });
		expect(r.groups[1]!.tools[0]).toMatchObject({ module: "order", params: ["path", "query", "body"] });
		expect(r.groups[2]!.tools[0]).toMatchObject({ module: "", params: [] });
		// 出站形态：POST {origin}/mcp；显式 Accept: application/json（F6 406 陷阱服务端规避）+ JWT 透传
		expect(calls[0]!.url).toBe(`${ORIGIN}/api/mcp`);
		expect(calls[0]!.init?.headers?.accept).toBe("application/json");
		expect(calls[0]!.init?.headers?.authorization).toBe("Bearer tok");
		expect(calls[1]!.url).toBe(`${ORIGIN}/api/_system/config`);
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
			const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok", base: "/api" });
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
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok", base: "/api" });
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
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok", base: "/api" });
		expect(r.status).toBe("mounted");
		expect(r.generation).toBeUndefined();

		const fn2 = async (url: string) => {
			if (url.includes("/mcp"))
				return jsonRes(200, TOOLS_LIST) as any;
			throw new TypeError("config probe down");
		};
		const r2 = await fetchMcpCatalog({ fetch: fn2, origin: ORIGIN, token: "tok", base: "/api" });
		expect(r2.status).toBe("mounted");
		expect(r2.generation).toBeUndefined();
	});
});

// —— 列表面三态（server.mcp.expose，oj 0.1.134）：flat / grouped / routed 与 routed 枚举 ——
const META_LIST = {
	jsonrpc: "2.0",
	id: 1,
	result: { tools: [{ name: "oj_search_tools" }, { name: "oj_list_groups" }] },
};
const metaCall = (structured: unknown) => ({ jsonrpc: "2.0", id: 1, result: { content: [], structuredContent: structured } });
const metaErr = (message: string) => ({ jsonrpc: "2.0", id: 1, error: { code: -32601, message } });

/** 按 JSON-RPC method / tools-call name 分派的桩：routed 会对同一 URL 连打多次 */
function rpcStub(handlers: { list?: () => unknown, tool: Record<string, (args: Record<string, unknown>) => unknown> }) {
	const calls: Array<{ method: string, name?: string, args?: Record<string, unknown> }> = [];
	const fn = async (url: string, init?: { body?: string }) => {
		if (url.includes("/_system/config")) {
			return jsonRes(200, { generation: 9 });
		}
		const req = JSON.parse(String(init?.body ?? "{}")) as { method?: string, params?: { name?: string, arguments?: Record<string, unknown> } };
		const method = String(req.method);
		const name = req.params?.name;
		const args = req.params?.arguments;
		calls.push({ method, name, args });
		if (method === "tools/list") {
			return jsonRes(200, handlers.list?.() ?? { jsonrpc: "2.0", id: 1, result: { tools: [] } });
		}
		const h = name === undefined ? undefined : handlers.tool[name];
		return jsonRes(200, h === undefined ? metaErr(`unknown tool ${String(name)}`) : metaCall(h(args ?? {})));
	};
	return { fn, calls };
}

describe("列表面三态（server.mcp.expose，oj 0.1.134）", () => {
	it("当 无 _meta 且 tools 非元工具，则 expose=flat、分组照 tags[0]", async () => {
		const { fn } = rpcStub({ list: () => TOOLS_LIST });
		const r = await fetchMcpCatalog({ fetch: fn as any, origin: ORIGIN, token: "tok", base: "/api" });
		expect(r.expose).toBe("flat");
		expect(r.groups.map(g => g.module)).toEqual(["wiki", "order", ""]);
		expect(r.message).toBeUndefined();
	});

	it("当 result 带 _meta 分组面，则 expose=grouped 且 tools 仍按 tags[0] 全量归一", async () => {
		const list = () => ({
			jsonrpc: "2.0",
			id: 1,
			result: {
				tools: (TOOLS_LIST.result.tools),
				_meta: { "com.only-js.groups": [{ name: "wiki", tool_count: 2 }, { name: "order", tool_count: 1 }] },
			},
		});
		const { fn } = rpcStub({ list });
		const r = await fetchMcpCatalog({ fetch: fn as any, origin: ORIGIN, token: "tok", base: "/api" });
		expect(r.expose).toBe("grouped");
		expect(r.groups.map(g => g.module)).toEqual(["wiki", "order", ""]);
	});

	it("当 tools 恰好是两个元工具（routed），则经 oj_list_groups + 逐组 oj_search_tools 枚举，声明数更大时标 truncated", async () => {
		const { fn, calls } = rpcStub({
			list: () => META_LIST,
			tool: {
				oj_list_groups: () => ({ groups: [{ name: "wiki", tool_count: 3 }] }),
				// 检索结果形状：group 字段（无 tags）+ annotations + inputSchema
				oj_search_tools: () => ({
					matches: [
						{ name: "wiki_search", description: "搜索页面", group: "wiki", annotations: { readOnlyHint: true }, inputSchema: { properties: { query: {} } } },
						{ name: "wiki_delete", group: "wiki", annotations: { destructiveHint: true }, inputSchema: { properties: { path: {}, body: {} } } },
					],
				}),
			},
		});
		const r = await fetchMcpCatalog({ fetch: fn as any, origin: ORIGIN, token: "tok", base: "/api" });

		expect(r.status).toBe("mounted");
		expect(r.expose).toBe("routed");
		expect(r.generation).toBe(9);
		expect(r.groups).toHaveLength(1);
		expect(r.groups[0]!.module).toBe("wiki");
		expect(r.groups[0]!.tools.map(t => t.name)).toEqual(["wiki_search", "wiki_delete"]);
		// group 字段回填 module（检索结果无 tags）；hints 与三键子集同口径
		expect(r.groups[0]!.tools[0]).toMatchObject({ module: "wiki", readOnly: true, destructive: false, params: ["query"] });
		expect(r.groups[0]!.tools[1]).toMatchObject({ destructive: true, params: ["path", "body"] });
		// 上游声明 3 个、检索只回 2 个 → 本组未取全
		expect(r.groups[0]!.truncated).toBe(true);
		// 检索用「组名」当 query（子串必命中本组 group 维度）+ 精确 group 过滤 + limit 50
		const search = calls.find(c => c.name === "oj_search_tools");
		expect(search?.args).toEqual({ query: "wiki", group: "wiki", limit: 50 });
		// routed 的说明文案随目录下发（页面原样展示）
		expect(r.message ?? "").toContain("routed");
		expect(r.message ?? "").toContain("50");
	});

	it("当 routed 下 oj_list_groups 失败，则 status=mounted 但 groups 空 + 人话说明（不误判为未启用）", async () => {
		const { fn } = rpcStub({
			list: () => META_LIST,
			tool: { oj_list_groups: () => { throw new TypeError("boom"); } },
		});
		const r = await fetchMcpCatalog({ fetch: fn as any, origin: ORIGIN, token: "tok", base: "/api" });
		expect(r.status).toBe("mounted");
		expect(r.expose).toBe("routed");
		expect(r.groups).toEqual([]);
		expect(r.message ?? "").toContain("枚举失败");
	});

	it("当 routed 下某组检索失败，则该组按空组展示并计入说明（其余组不受影响）", async () => {
		const { fn } = rpcStub({
			list: () => META_LIST,
			tool: {
				oj_list_groups: () => ({ groups: [{ name: "wiki", tool_count: 1 }, { name: "order", tool_count: 1 }] }),
				oj_search_tools: args => (args.group === "order" ? { matches: [{ name: "order_create", group: "order" }] } : (() => { throw new TypeError("down"); })()),
			},
		});
		const r = await fetchMcpCatalog({ fetch: fn as any, origin: ORIGIN, token: "tok", base: "/api" });
		expect(r.groups.map(g => g.module)).toEqual(["wiki", "order"]);
		expect(r.groups[0]!.tools).toEqual([]);
		expect(r.groups[1]!.tools.map(t => t.name)).toEqual(["order_create"]);
		expect(r.message ?? "").toContain("1 个分组的工具枚举失败");
	});
});

describe("unmounted 两态判定（20261110-1027 §4.3 修订：磁盘 server.mcp.enabled 直读，§8 真机钉出 sha 物理不符后重设计）", () => {
	// 真机事实（2026-11-10 演练）：_system/config 的 sha256 = doc_sha(解析后 YAML 规范指纹)，
	// 非原始文件字节 sha——磁盘文件 sha 永不相等，sha 对比方案整案作废。改为：模块自读磁盘
	// config 的 server.mcp.enabled（engine 无关），404 联合判定两态。
	it.each([
		["磁盘 enabled=true 而 404 → 「已修改未触发热更」（或热更失败）", true, "已修改", "热更"],
		["磁盘 enabled=false 而 404 → 「尚未修改」", false, "尚未修改", "enabled 改为 true"],
	])("当 404 且 磁盘 config %s", async (_name, diskEnabled, ...needles) => {
		const { fn } = seqFetch([
			{ match: u => u.includes("/mcp"), res: () => jsonRes(404, { error: "not found" }) },
		]);
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok", base: "/api", diskMcpEnabled: async () => diskEnabled });
		expect(r.status).toBe("unmounted");
		for (const n of needles)
			expect(r.message ?? "", needles.join("/")).toContain(n);
	});

	it("当 404 且 磁盘读失败或 dep 缺省，则保持原「未挂载」文案不误报（fail-closed 不猜）", async () => {
		const { fn } = seqFetch([
			{ match: u => u.includes("/mcp"), res: () => jsonRes(404, { error: "not found" }) },
		]);
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok", base: "/api", diskMcpEnabled: async () => {
			throw new Error("disk gone");
		} });
		expect(r.message ?? "").toContain("未挂载");

		const { fn: fn2 } = seqFetch([
			{ match: u => u.includes("/mcp"), res: () => jsonRes(404, { error: "not found" }) },
		]);
		const r2 = await fetchMcpCatalog({ fetch: fn2, origin: ORIGIN, token: "tok", base: "/api" });
		expect(r2.message ?? "").toContain("未挂载");
	});

	it("当 404 且 磁盘 enabled 键缺失（undefined），则保持「未挂载」不猜", async () => {
		const { fn } = seqFetch([
			{ match: u => u.includes("/mcp"), res: () => jsonRes(404, { error: "not found" }) },
		]);
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok", base: "/api", diskMcpEnabled: async () => undefined });
		expect(r.message ?? "").toContain("未挂载");
	});

	it("当 mounted，则不触发磁盘读取（目录态与磁盘无涉）", async () => {
		let reads = 0;
		const { fn } = seqFetch([
			{ match: u => u.includes("/mcp"), res: () => jsonRes(200, TOOLS_LIST) },
			GEN_OK,
		]);
		const r = await fetchMcpCatalog({ fetch: fn, origin: ORIGIN, token: "tok", base: "/api", diskMcpEnabled: async () => {
			reads++;
			return true;
		} });
		expect(r.status).toBe("mounted");
		expect(reads).toBe(0);
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
		await api.mcp.catalog.get();
		expect(last?.status).toBe(403);
	});

	it("当 superadmin 但无 Authorization 头，则 401 可读（/mcp 上游同样以该 JWT 鉴权）", async () => {
		const api = createMarketApi(makeEnv({ fetch: MCP_FETCH }));
		g.http = { user: { id: 1 }, headers: {} };
		await api.mcp.catalog.get();
		expect(last?.status).toBe(401);
		expect(String(last?.msg)).toContain("Bearer");
	});

	it("当 superadmin 带登录态 JWT，则转发站点 canonical origin 的 /mcp（REG-CS6 不读 Host）并返回目录", async () => {
		const seen: string[] = [];
		const fetchSpy = (async (url: string, init?: { headers?: Record<string, string> }) => {
			seen.push(`${url}|${init?.headers?.authorization ?? ""}|${init?.headers?.accept ?? ""}|${init?.headers?.["x-tenant-id"] ?? ""}`);
			return MCP_FETCH(url, init);
		}) as any;
		const api = createMarketApi(makeEnv({ fetch: fetchSpy }));
		// 头键大小写随客户端（wecom/api.ts 同款口径）
		g.http = { user: { id: 1 }, headers: { "Authorization": "Bearer browser-jwt", "X-TENANT-ID": "default" } };
		await api.mcp.catalog.get();
		expect(last?.status).toBe(200);
		// {base} = env.apiPrefix（API 挂载前缀，reload.rs system_fallback 口径）——出站 URL 是
		// origin + 前缀 + /mcp，不是站点根 /mcp（真机演练钉出，§8）
		expect(seen[0]).toContain("http://site.example:9781/api/demo-solution/mcp");
		expect(seen[0]).toContain("Bearer browser-jwt");
		expect(seen[0]).toContain("application/json");
		// 租户头透传（F10 修正：/api/mcp 缺 X-TENANT-ID 即 400，真机演练钉出）
		// seen 格式 url|auth|accept|tenant——末段为租户头值
		expect(seen[0].split("|").pop()).toBe("default");
		expect(seen[1].split("|").pop()).toBe("default");
		expect((last?.data as { status?: string, tenant?: string })?.status).toBe("mounted");
		expect((last?.data as { tenant?: string })?.tenant).toBe("default");
	});

	it("当 请求未带 X-TENANT-ID，则出站不带租户头、结果不透出 tenant（不猜租户）", async () => {
		const seen: string[] = [];
		const fetchSpy = (async (url: string, init?: { headers?: Record<string, string> }) => {
			seen.push(`${url}|${init?.headers?.["x-tenant-id"] ?? ""}`);
			return MCP_FETCH(url, init);
		}) as any;
		const api = createMarketApi(makeEnv({ fetch: fetchSpy }));
		g.http = { user: { id: 1 }, headers: { Authorization: "Bearer browser-jwt" } };
		await api.mcp.catalog.get();
		expect(last?.status).toBe(200);
		expect(seen[0]).toContain("|");
		expect((last?.data as { tenant?: string })?.tenant).toBeUndefined();
	});
});
