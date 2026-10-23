import type { ChildProcess } from "node:child_process";
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PROJECT_ROOT } from "../helpers/paths";

/** 取一个内核保证空闲的端口（listen(0) 由 OS 分配后即刻让出） */
function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.unref();
		srv.on("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address() as { port: number };
			srv.close(() => resolve(port));
		});
	});
}

/**
 * P6 Task 10：uni-dev 全链真二进制冒烟（设计 §9 首跑登录闭环 + §6 preview）。
 *
 * init → dev（真 oj）→ POST /api/auth/login（admin/123456）→ user-info →
 * 收尾 → build → preview（migrate → oj serve 单服务：API + web 挂载 SPA 同进程）→
 * GET / 200 → 深链 200 → 带 token /api/web/hello 200 → 收尾。
 *
 * 依赖本仓 vendor tarball 与 shell dist，CI 无产物环境跳过；
 * 端口 9778 被残留实例占用时直接失败并提示（不静默换端）。
 */

const OJM = path.join(PROJECT_ROOT, "packages/cli/bin/ojm.mjs");
const ojBusy = await new Promise<boolean>((resolve) => {
	const req = http.get({ host: "127.0.0.1", port: 9778, path: "/api/health", timeout: 500 }, (res) => {
		res.resume();
		resolve(true);
	});
	req.on("timeout", () => {
		req.destroy();
		resolve(false);
	});
	req.on("error", () => resolve(false));
});

describe.skipIf(process.env.CI || ojBusy)("uni-dev e2e 冒烟（真二进制）", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-smoke-"));
	const procs: ChildProcess[] = [];

	afterAll(() => {
		for (const proc of procs)
			killTree(proc);
		fs.rmSync(root, { recursive: true, force: true });
	});

	function killTree(proc: ChildProcess) {
		if (!proc.pid || proc.exitCode !== null)
			return;
		try {
			process.kill(-proc.pid, "SIGINT");
		}
		catch {
			return;
		}
		// 3s 还不退就 SIGKILL（bin/ojm.mjs 转发信号给内层，正常 1.5s 内退出）
		setTimeout(() => {
			try {
				process.kill(-proc.pid!, "SIGKILL");
			}
			catch {
				/* 已退出 */
			}
		}, 3000).unref();
	}

	function runRam(args: string[], timeout = 240_000): string {
		return execFileSync(process.execPath, [OJM, ...args], {
			cwd: root,
			timeout,
			stdio: "pipe",
		}).toString();
	}

	function startRam(args: string[]): { proc: ChildProcess, port: () => Promise<number> } {
		const proc = spawn(process.execPath, [OJM, ...args], {
			cwd: root,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		procs.push(proc);
		const chunks: Buffer[] = [];
		proc.stdout!.on("data", (c: Buffer) => chunks.push(c));
		proc.stderr!.on("data", (c: Buffer) => chunks.push(c));
		const port = () => new Promise<number>((resolve, reject) => {
			const started = Date.now();
			const check = () => {
				const text = Buffer.concat(chunks).toString();
				const m = text.match(/已启动：http:\/\/localhost:(\d+)/);
				if (m)
					resolve(Number(m[1]));
				else if (Date.now() - started > 30_000)
					reject(new Error(`起服超时，输出：\n${text.slice(-2000)}`));
				else
					setTimeout(check, 300);
			};
			check();
		});
		return { proc, port };
	}

	function request(port: number, reqPath: string, init?: { method?: string, token?: string, body?: unknown }): Promise<{ status: number, text: string }> {
		return new Promise((resolve, reject) => {
			const payload = init?.body === undefined ? null : JSON.stringify(init.body);
			const req = http.request({
				host: "127.0.0.1",
				port,
				path: reqPath,
				method: init?.method ?? "GET",
				headers: {
					...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
					...(init?.token ? { authorization: `Bearer ${init.token}` } : {}),
				},
				timeout: 10_000,
			}, (res) => {
				const chunks: Buffer[] = [];
				res.on("data", c => chunks.push(c as Buffer));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
			});
			req.on("error", reject);
			req.on("timeout", () => {
				req.destroy(new Error(`请求超时 ${reqPath}`));
			});
			if (payload)
				req.write(payload);
			req.end();
		});
	}

	it("init：全栈工程落盘", () => {
		const out = runRam(["init", "--yes"]);
		expect(out).not.toMatch(/\[ojm\].*失败/);
		expect(fs.existsSync(path.join(root, "bin/oj"))).toBe(true);
		// module-root 布局（0.2.20 起）：config.yaml 在工程根，证书落 config/（config.yaml 同级）
		expect(fs.existsSync(path.join(root, "config.yaml"))).toBe(true);
		expect(fs.existsSync(path.join(root, "config/cert.jws"))).toBe(true);
	}, 240_000);

	it("dev：登录链经反代全通（首跑闭环）", async () => {
		// P1：宿主产物并入 cli，ojm dev 从 cli 包内 shell-dist 取宿主——
		// 工程 node_modules 不再需要 shell 包，冒烟无需任何 symlink 模拟安装
		const { proc, port } = startRam(["dev"]);
		const devPort = await port();

		const login = await request(devPort, "/api/auth/login", {
			method: "POST",
			body: { username: "admin", password: "123456" },
		});
		expect(login.status).toBe(200);
		const envelope = JSON.parse(login.text) as { code: number, data?: { access_token?: string } };
		expect(envelope.code).toBe(0);
		const token = envelope.data?.access_token;
		expect(token, "登录应返回 access_token").toBeTruthy();

		const userInfo = await request(devPort, "/api/web/user-info", { token });
		expect(userInfo.status).toBe(200);
		expect(JSON.parse(userInfo.text)).toMatchObject({ code: 0 });

		killTree(proc);
		await new Promise(resolve => proc.once("exit", resolve));
	}, 240_000);

	it("build：后端与全站产物齐备", () => {
		runRam(["build"]);
		expect(fs.existsSync(path.join(root, "dist/web/index.html"))).toBe(true);
		expect(fs.existsSync(path.join(root, "dist/web/modules.json"))).toBe(true);
		expect(fs.existsSync(path.join(root, "dist/api/manifests.yaml"))).toBe(true);
	}, 240_000);

	it("preview：单服务（migrate → oj serve API+静态 SPA）+ 带 token 业务路由", async () => {
		// 显式传空闲端口：单服务形态下端口经派生 config 覆盖 server.port（DR-4），
		// 仍是覆盖而非自动顺延——占用即失败，不静默换端
		const reserved = await getFreePort();
		const { proc, port } = startRam(["preview", String(reserved)]);
		const previewPort = await port();

		const index = await request(previewPort, "/");
		expect(index.status).toBe(200);
		expect(index.text).toContain("<html");

		// SPA 深链回落（oj web 挂载 spa: true，2026-10-19 单服务化的核心新断言）
		const deep = await request(previewPort, "/some/deep/route", { });
		expect(deep.status).toBe(200);
		expect(deep.text).toContain("<html");

		const login = await request(previewPort, "/api/auth/login", {
			method: "POST",
			body: { username: "admin", password: "123456" },
		});
		const token = (JSON.parse(login.text) as { data?: { access_token?: string } }).data?.access_token;
		expect(token).toBeTruthy();

		const hello = await request(previewPort, "/api/web/hello", { token });
		expect(hello.status).toBe(200);

		// 派生 config 与 config.yaml 同目录（module-root：工程根），运行中存在、退出后清理（DR-2）
		const previewConfig = path.join(root, ".ojm-preview.yaml");
		expect(fs.existsSync(previewConfig)).toBe(true);

		killTree(proc);
		await new Promise(resolve => proc.once("exit", resolve));
		expect(fs.existsSync(previewConfig)).toBe(false);
	}, 240_000);
});
