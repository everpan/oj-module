import type { AddressInfo } from "node:net";
import type { OjProcess } from "../../packages/cli/src/oj";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { devServer } from "../../packages/cli/src/dev";

/**
 * 设计 §4（P3）：ojm dev 全栈接线。
 *  - 全栈模式（工程有 api/config.yaml）：/api/* 反代 oj，不进 mock；
 *    ojStarter 收到绝对路径 config/base/apiSrc
 *  - 纯前端模式（无 api/config.yaml）：mock 行为不变（回归）
 *  - 宿主 HTML（/ 与 SPA 深链接）注入外链 /__ojm_reload.js（CSP 无 nonce 可用）
 *  - /__ojm_reload.js 外链脚本、/__ojm_reload SSE 通道
 *  - watch 随布局（新布局 modules/src）：变更 → 重建（可注入）→ SSE 广播 reload
 *  - server.close() 回收 oj 子进程
 */

const FIXTURE_ROOT = path.join(process.cwd(), ".tmp-dev-fx");

function makeFixture(kind: "fullstack" | "frontend", base = "/api"): { root: string, port: number } {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, `dev-${kind}-`));
	const port = 21000 + Math.floor(Math.random() * 1000); // 并行测试端口区间不得重叠（playground-oj 设计 §10）
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
	fs.mkdirSync(path.join(root, "modules/src"), { recursive: true });
	fs.writeFileSync(path.join(root, "modules/src/entry.ts"), "export default {};\n");
	const shellDist = path.join(root, "shell-dist");
	fs.mkdirSync(shellDist, { recursive: true });
	fs.writeFileSync(path.join(shellDist, "index.html"), "<html><head><title>stub</title></head><body><div id=\"app\"></div></body></html>");
	fs.mkdirSync(path.join(root, "mock"), { recursive: true });
	fs.writeFileSync(path.join(root, "mock/demo.mock.mjs"), [
		"export default [",
		"  { url: \"/hello\", method: \"get\", response: () => ({ code: 200, mocked: true }) },",
		"];",
		"",
	].join("\n"));
	if (kind === "fullstack") {
		fs.mkdirSync(path.join(root, "api/src"), { recursive: true });
		fs.writeFileSync(path.join(root, "api/config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\n  base: ${base}\n`);
	}
	return { root, port };
}

function listenOn(server: http.Server): Promise<number> {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
	});
}

function get(port: number, reqPath: string, headers: http.OutgoingHttpHeaders = {}): Promise<{
	status: number
	headers: http.IncomingHttpHeaders
	text: string
}> {
	return new Promise((resolve, reject) => {
		http.get({ host: "127.0.0.1", port, path: reqPath, headers }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", chunk => chunks.push(chunk as Buffer));
			res.on("end", () => resolve({
				status: res.statusCode ?? 0,
				headers: res.headers,
				text: Buffer.concat(chunks).toString(),
			}));
		}).on("error", reject);
	});
}

/** 桩 oj：真监听的 http server + 可注入 starter */
function stubOjUpstream(expectedBase = "/api") {
	const seen: string[] = [];
	let stopped = false;
	const server = http.createServer((_req, res) => {
		seen.push(_req.url ?? "");
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ code: 0, from: "oj" }));
	});
	return {
		server,
		seen,
		get stopped() {
			return stopped;
		},
		starter: (upPort: number, configPath: string) => (cfg: string, base: string, apiSrc: string): OjProcess => {
			expect(path.isAbsolute(cfg)).toBe(true);
			expect(cfg).toBe(configPath);
			expect(base).toBe(expectedBase);
			expect(path.isAbsolute(apiSrc)).toBe(true);
			return {
				port: upPort,
				ready: Promise.resolve(),
				stop: async () => {
					stopped = true;
				},
			};
		},
	};
}

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

async function stopServer(server: http.Server) {
	await new Promise<void>(resolve => server.close(() => resolve()));
}

describe("devServer 全栈接线", () => {
	it("全栈模式：/api/* 反代 oj 不进 mock；server.close 回收 oj", async () => {
		const { root, port } = makeFixture("fullstack");
		const configPath = path.join(root, "api/config.yaml");
		const up = stubOjUpstream();
		const upPort = await listenOn(up.server);
		const builds: string[] = [];

		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {
				builds.push("initial");
			},
			ojStarter: up.starter(upPort, configPath),
		});
		const devPort = (server.address() as AddressInfo).port;

		expect(up.seen.length).toBe(0); // 启动阶段不请求 oj
		const res = await get(devPort, "/api/hello");
		expect(res.status).toBe(200);
		expect(JSON.parse(res.text)).toMatchObject({ from: "oj" }); // 走了反代
		expect(up.seen).toEqual(["/api/hello"]); // 不剥前缀
		expect(builds).toEqual(["initial"]); // 初始构建用过注入 fn

		await stopServer(server);
		expect(up.stopped).toBe(true); // oj 被回收
		up.server.close();
	});

	it("纯前端模式回归：无 api/config.yaml 时 /api/* 走 mock", async () => {
		const { root, port } = makeFixture("frontend");
		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
		});
		const devPort = (server.address() as AddressInfo).port;

		const res = await get(devPort, "/api/hello");
		expect(res.status).toBe(200);
		expect(JSON.parse(res.text)).toMatchObject({ mocked: true });

		await stopServer(server);
	});

	it("宿主 HTML（/ 与深链接）注入外链 /__ojm_reload.js；脚本端点 text/javascript", async () => {
		const { root, port } = makeFixture("frontend");
		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
		});
		const devPort = (server.address() as AddressInfo).port;

		for (const reqPath of ["/", "/some/deep/route"]) {
			const res = await get(devPort, reqPath, { Accept: "text/html" });
			expect(res.status).toBe(200);
			expect(res.headers["content-type"]).toContain("text/html");
			expect(res.text).toContain("/__ojm_reload.js");
		}

		const script = await get(devPort, "/__ojm_reload.js");
		expect(script.status).toBe(200);
		expect(script.headers["content-type"]).toContain("text/javascript");
		expect(script.text).toContain("EventSource");

		await stopServer(server);
	});

	it("watch 随布局（modules/src）：变更 → 注入重建 → SSE 广播 reload", async () => {
		const { root, port } = makeFixture("frontend");
		const builds: string[] = [];
		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {
				builds.push("build");
			},
		});
		const devPort = (server.address() as AddressInfo).port;

		const chunks: string[] = [];
		const sseReq = http.get({ host: "127.0.0.1", port: devPort, path: "/__ojm_reload" }, (res) => {
			res.setEncoding("utf-8");
			res.on("data", chunk => chunks.push(chunk));
		});

		// 等客户端完成注册（收到 retry:）再触发变更，保证广播不被错过
		await new Promise<void>((resolve, reject) => {
			const started = Date.now();
			const check = () => {
				if (chunks.join("").includes("retry:"))
					resolve();
				else if (Date.now() - started > 3000)
					reject(new Error("SSE 未连接"));
				else
					setTimeout(check, 20);
			};
			check();
		});

		fs.writeFileSync(path.join(root, "modules/src/touch.ts"), "export {};\n");

		await new Promise<void>((resolve, reject) => {
			const started = Date.now();
			const check = () => {
				if (chunks.join("").includes("event: reload"))
					resolve();
				else if (Date.now() - started > 6000)
					reject(new Error(`6s 内未收到 reload 广播；chunks=${JSON.stringify(chunks)}`));
				else
					setTimeout(check, 50);
			};
			check();
		});

		expect(builds.length).toBeGreaterThanOrEqual(2); // 初始构建 + watch 触发的重建
		sseReq.destroy(); // SSE 连接不断开则 server.close 永不回调
		await stopServer(server);
	}, 15000);

	it("f2：反代前缀跟随 config.yaml 的 server.base（非 /api 时 /api/* 不再进 oj）", async () => {
		const { root, port } = makeFixture("fullstack", "/apiv2");
		const configPath = path.join(root, "api/config.yaml");
		const up = stubOjUpstream("/apiv2");
		const upPort = await listenOn(up.server);

		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
			ojStarter: up.starter(upPort, configPath),
		});
		const devPort = (server.address() as AddressInfo).port;

		const proxied = await get(devPort, "/apiv2/web/hello");
		expect(JSON.parse(proxied.text)).toMatchObject({ from: "oj" });

		const offBase = await get(devPort, "/api/hello");
		expect(offBase.status).toBe(404); // 旧前缀不再反代，落静态 404

		expect(up.seen).toEqual(["/apiv2/web/hello"]);

		await stopServer(server);
		up.server.close();
	});

	it("f3：oj.ready 拒绝（health 超时/启动即退）→ 回收 oj 子进程后再抛错", async () => {
		const { root, port } = makeFixture("fullstack");
		let stopped = false;
		await expect(devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
			ojStarter: () => ({
				port: 1,
				ready: Promise.reject(new Error("health 轮询超时")),
				stop: async () => {
					stopped = true;
				},
			}),
		})).rejects.toThrowError(/health 轮询超时/);
		expect(stopped).toBe(true); // 不回收则 oj 孤儿化继续占 9778
	});

	it("f1：畸形 URL（%ZZ）→ 400，进程不崩、后续请求正常", async () => {
		const { root, port } = makeFixture("frontend");
		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
		});
		const devPort = (server.address() as AddressInfo).port;

		const bad = await get(devPort, "/api/%ZZ");
		expect(bad.status).toBe(400);

		const ok = await get(devPort, "/api/hello");
		expect(ok.status).toBe(200); // 进程存活，mock 仍工作

		await stopServer(server);
	});
});
