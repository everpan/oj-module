import type { AddressInfo } from "node:net";
import type { DevOptions } from "../../packages/cli/src/dev";
import type { OjProcess } from "../../packages/cli/src/oj";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { devServer, shutdownDev } from "../../packages/cli/src/dev";
import { resolveMergedConfigPath } from "../../packages/cli/src/dev-secrets";

// bin/oj 桩是 shebang 脚本，Windows 无法 spawn（vendor.test.ts 同款 posixOnly）；
// 仅依赖其真实执行的用例在 win32 下跳过，其余平台照常运行。
const posixOnly = process.platform === "win32" ? it.skip : it;

/**
 * 设计 §4（P3）：ojm dev 全栈接线。
 *  - 全栈模式（工程有 api/config.yaml）：/api/* 反代 oj，不进 mock；
 *    ojStarter 收到绝对路径 config/base/apiSrc
 *  - 纯前端模式（无 api/config.yaml）：mock 行为不变（回归）
 *  - 宿主 HTML（/ 与 SPA 深链接）注入外链 /__ojm_reload.js（CSP 无 nonce 可用）
 *  - /__ojm_reload.js 外链脚本、/__ojm_reload SSE 通道
 *  - watch 随布局（新布局 web/src）：变更 → 重建（可注入）→ SSE 广播 reload
 *  - server.close() 回收 oj 子进程
 */

const FIXTURE_ROOT = path.join(process.cwd(), ".tmp-dev-fx");

/**
 * 写桩 oj（Node）：支持 `secret keygen/seal/open`（密钥不配对即解密失败，GCM 验签）
 * 与能力探针 `build --help`（含 --module-root）/` -V`。devServer 走 A' 合并配置时会
 * 调用 `oj secret` 自动供给本机密钥；ojStarter 由测试注入，故 serve 不真正监听。
 */
function writeStubOj(root: string): void {
	const binDir = path.join(root, "bin");
	fs.mkdirSync(binDir, { recursive: true });
	fs.writeFileSync(path.join(binDir, "oj"), [
		"#!/usr/bin/env node",
		"import fs from \"node:fs\";",
		"import crypto from \"node:crypto\";",
		"const argv = process.argv.slice(2);",
		"const cmd = (argv[0] || \"\") + \" \" + (argv[1] || \"\");",
		"if (cmd === \"build --help\") { console.log(\"      --module-root <GLOB>  模块根 glob\"); process.exit(0); }",
		"if (argv[0] === \"-V\") { console.log(\"oj 0.1.999\"); process.exit(0); }",
		"if (argv[0] === \"secret\") {",
		"\tconst sub = argv[1];",
		"\tif (sub === \"keygen\") { const dir = argv[argv.indexOf(\"--out-dir\") + 1]; const { privateKey, publicKey } = crypto.generateKeyPairSync(\"ed25519\"); fs.writeFileSync(dir + \"/secrets-private.pem\", privateKey.export({ type: \"pkcs8\", format: \"pem\" })); fs.writeFileSync(dir + \"/secrets-public.pem\", publicKey.export({ type: \"spki\", format: \"pem\" })); process.exit(0); }",
		"\tconst pub = argv[argv.indexOf(\"-k\") + 1]; const key = crypto.createHash(\"sha256\").update(fs.readFileSync(pub)).digest();",
		"\tif (sub === \"seal\") { const plain = fs.readFileSync(0, \"utf-8\"); const nonce = crypto.randomBytes(12); const cipher = crypto.createCipheriv(\"aes-256-gcm\", key, nonce); const ct = Buffer.concat([cipher.update(plain, \"utf-8\"), cipher.final()]); const tag = cipher.getAuthTag(); process.stdout.write(\"ENC[\" + Buffer.concat([nonce, tag, ct]).toString(\"base64\") + \"]\"); process.exit(0); }",
		"\tconst privPem = fs.readFileSync(pub); const pubPem = crypto.createPublicKey(crypto.createPrivateKey(privPem)).export({ type: \"spki\", format: \"pem\" }); const key2 = crypto.createHash(\"sha256\").update(pubPem).digest();",
		"\tconst enc = argv[argv.length - 1]; const raw = Buffer.from(enc.slice(4, -1), \"base64\"); const nonce = raw.subarray(0, 12); const tag = raw.subarray(12, 28); const ct = raw.subarray(28);",
		"\ttry { const d = crypto.createDecipheriv(\"aes-256-gcm\", key2, nonce); d.setAuthTag(tag); d.update(ct); d.final(); process.exit(0); } catch { process.stderr.write(\"open failed\\n\"); process.exit(1); }",
		"}",
		"process.exit(0);",
		"",
	].join("\n"));
	fs.chmodSync(path.join(binDir, "oj"), 0o755);
}

// 顺序发号（非随机）：ojm dev 现会对 oj 后端端口做预检，前端 dev server 又复用同一
// 端口号，若两个 fixture 抽到同一随机端口会相互误判「端口被占用」而失败。发号保证
// 同文件内各 fixture 端口互斥（并行用例也各自拿到不同号）。
let fixturePortSeq = 21000;
function makeFixture(kind: "fullstack" | "frontend" | "module-root", base = "/api", port?: number): { root: string, port: number } {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, `dev-${kind}-`));
	// 并行测试端口区间不得重叠（playground-oj 设计 §10）。oj 后端端口默认落在此区间；
	// 需要显式占用该端口的用例（端口冲突预检）应传入区间外的端口以避免与并行用例相撞。
	const usedPort = port ?? fixturePortSeq++;
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
	writeStubOj(root); // devServer 走 A' 合并配置会自动供给本机密钥（需桩 oj 支持 secret）
	if (kind === "module-root") {
		// 新布局：源码根 <root>/src，config 在仓库根；模块两侧至少一侧有标记文件
		fs.mkdirSync(path.join(root, "src/wiki/api"), { recursive: true });
		fs.writeFileSync(path.join(root, "src/wiki/api/manifest.yaml"), "name: wiki\nversion: 0.1.0\n");
		fs.mkdirSync(path.join(root, "src/wiki/web"), { recursive: true });
		fs.writeFileSync(path.join(root, "src/wiki/web/entry.ts"), "export default {};\n");
	}
	else {
		fs.mkdirSync(path.join(root, "web/src"), { recursive: true });
		fs.writeFileSync(path.join(root, "web/src/entry.ts"), "export default {};\n");
	}
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
		fs.writeFileSync(path.join(root, "api/config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${usedPort}\nmounts:\n  - prefix: ${base}\n    api: src\n  - prefix: /cdn\n    web: ../cdn\n`);
	}
	if (kind === "module-root") {
		fs.writeFileSync(path.join(root, "config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${usedPort}\nmounts:\n  - prefix: ${base}\n    api: src\n`);
	}
	return { root, port: usedPort };
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
		starter:
			(upPort: number, configPath: string) =>
				(cfg: string, base: string, apiSrc: string | string[]): OjProcess => {
					expect(path.isAbsolute(cfg)).toBe(true);
					// A'：dev 传给 oj 的是合并产物 .ojm-tmp-config.yaml，而非 tracked config.yaml
					expect(cfg).toBe(resolveMergedConfigPath(configPath));
					expect(base).toBe(expectedBase);
					const srcs = (Array.isArray(apiSrc) ? apiSrc : [apiSrc]).filter(
						s => s !== "" && !s.startsWith("-"),
					);
					expect(srcs.every(s => path.isAbsolute(s))).toBe(true);
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
	posixOnly("全栈模式：/api/* 反代 oj 不进 mock；server.close 回收 oj", async () => {
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
			convergeTrigger: () => {}, // 出厂对账触发不混入反代断言（factory-converge.test 单钉）
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

	posixOnly("/cdn 反代：config 有 /cdn 挂载时直发 oj（不剥前缀）；无挂载工程回落静态不崩", async () => {
		const { root, port } = makeFixture("fullstack");
		const configPath = path.join(root, "api/config.yaml");
		const up = stubOjUpstream();
		const upPort = await listenOn(up.server);

		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
			ojStarter: up.starter(upPort, configPath),
			convergeTrigger: () => {},
		});
		const devPort = (server.address() as AddressInfo).port;

		const res = await get(devPort, "/cdn/bundles.yaml");
		expect(res.status).toBe(200);
		expect(JSON.parse(res.text)).toMatchObject({ from: "oj" });
		expect(up.seen).toEqual(["/cdn/bundles.yaml"]); // 相对基址消费的 dev 前提

		await stopServer(server);
		up.server.close();

		// 无 /cdn 挂载（纯前端 fixture 无 config）：回落静态层，不崩不反代
		const fe = makeFixture("frontend");
		const feServer = await devServer(fe.root, {
			port: fe.port,
			shellDist: path.join(fe.root, "shell-dist"),
			buildModulesFn: async () => {},
		});
		const fePort = (feServer.address() as AddressInfo).port;
		const feRes = await get(fePort, "/cdn/bundles.yaml");
		expect(feRes.status).toBe(404); // 静态层对未知带后缀路径的既有 404（非反代、非崩溃）
		await stopServer(feServer);
	});

	it("后端 oj 端口被占用时：禁止启动并给出清晰提示，且绝不调用 ojStarter（不留下 oj 孤儿）", async () => {
		// oj 后端端口用区间外的值，避免与并行用例的随机端口相撞
		const ojPort = 44021;
		const { root } = makeFixture("fullstack", "/api", ojPort);
		// 占用 oj 后端端口，模拟「上次 ojm dev 未正常退出、遗留 oj 孤儿进程」
		const occupier = http.createServer((_req, res) => res.end("busy"));
		await new Promise<void>((resolve, reject) => {
			occupier.listen(ojPort, "127.0.0.1", () => resolve());
			occupier.once("error", reject);
		});

		let ojStarterCalled = false;
		const recordingStarter: NonNullable<DevOptions["ojStarter"]> = () => {
			ojStarterCalled = true;
			return { port: 0, ready: Promise.resolve(), stop: async () => {} };
		};

		await expect(
			devServer(root, {
				port: 44099, // 前端 dev 端口（与 oj 端口错开，避免自动顺延干扰断言）
				shellDist: path.join(root, "shell-dist"),
				buildModulesFn: async () => {},
				ojStarter: recordingStarter,
			}),
		).rejects.toThrow(/被占用/);

		// 关键不变量：端口冲突时不能半启动——既不拉起 oj，也不创建前端 http server
		expect(ojStarterCalled).toBe(false);
		await stopServer(occupier);
	});

	posixOnly("module-root 布局：oj 收到 --module-root <root>/src（不是 --api-path），config 取自仓库根", async () => {
		const { root, port } = makeFixture("module-root");
		const configPath = path.join(root, "config.yaml");
		const up = stubOjUpstream();
		const upPort = await listenOn(up.server);
		let seen: string | string[] | undefined;

		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
			convergeTrigger: () => {}, // 出厂对账触发不混入 module-root 断言（factory-converge.test 单钉）
			ojStarter: (cfg: string, base: string, apiSource: string | string[]): OjProcess => {
				seen = apiSource;
				return up.starter(upPort, configPath)(cfg, base, apiSource);
			},
		});

		// v0.1.85：--module-root 与 --api-path 互斥，新布局只能给源码树根目录
		expect(seen).toEqual(["--module-root", path.join(root, "src")]);
		await stopServer(server);
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

	it("web.config.ts 的 htmlTransform 在 dev 形态生效，且 reload 注入仍在", async () => {
		const { root, port } = makeFixture("frontend");
		fs.writeFileSync(
			path.join(root, "web.config.ts"),
			"export default { baseUrl: \"\", modules: [{ name: \"fx\", entry: \"./web/src/entry.ts\" }], htmlTransform: \"./html-transform.ts\" };\n",
		);
		fs.writeFileSync(
			path.join(root, "html-transform.ts"),
			"export default (reqPath, html) => html.replace(\"stub\", \"stub:\" + reqPath);\n",
		);

		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
		});
		const devPort = (server.address() as AddressInfo).port;

		const index = await get(devPort, "/");
		expect(index.status).toBe(200);
		expect(index.text).toContain("stub:/"); // transform 生效
		expect(index.text).toContain("/__ojm_reload.js"); // 注入不被覆盖

		const deep = await get(devPort, "/some/deep/route", { Accept: "text/html" });
		expect(deep.text).toContain("stub:/some/deep/route");

		await stopServer(server);
	});

	it("watch 随布局（web/src）：变更 → 注入重建 → SSE 广播 reload", async () => {
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

		fs.writeFileSync(path.join(root, "web/src/touch.ts"), "export {};\n");

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

	posixOnly("f2：反代前缀跟随 config.yaml 的 server.base（非 /api 时 /api/* 不再进 oj）", async () => {
		const { root, port } = makeFixture("fullstack", "/apiv2");
		const configPath = path.join(root, "api/config.yaml");
		const up = stubOjUpstream("/apiv2");
		const upPort = await listenOn(up.server);

		const server = await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
			ojStarter: up.starter(upPort, configPath),
			convergeTrigger: () => {},
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

	posixOnly("f3：oj.ready 拒绝（health 超时/启动即退）→ 回收 oj 子进程后再抛错", async () => {
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

	it("server.close() 摘除进程级 handler：同进程多次 devServer 不累积监听器", async () => {
		const { root, port } = makeFixture("frontend");
		const baseline = {
			sigint: process.listenerCount("SIGINT"),
			sigterm: process.listenerCount("SIGTERM"),
			exit: process.listenerCount("exit"),
		};
		// 连开三次：每次关闭后进程级 SIGINT/SIGTERM/exit 监听数必须回到基线，
		// 否则守卫测试跑到第 11 个实例会触发 MaxListenersExceededWarning。
		for (let i = 0; i < 3; i++) {
			const server = await devServer(root, {
				port,
				shellDist: path.join(root, "shell-dist"),
				buildModulesFn: async () => {},
			});
			await stopServer(server);
			expect(process.listenerCount("SIGINT")).toBe(baseline.sigint);
			expect(process.listenerCount("SIGTERM")).toBe(baseline.sigterm);
			expect(process.listenerCount("exit")).toBe(baseline.exit);
		}
	});
});

describe("shutdownDev（前端终止 → 后端 oj 随之消亡）", () => {
	it("关闭 SSE 通道、停止后端 oj、打印终止信息后退出", async () => {
		const srv = http.createServer();
		const hub = { close: vi.fn() };
		let stopped = false;
		const oj: OjProcess = {
			port: 1,
			ready: Promise.resolve(),
			stop: async () => {
				stopped = true;
			},
			kill: () => {},
		};
		const logs: string[] = [];
		let exited: number | undefined;

		await shutdownDev(srv, oj, hub, {
			exit: (c?: number) => {
				exited = c;
			},
			log: (m: string) => logs.push(m),
		});

		expect(stopped).toBe(true); // 后端 oj 已停止
		expect(hub.close).toHaveBeenCalled(); // SSE 通道先关，server.close 才能回调
		expect(logs.some(l => l.includes("[ojm] 前端服务已停止，正在终止后端 oj…"))).toBe(true);
		expect(logs.some(l => l.includes("[ojm] 后端 oj 已随前端一起终止。"))).toBe(true);
		// 未监听的 server.close 立即回调 → exit(0)
		await new Promise(r => setTimeout(r, 10));
		expect(exited).toBe(0);
	});

	posixOnly("devServer 注册 SIGINT / SIGTERM 优雅停机（前端进程被信号杀时 oj 一起亡）", async () => {
		const { root, port } = makeFixture("fullstack");
		const configPath = path.join(root, "api/config.yaml");
		const up = stubOjUpstream();
		const upPort = await listenOn(up.server);
		const sigints: string[] = [];
		const terms: string[] = [];
		const record = (ev: string) => {
			if (ev === "SIGINT")
				sigints.push(ev);
			if (ev === "SIGTERM")
				terms.push(ev);
			return process as unknown as NodeJS.Process;
		};
		const origOn = process.on.bind(process);
		const origOnce = process.once.bind(process);
		// 只拦截 devServer 的 SIGINT/SIGTERM 注册点供断言；其余事件（如 exit
		// 兜底）透传真实 process——不吞被测代码之外任何监听器注册
		const onSpy = vi.spyOn(process, "on").mockImplementation(((ev: string, listener: (...args: never[]) => void) => {
			return ev === "SIGINT" || ev === "SIGTERM" ? record(ev) : origOn(ev, listener as never);
		}) as typeof process.on);
		const onceSpy = vi.spyOn(process, "once").mockImplementation(((ev: string, listener: (...args: never[]) => void) => {
			return ev === "SIGINT" || ev === "SIGTERM" ? record(ev) : origOnce(ev, listener as never);
		}) as typeof process.once);

		await devServer(root, {
			port,
			shellDist: path.join(root, "shell-dist"),
			buildModulesFn: async () => {},
			ojStarter: up.starter(upPort, configPath),
			convergeTrigger: () => {},
		});
		onSpy.mockRestore();
		onceSpy.mockRestore();

		expect(sigints).toContain("SIGINT");
		expect(terms).toContain("SIGTERM");
		up.server.close();
	});
});
