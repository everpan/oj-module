// MCP 目录代理端点消费面（20261110-1027 §4.1，T5/US-4）：站点 {base}/mcp tools/list 代理 +
// tags[0] 分组归一 + _system/config 代际顺带探测。SRP：api.ts 端点只做门禁 + 取 JWT + origin
// 解析（同 upload/trust 纪律）；出站编排与归一收口本模块。v1 无 audit 联查（§10 #11）。
// 上游事实（oj-bin 只读核实，F 系列）：/mcp 为 streamable HTTP stateless 子集，tools/list
// 免 initialize 握手；`Accept: */*` 会 406（F6）——本面显式 application/json；/mcp 不走租户
// 管线（F10），浏览器 JWT 原样透传即可；`_system/config` 在 reload_api 关闭时 404（F7）。

import type { FetchInitFace } from "#/_platform/_shared/site-facade";

/** 工具目录条目（上游 tools/list 元素归一视图；静态统计由前端据本面推导，§4.1） */
export interface McpToolView {
	name: string
	description?: string
	/** API 模块名（上游 tags[0]，openapi 生成口径 F1；缺失 = "" 归未分组） */
	module: string
	/** annotations.readOnlyHint（GET 类工具 true，F1） */
	readOnly: boolean
	/** annotations.destructiveHint（DELETE 类工具 true，F1） */
	destructive: boolean
	/** inputSchema 实际声明键（path/query/body 子集，F1 固定三键） */
	params: string[]
}

export interface McpCatalogGroup {
	/** 模块名（= 方案 api 模块名；空串 = 上游无 tags 的杂项工具） */
	module: string
	tools: McpToolView[]
}

export type McpCatalogStatus = "mounted" | "unmounted" | "auth" | "unreachable";

export interface McpCatalogResult {
	status: McpCatalogStatus
	/** 人话说明：auth = 上游 msg 透传；unreachable = origin 解析原因或网络失败（两者文案刻意可区分，§4.1） */
	message?: string
	/** 热更代际（`GET {base}/_system/config` 顺带探测，F7）；reload_api 关闭/探测失败省略 */
	generation?: number
	groups: McpCatalogGroup[]
}

export interface McpCatalogDeps {
	/** 出站拉取面（api.ts fetchOf：REG-CS6 canonical origin 补全，绝不读请求头 Host） */
	fetch: FetchInitFace
	/** 站点 canonical origin（已解析）；空串 = 未配置（REG-CS6 fail-closed 不猜） */
	origin: string
	/** 浏览器登录态 JWT（/mcp 与 _system/config 同一凭据面） */
	token: string
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** tools/list 元素归一（宽容：畸形元素跳过，不炸整表） */
export function normalizeTools(raw: unknown): McpToolView[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: McpToolView[] = [];
	for (const item of raw) {
		const o = isObj(item) ? item : {};
		if (typeof o.name !== "string" || o.name === "") {
			continue;
		}
		const tags = Array.isArray(o.tags) ? o.tags : [];
		const annotations = isObj(o.annotations) ? o.annotations : {};
		const inputSchema = isObj(o.inputSchema) ? o.inputSchema : {};
		const props = isObj(inputSchema.properties) ? inputSchema.properties : {};
		out.push({
			name: o.name,
			description: typeof o.description === "string" && o.description !== "" ? o.description : undefined,
			module: typeof tags[0] === "string" ? tags[0] : "",
			readOnly: annotations.readOnlyHint === true,
			destructive: annotations.destructiveHint === true,
			params: ["path", "query", "body"].filter(k => k in props),
		});
	}
	return out;
}

/** 按 tags[0] 分组（首现顺序稳定；空串组殿后置自然序，不做重排） */
export function groupTools(tools: McpToolView[]): McpCatalogGroup[] {
	const groups = new Map<string, McpToolView[]>();
	for (const t of tools) {
		const list = groups.get(t.module) ?? [];
		list.push(t);
		groups.set(t.module, list);
	}
	return [...groups].map(([module, ts]) => ({ module, tools: ts }));
}

/** 上游错误正文 → 可读 msg（JSON 字符串/`{error}` 解包；原文截断兜底） */
function upstreamMsg(bodyText: string): string | undefined {
	const raw = bodyText.trim();
	if (raw === "") {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "string" && parsed !== "") {
			return parsed;
		}
		if (isObj(parsed) && typeof parsed.error === "string" && parsed.error !== "") {
			return parsed.error;
		}
	}
	catch {
		// 非 JSON 正文 → 原文兜底
	}
	return raw.slice(0, 200);
}

/** 代际顺带探测（F7）：任何失败（reload_api 关闭 404 / 网络异常 / 形状违约）都静默省略 */
async function probeGeneration(deps: McpCatalogDeps, headers: Record<string, string>): Promise<number | undefined> {
	try {
		const res = await deps.fetch(`${deps.origin}/_system/config`, { headers: { accept: "application/json", authorization: headers.authorization } });
		if (res.status !== 200) {
			return undefined;
		}
		const parsed: unknown = JSON.parse(new TextDecoder().decode(await res.arrayBuffer()));
		const gen = isObj(parsed) ? parsed.generation : undefined;
		return typeof gen === "number" ? gen : undefined;
	}
	catch {
		return undefined;
	}
}

/**
 * 拉取并归一 MCP 工具目录（§4.1 数据表为验收锚点）：
 * - 200 tools/list → mounted（归一+分组 + generation 顺带探测）；
 * - 404 → unmounted（mcp 未启用或 oj < 0.1.110）；
 * - 401/403 → auth（透传上游 msg）；
 * - 网络失败 → unreachable（「网络不可达」）；
 * - canonical_origin 未解析（origin 空串）→ unreachable（点名 canonical_origin，零出站）；
 * - 其余 HTTP 码 / 200 非 JSON-RPC 形状 → unreachable（可读原因）。
 */
export async function fetchMcpCatalog(deps: McpCatalogDeps): Promise<McpCatalogResult> {
	if (deps.origin === "") {
		return {
			status: "unreachable",
			groups: [],
			message: "canonical_origin 未配置：无法定位站点 {base}（请在 config.yaml vars.canonical_origin 配置站点真实对外地址；REG-CS6 不读请求头 Host）",
		};
	}
	const headers = { "content-type": "application/json", "accept": "application/json", "authorization": `Bearer ${deps.token}` };
	let status: number;
	let bodyText: string;
	try {
		const res = await deps.fetch(`${deps.origin}/mcp`, {
			method: "POST",
			headers,
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
		});
		status = res.status;
		bodyText = new TextDecoder().decode(await res.arrayBuffer());
	}
	catch (e) {
		return { status: "unreachable", groups: [], message: `网络不可达：${String(e)}` };
	}
	if (status === 404) {
		return { status: "unmounted", groups: [], message: "{base}/mcp 未挂载（server.mcp 未启用，或 oj < 0.1.110）" };
	}
	if (status === 401 || status === 403) {
		return { status: "auth", groups: [], message: upstreamMsg(bodyText) ?? `上游鉴权失败（HTTP ${status}）` };
	}
	if (status !== 200) {
		return { status: "unreachable", groups: [], message: `上游 {base}/mcp 返回 HTTP ${status}` };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText);
	}
	catch {
		return { status: "unreachable", groups: [], message: `tools/list 响应形状违约：正文非 JSON（前 120 字节：${bodyText.slice(0, 120)}）` };
	}
	const tools = isObj(parsed) && isObj(parsed.result) ? parsed.result.tools : undefined;
	if (!Array.isArray(tools)) {
		return { status: "unreachable", groups: [], message: "tools/list 响应形状违约：期望 JSON-RPC result.tools 数组" };
	}
	const generation = await probeGeneration(deps, headers);
	const base = { status: "mounted" as const, groups: groupTools(normalizeTools(tools)) };
	return generation !== undefined ? { ...base, generation } : base;
}
