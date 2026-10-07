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

import type { Buffer } from "node:buffer";
import type { Duplex } from "node:stream";
import http from "node:http";
import net from "node:net";

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

/**
 * 上游拒连等人话 502：**信封与 oj 一致（`code`/`msg`/`data`）**。
 * 前端 request client 只认 oj 信封，早前的 message/success/result 是另一套形状，
 * 会让 502 被当成未知响应而不是可展示的错误。
 */
function respondBadGateway(res: http.ServerResponse, target: string, error: string): void {
	res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({
		code: 502,
		msg: `[ojm] oj 上游不可达（${target}）：${error}`,
		data: null,
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

/**
 * WebSocket 升级请求的**原始字节隧道**（M5b，协作编辑器）。
 *
 * `proxyApi` 是纯 HTTP 反代——而 `upgrade` 是 hop-by-hop 头，且 Node 为协议升级
 * 单发 `server.on("upgrade")` 事件，HTTP 请求处理器根本收不到。不隧道化则 dev 形态
 * 下浏览器到 `/api/realtime/ws` 的 WS 永远握不上手（M5b 实测假红：协作 provider
 * 全部 offline、标题/锁控制帧发不出、编辑器不挂载）。
 *
 * 做法：把 upgrade 请求的**初始字节**（请求行 + 头 + 可能已到的 body 分片）原样
 * 发给上游，之后双向 pipe——WS 帧是流，代理不做任何解析。Host 与 proxyApi 同口径
 * 改写为上游。生产形态浏览器与 oj 同源直连，不走这里。
 */
export function proxyWsUpgrade(
	target: string,
): (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void {
	const upstream = new URL(target);
	return (req, socket, head) => {
		const port = Number(upstream.port) || (upstream.protocol === "https:" ? 443 : 80);
		const upstreamSocket = net.connect({ host: upstream.hostname, port }, () => {
			const headerLines = Object.entries(req.headers)
				.map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
				.join("\r\n");
			upstreamSocket.write(`${req.method ?? "GET"} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
			if (head.length > 0)
				upstreamSocket.write(head);
			upstreamSocket.pipe(socket);
			socket.pipe(upstreamSocket);
		});
		upstreamSocket.on("error", (err) => {
			// 上游拒连：握手尚未响应时还能说人话（与 proxyApi 的 502 信封同形），
			// 已经 pipe 起来就只能掐线
			if (socket.writable && !socket.destroyed) {
				socket.end(
					`HTTP/1.1 502 Bad Gateway\r\ncontent-type: application/json\r\n\r\n${
						JSON.stringify({ code: 502, message: `[ojm] WS 上游不可达（${target}）：${err.message}`, success: false, result: null })
					}`,
				);
			}
			socket.destroy();
			upstreamSocket.destroy();
		});
		socket.on("error", () => {
			upstreamSocket.destroy();
		});
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
