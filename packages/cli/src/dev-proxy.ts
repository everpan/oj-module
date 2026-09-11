/**
 * /api 反向代理与 SSE 刷新通道（设计 §4，纯 node:stdlib）。
 *
 * - proxyApi：把宿主 dev server 收到的 /api/* 原样转发给 oj 上游（oj 自带
 *   `-b /api` base，路径不剥前缀）。hop-by-hop 头逐条剥离（含 connection
 *   命名头），Host 改写为上游；上游拒连回 502 JSON 信封而非挂死。
 * - createReloadHub：同源 EventSource 刷新通道。shell CSP 是
 *   `script-src 'self' + nonce`，dev server 无法给注入的内联脚本发 nonce
 *   （index.html 由 shell 预构建，nonce 每次构建随机），因此刷新逻辑走
 *   外链脚本 /__ojm_reload.js + 同源 SSE（事件 `reload`）。
 */

import http from "node:http";

/** RFC 7230 §6.1：hop-by-hop 头只作用于单条连接，代理必须剥离 */
const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"trailers",
	"transfer-encoding",
	"upgrade",
]);

/** 上游拒连等人话 502：信封形态与前端 ApiResponse 的 message 字段对齐 */
function respondBadGateway(res: http.ServerResponse, target: string, error: string): void {
	res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({
		code: 502,
		message: `[ojm] oj 上游不可达（${target}）：${error}`,
		success: false,
		result: null,
	}));
}

/** 把 /api/* 请求转发给 oj 上游（如 http://127.0.0.1:9778） */
export function proxyApi(target: string): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
	const upstream = new URL(target);
	return async (req, res) => {
		const headers: http.OutgoingHttpHeaders = {};
		const connectionNamed = new Set((req.headers.connection ?? "").split(",").map(s => s.trim()).filter(Boolean));
		for (const [name, value] of Object.entries(req.headers)) {
			if (HOP_BY_HOP.has(name) || connectionNamed.has(name))
				continue;
			headers[name] = value;
		}
		headers.host = upstream.host; // oj 按 base 路由，不关心 Host，但保持诚实

		const proxied = http.request(
			{ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers },
			(upstreamRes) => {
				const resHeaders: http.OutgoingHttpHeaders = {};
				for (const [name, value] of Object.entries(upstreamRes.headers)) {
					if (HOP_BY_HOP.has(name))
						continue;
					resHeaders[name] = value;
				}
				res.writeHead(upstreamRes.statusCode ?? 502, resHeaders);
				upstreamRes.pipe(res);
			},
		);
		proxied.on("error", (err) => {
			if (!res.headersSent)
				respondBadGateway(res, target, err.message);
			else
				res.destroy();
		});
		req.pipe(proxied);
	};
}

export interface ReloadHub {
	/** 通知所有已连接浏览器刷新（模块重建完成后调用） */
	broadcast: () => void
	/** 挂载为 GET /__ojm_reload 的 handler */
	handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
	/** 停止心跳并断开所有客户端（dev server 关闭时调用） */
	close: () => void
}

export function createReloadHub(opts: { heartbeatMs?: number } = {}): ReloadHub {
	const clients = new Set<http.ServerResponse>();
	const heartbeatMs = opts.heartbeatMs ?? 15_000;
	const write = (res: http.ServerResponse, chunk: string) => {
		try {
			res.write(chunk);
		}
		catch {
			clients.delete(res);
		}
	};

	const heartbeat = setInterval(() => {
		for (const res of clients) write(res, ": ping\n\n");
	}, heartbeatMs);
	heartbeat.unref();

	return {
		handler: (req, res) => {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
			});
			write(res, "retry: 3000\n\n");
			clients.add(res);
			res.on("close", () => clients.delete(res));
		},
		broadcast: () => {
			for (const res of clients) write(res, "event: reload\ndata: {}\n\n");
		},
		close: () => {
			clearInterval(heartbeat);
			for (const res of clients) res.destroy();
			clients.clear();
		},
	};
}

/** /__ojm_reload.js 的脚本体：外链服务（content-type: text/javascript） */
export function sseScript(): string {
	return [
		"const es = new EventSource(\"/__ojm_reload\");",
		"es.addEventListener(\"reload\", () => location.reload());",
		"",
	].join("\n");
}
