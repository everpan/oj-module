import type { AddressInfo } from "node:net";
import type { HtmlTransform } from "../../packages/cli/src/static-handler";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createStaticHandler, decodeReqPath } from "../../packages/cli/src/static-handler";

/**
 * 集中审阅（2026-09-01）两项确认的静态层缺陷：
 *  - F11：dev 跑过 `ojm build` 后，localDist 里的合并残留（index.html/assets/
 *    versions.json）会反向遮蔽 shell dist——宿主内容必须只从 hostRoots 读，
 *    localDist 仅服务模块空间（/modules/* 与 /modules.json）
 *  - F1：畸形 URL（%ZZ）的 decodeURIComponent 抛 URIError 穿透成
 *    uncaughtException 崩进程——必须回 400 且服务继续
 */

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-static-fx-"));

function makeRoots() {
	const local = path.join(FIXTURE_ROOT, `local-${Date.now()}-${Math.random()}`);
	const shell = path.join(FIXTURE_ROOT, `shell-${Date.now()}-${Math.random()}`);
	fs.mkdirSync(path.join(local, "modules/demo/0.1.0"), { recursive: true });
	// 模拟 ojm build 的合并残留：宿主文件被拷进 localDist
	fs.writeFileSync(path.join(local, "index.html"), "<html><body>STALE-MERGED</body></html>");
	fs.writeFileSync(path.join(local, "modules.json"), "[]\n");
	fs.writeFileSync(path.join(local, "modules/demo/0.1.0/entry.js"), "export {};\n");
	fs.mkdirSync(path.join(shell, "assets"), { recursive: true });
	fs.writeFileSync(path.join(shell, "index.html"), "<html><head></head><body>FRESH-SHELL</body></html>");
	fs.writeFileSync(path.join(shell, "assets/app.js"), "console.log('asset');\n");
	return { local, shell };
}

function serve(handler: ReturnType<typeof createStaticHandler>): Promise<{ server: http.Server, port: number }> {
	return new Promise((resolve) => {
		const server = http.createServer(handler);
		server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
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

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("static-handler hostRoots（F11：合并残留不遮蔽宿主）", () => {
	it("宿主路径只从 hostRoots 读；模块空间仍 localDist 优先", async () => {
		const { local, shell } = makeRoots();
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: null,
			noStore: true,
		}));

		const index = await get(port, "/");
		expect(index.text).toContain("FRESH-SHELL");

		const indexHtml = await get(port, "/index.html");
		expect(indexHtml.text).toContain("FRESH-SHELL");

		const deep = await get(port, "/demo", { Accept: "text/html" });
		expect(deep.text).toContain("FRESH-SHELL"); // SPA 回落也回落到宿主 HTML

		const mod = await get(port, "/modules/demo/0.1.0/entry.js");
		expect(mod.status).toBe(200); // 模块产物仍从 localDist 命中

		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	it("不传 hostRoots 时行为不变（preview 单根兼容）", async () => {
		const { local, shell } = makeRoots();
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			reload: null,
			noStore: false,
		}));
		const index = await get(port, "/");
		expect(index.text).toContain("STALE-MERGED"); // 多根顺序语义保持
		await new Promise<void>(resolve => server.close(() => resolve()));
	});
});

describe("static-handler 畸形 URL（F1：400 而非崩进程）", () => {
	// eslint-disable-next-line test/prefer-lowercase-title -- GET 是 HTTP 方法名，保持大写
	it("GET /%ZZ → 400，且后续请求正常", async () => {
		const { local, shell } = makeRoots();
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: null,
			noStore: true,
		}));

		const bad = await get(port, "/%ZZ");
		expect(bad.status).toBe(400);

		const ok = await get(port, "/");
		expect(ok.status).toBe(200); // 进程存活

		await new Promise<void>(resolve => server.close(() => resolve()));
	});
});

describe("static-handler html transform", () => {
	it("不传 transform ⇒ 与历史逐字节一致（体/头全同，无 cache-control）", async () => {
		const { local, shell } = makeRoots();
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: null,
			noStore: false,
		}));
		const expected = fs.readFileSync(path.join(shell, "index.html"), "utf-8");

		const index = await get(port, "/");
		expect(index.status).toBe(200);
		expect(index.text).toBe(expected);
		expect(index.headers["content-type"]).toBe("text/html; charset=utf-8");
		expect(index.headers["cache-control"]).toBeUndefined();

		const deep = await get(port, "/share/abc", { Accept: "text/html" });
		expect(deep.status).toBe(200);
		expect(deep.text).toBe(expected);
		expect(deep.headers["cache-control"]).toBeUndefined();

		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	it("noStore 语义不变：不传 transform 时仍为 no-store", async () => {
		const { local, shell } = makeRoots();
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: null,
			noStore: true,
		}));
		const index = await get(port, "/");
		expect(index.headers["cache-control"]).toBe("no-store");
		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	it("transform 命中 / 与 SPA 回落的深链接，且拿到解码后的 path", async () => {
		const { local, shell } = makeRoots();
		const seen: string[] = [];
		const transform: HtmlTransform = (req, html) => {
			seen.push(decodeReqPath(req.url ?? "/") ?? "");
			return html.replace("FRESH-SHELL", "TRANSFORMED");
		};
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: null,
			noStore: false,
			transform,
		}));

		const index = await get(port, "/");
		expect(index.text).toContain("TRANSFORMED");

		const deep = await get(port, "/share/%E4%B8%AD%E6%96%87", { Accept: "text/html" });
		expect(deep.status).toBe(200);
		expect(deep.text).toContain("TRANSFORMED");
		expect(seen).toEqual(["/", "/share/中文"]);

		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	it("组合顺序：先 transform 后 reload 注入（dev 刷新逻辑不被覆盖）", async () => {
		const { local, shell } = makeRoots();
		let transformInput = "";
		const transform: HtmlTransform = (_req, html) => {
			transformInput = html;
			return html.replace("FRESH-SHELL", "TRANSFORMED");
		};
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: { script: "// reload", handler: (_req, res) => res.end() },
			noStore: true,
			transform,
		}));

		const res = await get(port, "/", { Accept: "text/html" });
		expect(res.text).toContain("TRANSFORMED");
		expect(res.text).toContain("/__ojm_reload.js");
		expect(transformInput).not.toContain("/__ojm_reload.js"); // transform 看到的是注入前原文

		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	it("逐响应 cacheControl → Cache-Control；htmlCacheControl 为缺省且被前者覆盖", async () => {
		const { local, shell } = makeRoots();
		const transform: HtmlTransform = (req) => {
			if (decodeReqPath(req.url ?? "/") === "/cached")
				return { html: "<html>cached</html>", cacheControl: "public, max-age=60" };
			return "<html>default</html>";
		};
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: null,
			noStore: false,
			transform,
			htmlCacheControl: "no-cache",
		}));

		const cached = await get(port, "/cached", { Accept: "text/html" });
		expect(cached.headers["cache-control"]).toBe("public, max-age=60"); // 逐响应优先
		expect(cached.text).toBe("<html>cached</html>");

		const fallback = await get(port, "/", { Accept: "text/html" });
		expect(fallback.headers["cache-control"]).toBe("no-cache"); // 缺省兜底

		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	it("transform 抛错 / 返回非字符串 ⇒ 回退原文且仍 200（站点不挂）", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { local, shell } = makeRoots();
		const expected = fs.readFileSync(path.join(shell, "index.html"), "utf-8");
		const transform = ((req: http.IncomingMessage) => {
			if (decodeReqPath(req.url ?? "/") === "/boom")
				throw new Error("transform boom");
			return null; // 非字符串、非 { html }
		}) as unknown as HtmlTransform;
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: null,
			noStore: false,
			transform,
		}));

		const boom = await get(port, "/boom", { Accept: "text/html" });
		expect(boom.status).toBe(200);
		expect(boom.text).toBe(expected);

		const bad = await get(port, "/bad", { Accept: "text/html" });
		expect(bad.status).toBe(200);
		expect(bad.text).toBe(expected);

		expect(errorSpy).toHaveBeenCalledTimes(2);
		errorSpy.mockRestore();
		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	it("async transform 亦被等待；非 HTML 资产不经 transform", async () => {
		const { local, shell } = makeRoots();
		const seen: string[] = [];
		const transform: HtmlTransform = async (req, html) => {
			seen.push(req.url ?? "");
			await new Promise(resolve => setTimeout(resolve, 5));
			return html.replace("FRESH-SHELL", "ASYNC-TRANSFORMED");
		};
		const { server, port } = await serve(createStaticHandler({
			roots: [local, shell],
			hostRoots: [shell],
			reload: null,
			noStore: false,
			transform,
		}));

		const index = await get(port, "/");
		expect(index.text).toContain("ASYNC-TRANSFORMED");

		const asset = await get(port, "/assets/app.js");
		expect(asset.status).toBe(200);
		expect(asset.text).toBe("console.log('asset');\n");
		expect(asset.headers["content-type"]).toBe("text/javascript; charset=utf-8");
		expect(asset.headers["cache-control"]).toBeUndefined();
		expect(seen).toEqual(["/"]); // 资产未触发 transform

		await new Promise<void>(resolve => server.close(() => resolve()));
	});
});
