// 企微普通模式机器人 → 代理访问本进程 /api/mcp（多租户 + 按用户权限）。
//
// 架构（方案重评估 §4）：本仓业务 handler，进程内用 bridge.call 转发（R7，oj 0.1.131 落地），
// 取代原「独立编排层」——避免同进程 fetch 回 /mcp 在并发 ≥ pool_size 下全池挂死。
//
// 链路：
//  - initialize / ping / tools/list → 发现身份（用入站 svc Bearer 直转 /api/mcp，不做 obo）
//  - tools/call → 必须 X-WeCom-User-Id → 先 obo 换受托 token（bridge.call /api/auth/obo）
//                  → 再 bridge.call /api/mcp（受托 token）
//  - 响应 status + body 字节原样透传（json.stream 全透传，覆盖 200 JSON / 202 空体 / 406·415 信封）
//  - obo 失败 4031x → 映射为 JSON-RPC error（HTTP 200，避免破坏 MCP 帧；方案 §4.3#6）
//
// 头置换（§4.3#2）：剥 X-WeCom-User-Id / X-TENANT-ID / 原 svc Bearer，租户从 Bearer claim 推导
// （不转租户头，防 403 tenant header does not match signed claim）；强制 content-type / accept。
//
// 死锁差异：obo 与 /mcp 两步都用 bridge.call（目标在隔离内部分发池执行，不占公共 actor 槽），
// 且两步是顺序调用、非嵌套，深度恒为 1（dispatch 目标再 call 才 503），故并发任意高也不死锁。

import { OBO_MSG } from "#/_platform/_shared/service/domain/bot";

// oj 默认 API 挂载前缀（api-manual §2：缺省 /v1/api；本模板契约经 -b /api 生成，仅文档口径）。
// bridge.call 走进程内路由表，必须用**运行时**前缀 /v1/api（否则 /api/auth/obo、/api/mcp 全 404）。
// 若部署改了 base，经 vars.oj_api_base 覆盖。
const API_BASE = (vars.get("oj_api_base") ?? "/v1/api").replace(/\/+$/, "");

/** 解析入站 JSON-RPC 帧的 method 与 id（仅用于分派与错误映射；转发用原始字节不重序列化）。 */
function parseFrame(buf: Uint8Array): { method?: string, id: unknown } {
	try {
		const o = JSON.parse(new TextDecoder().decode(buf)) as Record<string, unknown>;
		return { method: typeof o.method === "string" ? o.method : undefined, id: o.id };
	}
	catch {
		return { id: null };
	}
}

async function post() {
	const raw = await http.bodyBytes();
	const frame = parseFrame(raw);
	const method = frame.method;

	// 入站 svc Bearer（机器人长期凭据，claims.tenant 即租户）；原样转发给 obo / mcp。
	const auth = (http.headers.authorization ?? http.headers.Authorization ?? "").trim();
	if (!/^Bearer\s+/i.test(auth)) {
		json.fail(401, "missing bearer"); // proxy 自身守卫（oj 鉴权中间件通常已挡，这里再兜底 fail-closed）
		return;
	}

	const headersBase: Record<string, string> = {
		"content-type": "application/json",
		"accept": "application/json, text/event-stream",
	};

	// tools/call 必须带 X-WeCom-User-Id（企微在企业域名下注入），缺则 fail-closed 400。
	const userId = (http.headers["x-wecom-user-id"] ?? http.headers["X-WeCom-User-Id"] ?? "").trim();

	let mcpAuth = auth; // 发现身份：直接用 svc Bearer
	if (method === "tools/call") {
		if (!userId) {
			json.fail(400, "tools/call requires X-WeCom-User-Id");
			return;
		}
		// obo 换签：进程内 bridge.call（不占公共 actor 槽，避免死锁）。
		const oboResp = await bridge.call({
			method: "POST",
			path: `${API_BASE}/auth/obo`,
			headers: { "content-type": "application/json", "authorization": auth },
			body: JSON.stringify({ provider: "wecom", external_sub: userId }),
		});
		const oboText = await oboResp.text();
		let obo: { code?: number, msg?: string, data?: { access_token?: string } } = {};
		try {
			obo = JSON.parse(oboText);
		}
		catch {
			obo = {};
		}
		if (!obo || obo.code !== 0 || !obo.data?.access_token) {
			// 4031x → JSON-RPC error，HTTP 200（不破坏 MCP 帧；方案 §4.3#6）。
			const code = typeof obo?.code === "number" ? obo.code : -32000;
			const msg = obo?.msg ?? OBO_MSG[code as keyof typeof OBO_MSG] ?? "obo failed";
			json.header("content-type", "application/json");
			json.raw({
				jsonrpc: "2.0",
				id: frame.id,
				error: { code: -32000, message: `[code=${code}] ${msg}`, data: { code } },
			});
			return;
		}
		mcpAuth = `Bearer ${obo.data.access_token}`;
	}

	// 转发 /api/mcp（bridge.call 取代进程外 fetch，消除死锁）。
	const r = await bridge.call({
		method: "POST",
		path: `${API_BASE}/mcp`,
		headers: { ...headersBase, authorization: mcpAuth },
		body: raw,
	});

	// 全透传：status + body 字节原样（覆盖 200 JSON / 202 空体 / 406·415 信封）。
	const buf = new Uint8Array(await r.arrayBuffer());
	const ct = r.headers.get("content-type") ?? "application/json";
	const s = json.stream({ status: r.status, contentType: ct });
	if (buf.length > 0)
		s.write(buf);
	s.end();
}

// JSON-RPC 帧形态不定，仅放行对象；method 级分派在 handler 内。
// 响应为进程内透传（json.stream / json.raw / json.fail），形态随 /mcp 与 obo 原样，故 response 仅声明为对象。
post.schema = {
	description: "企微机器人 MCP 代理入口：接收 MCP JSON-RPC 单帧并代理到本进程 /api/mcp（多租户 + 按员工权限）。initialize/ping/tools/list 用入站 svc Bearer 直接转发；tools/call 必须先带 X-WeCom-User-Id，代理会先换 10 分钟受托 token 再转发。请求体必须是 MCP 帧（jsonrpc/method/id/params）；响应 status 与字节原样透传（200 JSON / 202 空体 / 406·415 信封）。换签失败映射为 JSON-RPC error（HTTP 200，code 见 data.code 40310/40311/40312/40313）。",
	body: { type: "object", description: "MCP JSON-RPC 帧，如 {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{...}}；形态随方法变化，故此处不细化字段。" },
};
post.response = {
	type: "object",
	description: "MCP JSON-RPC 响应（由 /api/mcp 原样透传），通常为 {jsonrpc,id,result} 或 {jsonrpc,id,error}。",
};

export default { post };
