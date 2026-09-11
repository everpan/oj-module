import type { AddressInfo } from "node:net";
import type { OjProcess } from "../../packages/cli/src/oj";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { previewServer } from "../../packages/cli/src/preview";

/**
 * 设计 §6（P4）：ojm preview。
 *  - fail-fast 四查：bin/oj、api/config.yaml、modules/dist/index.html、
 *    api/dist/manifests.yaml，缺一即人话报错指向 ojm init / ojm build
 *  - migrate 非零退出 → 透传报错、不起 server（失败即退）
 *  - 成功路径：migrate → server 顺序，参数全绝对路径；默认无 --app-path，
 *    --oj-static 时传 --app-path <siteDir>（oj 静态直出，已知深链接 404 限制）
 *  - 默认 ojm 静态层：/ 与深链接回落 index.html、不注入 SSE；/api/* 反代 oj
 */

const FIXTURE_ROOT = path.join(process.cwd(), ".tmp-preview-fx");

/** 四查齐全的最小夹具（内容为桩，只求 existsSync 通过） */
function makeFixture(base = "/api"): { root: string, configPath: string, siteDir: string, apiDist: string, port: number } {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, "preview-"));
	const port = 23000 + Math.floor(Math.random() * 1000); // 并行测试端口区间不得重叠（playground-oj 设计 §10）
	fs.mkdirSync(path.join(root, "bin"), { recursive: true });
	fs.writeFileSync(path.join(root, "bin/oj"), "#!/bin/sh\nexit 0\n");
	fs.chmodSync(path.join(root, "bin/oj"), 0o755);
	fs.mkdirSync(path.join(root, "api/dist"), { recursive: true });
	fs.writeFileSync(path.join(root, "api/dist/manifests.yaml"), "modules: []\n");
	fs.writeFileSync(path.join(root, "api/config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\n  base: ${base}\n`);
	// 新布局标记（modules/src 存在 → distDir = modules/dist）
	fs.mkdirSync(path.join(root, "modules/src"), { recursive: true });
	const siteDir = path.join(root, "modules/dist");
	fs.mkdirSync(siteDir, { recursive: true });
	fs.writeFileSync(path.join(siteDir, "index.html"), "<html><head><title>site</title></head><body>site</body></html>");
	fs.writeFileSync(path.join(siteDir, "modules.json"), "[]\n");
	return { root, configPath: path.join(root, "api/config.yaml"), siteDir, apiDist: path.join(root, "api/dist"), port };
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

/** 桩 oj：真监听的 http server，承担 /api 反代上游 */
function stubOjUpstream() {
	const seen: string[] = [];
	const server = http.createServer((_req, res) => {
		seen.push(_req.url ?? "");
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ code: 0, from: "oj" }));
	});
	return { server, seen };
}

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("previewServer fail-fast 四查", () => {
	const cases = [
		{ name: "缺 bin/oj → 指向 ojm init", remove: (root: string) => fs.rmSync(path.join(root, "bin/oj")), hint: /init/ },
		{ name: "缺 api/config.yaml → 指向 ojm init", remove: (root: string) => fs.rmSync(path.join(root, "api/config.yaml")), hint: /init/ },
		{ name: "缺 index.html → 指向 ojm build", remove: (root: string) => fs.rmSync(path.join(root, "modules/dist/index.html")), hint: /build/ },
		{ name: "缺 manifests.yaml → 指向 ojm build", remove: (root: string) => fs.rmSync(path.join(root, "api/dist/manifests.yaml")), hint: /build/ },
	];
	for (const c of cases) {
		it(c.name, async () => {
			const { root } = makeFixture();
			c.remove(root);
			await expect(previewServer(root, { execOj: () => {}, ojStarter: () => ({ port: 1, ready: Promise.resolve(), stop: async () => {} }) }))
				.rejects
				.toThrowError(c.hint);
		});
	}
});

describe("previewServer 编排", () => {
	it("migrate 非零退出 → 透传报错且不起 server", async () => {
		const { root } = makeFixture();
		const started: unknown[] = [];
		await expect(previewServer(root, {
			execOj: () => {
				throw new Error("migrate boom: M004 ledger behind");
			},
			ojStarter: () => {
				started.push(1);
				return { port: 1, ready: Promise.resolve(), stop: async () => {} };
			},
		})).rejects.toThrowError(/migrate boom/);
		expect(started).toEqual([]);
	});

	it("成功路径：migrate → server 顺序、参数全绝对路径；默认无 --app-path", async () => {
		const { root, configPath, siteDir, apiDist, port } = makeFixture();
		const calls: string[][] = [];
		let started: { cfg: string, base: string, apiPath: string, extraArgs: string[] } | null = null;

		const server = await previewServer(root, {
			siteDir,
			execOj: (args) => {
				calls.push(args);
			},
			ojStarter: (cfg, base, apiPath, extraArgs) => {
				started = { cfg, base, apiPath, extraArgs };
				return { port, ready: Promise.resolve(), stop: async () => {} } satisfies OjProcess;
			},
		});
		await new Promise<void>(resolve => server.close(() => resolve()));

		expect(calls).toEqual([["migrate", "-c", configPath, "-d", apiDist]]);
		for (const arg of calls[0]!) {
			if (!["migrate", "-c", "-d"].includes(arg))
				expect(path.isAbsolute(arg)).toBe(true);
		}
		expect(started).not.toBeNull();
		const s = started as unknown as { cfg: string, base: string, apiPath: string, extraArgs: string[] };
		expect(path.isAbsolute(s.cfg)).toBe(true);
		expect(s.cfg).toBe(configPath);
		expect(s.base).toBe("/api");
		expect(path.isAbsolute(s.apiPath)).toBe(true);
		expect(s.apiPath).toBe(apiDist);
		expect(s.extraArgs).toEqual([]); // 默认静态归 ojm，不给 oj --app-path
	});

	it("--oj-static：--app-path <siteDir> 绝对路径", async () => {
		const { root, siteDir, port } = makeFixture();
		let extraArgs: string[] = [];
		const server = await previewServer(root, {
			siteDir,
			ojStatic: true,
			execOj: () => {},
			ojStarter: (_cfg, _base, _apiPath, extra) => {
				extraArgs = extra;
				return { port, ready: Promise.resolve(), stop: async () => {} } satisfies OjProcess;
			},
		});
		await new Promise<void>(resolve => server.close(() => resolve()));
		expect(extraArgs[0]).toBe("--app-path");
		expect(extraArgs[1]).toBe(siteDir);
		expect(path.isAbsolute(extraArgs[1])).toBe(true);
	});
});

describe("previewServer ojm 静态层", () => {
	it("/ 与深链接回落 index.html、无 SSE 注入；/api/* 反代桩 oj", async () => {
		const { root, siteDir } = makeFixture();
		const up = stubOjUpstream();
		const upPort = await listenOn(up.server);

		const server = await previewServer(root, {
			siteDir,
			execOj: () => {},
			ojStarter: () => ({ port: upPort, ready: Promise.resolve(), stop: async () => {} }),
		});
		const devPort = (server.address() as AddressInfo).port;

		const index = await get(devPort, "/");
		expect(index.status).toBe(200);
		expect(index.headers["content-type"]).toContain("text/html");
		expect(index.text).toContain("site");
		expect(index.text).not.toContain("__ojm_reload"); // 生产形态无 SSE 注入

		const deep = await get(devPort, "/some/deep/route", { Accept: "text/html" });
		expect(deep.status).toBe(200);
		expect(deep.text).toContain("site");

		const proxied = await get(devPort, "/api/web/hello");
		expect(JSON.parse(proxied.text)).toMatchObject({ from: "oj" });
		expect(up.seen).toEqual(["/api/web/hello"]);

		await new Promise<void>(resolve => server.close(() => resolve()));
		up.server.close();
	});

	it("f2：反代前缀跟随 config.yaml 的 server.base", async () => {
		const { root, siteDir, port } = makeFixture("/apiv2");
		const up = stubOjUpstream();
		const upPort = await listenOn(up.server);

		const server = await previewServer(root, {
			port, // 不复用默认 4173：前序用例的监听socket可能仍在排空，复用会被 ECONNRESET
			siteDir,
			execOj: () => {},
			ojStarter: () => ({ port: upPort, ready: Promise.resolve(), stop: async () => {} }),
		});
		const devPort = (server.address() as AddressInfo).port;

		const proxied = await get(devPort, "/apiv2/web/hello");
		expect(JSON.parse(proxied.text)).toMatchObject({ from: "oj" });

		const offBase = await get(devPort, "/api/web/hello");
		expect(offBase.status).toBe(404);

		expect(up.seen).toEqual(["/apiv2/web/hello"]);

		await new Promise<void>(resolve => server.close(() => resolve()));
		up.server.close();
	});

	it("f1：畸形 URL（%ZZ）→ 400，进程不崩", async () => {
		const { root, siteDir, port } = makeFixture();
		const server = await previewServer(root, {
			port,
			siteDir,
			execOj: () => {},
			ojStarter: () => ({ port: 1, ready: Promise.resolve(), stop: async () => {} }),
		});
		const devPort = (server.address() as AddressInfo).port;

		const bad = await get(devPort, "/%ZZ");
		expect(bad.status).toBe(400);

		const ok = await get(devPort, "/");
		expect(ok.status).toBe(200);

		await new Promise<void>(resolve => server.close(() => resolve()));
	});
});

describe("previewServer oj 生命周期", () => {
	it("f3：oj.ready 拒绝 → 回收 oj 子进程后再抛错", async () => {
		const { root } = makeFixture();
		let stopped = false;
		await expect(previewServer(root, {
			execOj: () => {},
			ojStarter: () => ({
				port: 1,
				ready: Promise.reject(new Error("health 轮询超时")),
				stop: async () => {
					stopped = true;
				},
			}),
		})).rejects.toThrowError(/health 轮询超时/);
		expect(stopped).toBe(true);
	});
});
