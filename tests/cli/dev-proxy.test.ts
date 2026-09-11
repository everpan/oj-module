import type { AddressInfo } from "node:net";
import { Buffer } from "node:buffer";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createReloadHub, proxyApi, sseScript } from "../../packages/cli/src/dev-proxy";

/**
 * 设计 §4（P3）：/api 反代与 SSE 刷新通道（纯 node:stdlib）。
 *  - 反代：method/自定义头/body/查询串保真，状态与响应头透传，
 *    hop-by-hop 头剥离（含 connection 命名头），Host 改写为上游
 *  - 上游拒连 → 502 JSON（人话信封），不是连接挂死
 *  - SSE：外链 /__ojm_reload.js + 同源 EventSource（shell CSP 无 nonce 可用），
 *    connect 即收 retry: 与心跳，broadcast 广播 event: reload
 */

function listen(server: http.Server): Promise<number> {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
	});
}

interface Res {
	status: number
	headers: http.IncomingHttpHeaders
	text: string
}

function request(port: number, opts: http.RequestOptions = {}, body?: string): Promise<Res> {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: "127.0.0.1", port, ...opts }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", chunk => chunks.push(chunk as Buffer));
			res.on("end", () => resolve({
				status: res.statusCode ?? 0,
				headers: res.headers,
				text: Buffer.concat(chunks).toString(),
			}));
		});
		req.on("error", reject);
		if (body)
			req.write(body);
		req.end();
	});
}

interface Recorded {
	method?: string
	url?: string
	headers: http.IncomingHttpHeaders
	body: string
}

/** 桩 oj：记录上游实际收到的请求 */
function stubOj(respond: (res: http.ServerResponse) => void) {
	const seen: Recorded[] = [];
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", chunk => chunks.push(chunk as Buffer));
		req.on("end", () => {
			seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
			respond(res);
		});
	});
	return { server, seen };
}

describe("proxyApi /api 反代", () => {
	it("method/自定义头/body/查询串保真，状态与响应头透传，剥 hop-by-hop 头并改写 Host", async () => {
		const upstream = stubOj((res) => {
			res.writeHead(201, { "content-type": "text/plain", "x-upstream": "yes" });
			res.end("ok-body");
		});
		const upPort = await listen(upstream.server);
		const proxy = http.createServer((req, res) => void proxyApi(`http://127.0.0.1:${upPort}`)(req, res));
		const proxyPort = await listen(proxy);

		// oj 自带 /api base（-b /api），代理转发全路径不剥前缀
		const res = await request(proxyPort, {
			method: "POST",
			path: "/api/web/echo?x=1&y=2",
			headers: { "x-custom": "abc", "connection": "x-hop", "x-hop": "secret" },
		}, JSON.stringify({ a: 1 }));

		expect(res.status).toBe(201);
		expect(res.headers["x-upstream"]).toBe("yes");
		expect(res.text).toBe("ok-body");

		const rec = upstream.seen[0]!;
		expect(rec.method).toBe("POST");
		expect(rec.url).toBe("/api/web/echo?x=1&y=2");
		expect(rec.headers["x-custom"]).toBe("abc");
		expect(rec.headers["x-hop"]).toBeUndefined(); // connection 命名的 hop-by-hop 头被剥
		expect(rec.headers.host).toBe(`127.0.0.1:${upPort}`); // Host 改写为上游
		expect(rec.body).toBe(JSON.stringify({ a: 1 }));

		proxy.close();
		upstream.server.close();
	});

	it("上游拒连 → 502 JSON 信封，不挂死", async () => {
		const proxy = http.createServer((req, res) => void proxyApi("http://127.0.0.1:1")(req, res));
		const proxyPort = await listen(proxy);

		const res = await request(proxyPort, { path: "/api/web/hi" });

		expect(res.status).toBe(502);
		expect(res.headers["content-type"]).toContain("application/json");
		expect(JSON.parse(res.text)).toMatchObject({ code: 502 });

		proxy.close();
	});
});

describe("createReloadHub SSE 刷新通道", () => {
	it("connect 即收 retry: 与心跳；broadcast 广播 event: reload（多客户端）", async () => {
		const hub = createReloadHub({ heartbeatMs: 30 });
		const server = http.createServer((req, res) => hub.handler(req, res));
		const port = await listen(server);

		const open = () => {
			const chunks: string[] = [];
			const req = http.request({ host: "127.0.0.1", port, path: "/__ojm_reload" }, (res) => {
				res.setEncoding("utf-8");
				res.on("data", chunk => chunks.push(chunk));
			});
			req.end();
			return { chunks, req };
		};
		const a = open();
		const b = open();
		await new Promise(r => setTimeout(r, 80));

		expect(a.chunks.join("")).toContain("retry:");
		expect(a.chunks.join("")).toContain(": ping");

		hub.broadcast();
		await new Promise(r => setTimeout(r, 30));

		expect(a.chunks.join("")).toContain("event: reload");
		expect(b.chunks.join("")).toContain("event: reload");

		a.req.destroy();
		b.req.destroy();
		server.close();
		hub.close();
	});
});

describe("sseScript 外链脚本", () => {
	it("引用同源 /__ojm_reload，收 reload 事件刷新页面；是纯 JS 无内联 HTML（不依赖 CSP nonce）", () => {
		const script = sseScript();
		expect(script).toContain("new EventSource(\"/__ojm_reload\")");
		expect(script).toContain("reload");
		expect(script).not.toContain("<script");
	});
});
