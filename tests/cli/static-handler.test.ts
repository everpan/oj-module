import type { AddressInfo } from "node:net";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createStaticHandler } from "../../packages/cli/src/static-handler";

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
	fs.mkdirSync(shell, { recursive: true });
	fs.writeFileSync(path.join(shell, "index.html"), "<html><head></head><body>FRESH-SHELL</body></html>");
	return { local, shell };
}

function serve(handler: ReturnType<typeof createStaticHandler>): Promise<{ server: http.Server, port: number }> {
	return new Promise((resolve) => {
		const server = http.createServer(handler);
		server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
	});
}

function get(port: number, reqPath: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number, text: string }> {
	return new Promise((resolve, reject) => {
		http.get({ host: "127.0.0.1", port, path: reqPath, headers }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", chunk => chunks.push(chunk as Buffer));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
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
