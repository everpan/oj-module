import type { OjProcess } from "../../packages/cli/src/oj";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { runPreview } from "../../packages/cli/src/preview";
import { PREVIEW_CONFIG_NAME } from "../../packages/cli/src/preview-config";

/**
 * 设计 §6（P4，2026-10-19 单服务化）：ojm preview。
 *
 * 单服务形态：四查 → migrate（原 config）→ 派生 config（api/.ojm-preview.yaml，
 * upsert / web 挂载 + spa:true + 显式 port 覆盖）→ spawn 唯一 oj serve。
 * ojm 不再自建 http server、不反代、不传 --app-path。
 *  - migrate 失败即退：不起 oj、不落派生文件（零残留）
 *  - ready 拒绝：先回收 oj 子进程再删派生 config 后抛错（F3 顺序）
 *  - 退出三路清理：stop() / SIGINT / process exit
 *  - htmlTransform（web.config.ts）单服务不生效：WARN 指向 oj html_meta，
 *    且不 import 变换模块（无副作用执行用户代码）
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
	fs.mkdirSync(path.join(root, "dist/api"), { recursive: true });
	fs.writeFileSync(path.join(root, "dist/api/manifests.yaml"), "modules: []\n");
	fs.mkdirSync(path.join(root, "api"), { recursive: true });
	fs.writeFileSync(path.join(root, "api/config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\nmounts:\n  - prefix: ${base}\n    api: src\n`);
	// 新布局标记（web/src 存在 → distDir = dist/web）
	fs.mkdirSync(path.join(root, "web/src"), { recursive: true });
	const siteDir = path.join(root, "dist/web");
	fs.mkdirSync(siteDir, { recursive: true });
	fs.writeFileSync(path.join(siteDir, "index.html"), "<html><head><title>site</title></head><body>site</body></html>");
	fs.writeFileSync(path.join(siteDir, "modules.json"), "[]\n");
	return { root, configPath: path.join(root, "api/config.yaml"), siteDir, apiDist: path.join(root, "dist/api"), port };
}

/** 派生 config 路径（与原 config 同目录，固定名） */
function previewConfigPath(root: string): string {
	return path.join(root, "api", PREVIEW_CONFIG_NAME);
}

function readDerived(root: string): Record<string, unknown> {
	return parse(fs.readFileSync(previewConfigPath(root), "utf-8")) as Record<string, unknown>;
}

/** 桩 ojStarter：记录调用参数，ready 立即 resolve */
function stubStarter(port: number, opts: { ready?: () => Promise<void> } = {}) {
	const calls: { cfg: string, base: string, apiPath: string, extraArgs: string[] }[] = [];
	const starter = (cfg: string, base: string, apiPath: string, extraArgs: string[]) => {
		calls.push({ cfg, base, apiPath, extraArgs });
		return {
			port,
			ready: opts.ready ? opts.ready() : Promise.resolve(),
			stop: async () => {},
		} satisfies OjProcess;
	};
	return { calls, starter };
}

/**
 * 拦截 runPreview 的信号注册点（SIGINT 走 on、exit 走 once）供断言，不真
 * 注册（十几个用例会触发 MaxListenersExceededWarning）；其余事件一律透传
 * 真实 process——不吞被测代码之外任何监听器注册。
 */
function stubProcessSignals() {
	const events: string[] = [];
	const origOn = process.on.bind(process);
	const origOnce = process.once.bind(process);
	const onSpy = vi.spyOn(process, "on").mockImplementation(((ev: string, listener: (...args: never[]) => void) => {
		if (ev !== "SIGINT")
			return origOn(ev, listener as never);
		events.push(ev);
		return process as unknown as NodeJS.Process;
	}) as typeof process.on);
	const onceSpy = vi.spyOn(process, "once").mockImplementation(((ev: string, listener: (...args: never[]) => void) => {
		if (ev !== "exit")
			return origOnce(ev, listener as never);
		events.push(ev);
		return process as unknown as NodeJS.Process;
	}) as typeof process.once);
	return { events, restore: () => {
		onSpy.mockRestore();
		onceSpy.mockRestore();
	} };
}

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("runPreview fail-fast 四查", () => {
	const cases = [
		{ name: "缺 bin/oj → 指向 ojm init", remove: (root: string) => fs.rmSync(path.join(root, "bin/oj")), hint: /init/ },
		{ name: "缺 api/config.yaml → 指向 ojm init", remove: (root: string) => fs.rmSync(path.join(root, "api/config.yaml")), hint: /init/ },
		{ name: "缺 index.html → 指向 ojm build", remove: (root: string) => fs.rmSync(path.join(root, "dist/web/index.html")), hint: /build/ },
		{ name: "缺 manifests.yaml → 指向 ojm build", remove: (root: string) => fs.rmSync(path.join(root, "dist/api/manifests.yaml")), hint: /build/ },
	];
	for (const c of cases) {
		it(c.name, async () => {
			const { root } = makeFixture();
			c.remove(root);
			const once = stubProcessSignals();
			await expect(runPreview(root, { execOj: () => {}, ojStarter: stubStarter(1).starter }))
				.rejects
				.toThrowError(c.hint);
			once.restore();
		});
	}
});

describe("runPreview 派生 config", () => {
	it("无 / web 挂载 → 注入 {prefix:/, web:siteDir, spa:true}，其余段与原 config 一致", async () => {
		const { root, configPath, siteDir, port } = makeFixture();
		const before = fs.readFileSync(configPath, "utf-8");
		const once = stubProcessSignals();

		const handle = await runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: stubStarter(port).starter,
		});
		once.restore();

		const derived = readDerived(root);
		const mounts = derived.mounts as { prefix: string, web?: string, api?: string, spa?: boolean }[];
		expect(mounts).toEqual([
			{ prefix: "/api", api: "src" },
			{ prefix: "/", web: siteDir, spa: true },
		]);
		expect(derived.server).toMatchObject({ host: "127.0.0.1", port });
		// 原 config 不被修改
		expect(fs.readFileSync(configPath, "utf-8")).toBe(before);

		await handle.stop();
		expect(fs.existsSync(previewConfigPath(root))).toBe(false);
	});

	it("已有 / web 挂载 → 覆盖指向与 spa，保留 headers 等自定义键，其他挂载不动", async () => {
		const { root, siteDir, port } = makeFixture();
		fs.writeFileSync(path.join(root, "api/config.yaml"), [
			"server:",
			"  host: 127.0.0.1",
			`  port: ${port}`,
			"mounts:",
			"  - prefix: /api",
			"    api: src",
			"  - prefix: \"/\"",
			"    web: \"../stale-dir\"",
			"    headers: { X-Frame-Options: \"DENY\" }",
			"  - prefix: /docs",
			"    web: \"../docs-dist\"",
			"",
		].join("\n"));
		const once = stubProcessSignals();

		await runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: stubStarter(port).starter,
		});
		once.restore();

		const mounts = readDerived(root).mounts as Record<string, unknown>[];
		expect(mounts).toEqual([
			{ prefix: "/api", api: "src" },
			{ prefix: "/", web: siteDir, spa: true, headers: { "X-Frame-Options": "DENY" } },
			{ prefix: "/docs", web: "../docs-dist" },
		]);
	});

	it("显式 port → 覆盖派生 config 的 server.port（DR-4）", async () => {
		const { root, siteDir, port } = makeFixture();
		const once = stubProcessSignals();

		await runPreview(root, {
			port: 39999,
			siteDir,
			execOj: () => {},
			ojStarter: stubStarter(port).starter,
		});
		once.restore();

		expect(readDerived(root).server).toMatchObject({ port: 39999 });
	});

	it("mounts 非序列（手误写成标量）→ 人话报错，不静默置空掩盖错误", async () => {
		const { root, siteDir } = makeFixture();
		fs.writeFileSync(path.join(root, "api/config.yaml"), "server:\n  port: 19877\nmounts: api-src\n");
		const once = stubProcessSignals();

		await expect(runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: stubStarter(1).starter,
		})).rejects.toThrowError(/mounts 不是序列/);
		once.restore();

		expect(fs.existsSync(previewConfigPath(root))).toBe(false);
	});

	it("非法 YAML → 人话报错，不落派生文件", async () => {
		const { root, siteDir } = makeFixture();
		fs.writeFileSync(path.join(root, "api/config.yaml"), "server:\n  port: [unclosed\n");
		const once = stubProcessSignals();

		await expect(runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: stubStarter(1).starter,
		})).rejects.toThrowError(/不是合法 YAML/);
		once.restore();

		expect(fs.existsSync(previewConfigPath(root))).toBe(false);
	});
});

describe("runPreview 编排", () => {
	it("migrate 用原 config；spawn 用派生 config，无 --app-path", async () => {
		const { root, configPath, siteDir, apiDist, port } = makeFixture();
		const calls: string[][] = [];
		const { calls: startCalls, starter } = stubStarter(port);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.join(" "));
		});
		const once = stubProcessSignals();

		await runPreview(root, {
			siteDir,
			execOj: (args) => {
				calls.push(args);
			},
			ojStarter: starter,
		});
		once.restore();
		logSpy.mockRestore();

		// migrate：原 config + 绝对路径
		expect(calls).toEqual([["migrate", "-c", configPath, "-d", apiDist]]);
		for (const arg of calls[0]!) {
			if (!["migrate", "-c", "-d"].includes(arg))
				expect(path.isAbsolute(arg)).toBe(true);
		}
		// spawn：派生 config + 无 --app-path（静态走 config 的 web 挂载）
		expect(startCalls).toHaveLength(1);
		expect(startCalls[0]!.cfg).toBe(previewConfigPath(root));
		expect(path.isAbsolute(startCalls[0]!.cfg)).toBe(true);
		expect(startCalls[0]!.base).toBe("/api");
		expect(startCalls[0]!.apiPath).toBe(apiDist);
		expect(startCalls[0]!.extraArgs).toEqual([]);
		// 横幅串保持（tests/integration 的 startRam 靠它抓端口）
		expect(logs.some(l => l.includes("已启动：http://localhost:"))).toBe(true);
	});

	it("migrate 非零退出 → 透传报错且不起 oj、不落派生文件", async () => {
		const { root, siteDir } = makeFixture();
		const started: unknown[] = [];
		const once = stubProcessSignals();

		await expect(runPreview(root, {
			siteDir,
			execOj: () => {
				throw new Error("migrate boom: M004 ledger behind");
			},
			ojStarter: (_cfg: string, _b: string, _a: string, _e: string[]) => {
				started.push(1);
				return { port: 1, ready: Promise.resolve(), stop: async () => {} } satisfies OjProcess;
			},
		})).rejects.toThrowError(/migrate boom/);
		once.restore();

		expect(started).toEqual([]);
		expect(fs.existsSync(previewConfigPath(root))).toBe(false);
	});

	it("starter 同步抛错（如 config 缺 server.port）→ 派生 config 不残留", async () => {
		// startOj 首行 readOjPort 会同步 throw（先于返回 OjProcess），此刻 exit
		// 兜底尚未注册——必须就地清理，否则 api/.ojm-preview.yaml 泄漏
		const { root, siteDir } = makeFixture();
		const once = stubProcessSignals();

		await expect(runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: () => {
				throw new Error("[ojm] 缺少合法的 server.port");
			},
		})).rejects.toThrowError(/server\.port/);
		once.restore();

		expect(fs.existsSync(previewConfigPath(root))).toBe(false);
	});

	it("f3：oj.ready 拒绝 → 回收 oj 子进程 + 删派生 config 后再抛错", async () => {
		const { root, siteDir } = makeFixture();
		let stopped = false;
		const once = stubProcessSignals();

		await expect(runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: () => ({
				port: 1,
				ready: Promise.reject(new Error("health 轮询超时")),
				stop: async () => {
					stopped = true;
				},
			}),
		})).rejects.toThrowError(/health 轮询超时/);
		once.restore();

		expect(stopped).toBe(true);
		expect(fs.existsSync(previewConfigPath(root))).toBe(false);
	});

	it("注册 SIGINT 与 exit 两路清理（派生 config 不残留）", async () => {
		const { root, siteDir, port } = makeFixture();
		const once = stubProcessSignals();

		await runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: stubStarter(port).starter,
		});
		once.restore();

		expect(once.events.filter(e => e === "SIGINT")).toHaveLength(1);
		expect(once.events.filter(e => e === "exit")).toHaveLength(1);
	});
});

describe("runPreview htmlTransform（单服务不生效）", () => {
	const MODULES = "[{ name: \"fx\", entry: \"./web/src/fx/entry.ts\" }]";

	function writeTransformConfig(root: string, spec: string) {
		fs.writeFileSync(path.join(root, "web.config.ts"), `export default { baseUrl: "", modules: ${MODULES}, htmlTransform: "${spec}" };\n`);
	}

	it("配置了 htmlTransform → WARN 指向 oj html_meta，且不 import 变换模块", async () => {
		const { root, siteDir, port } = makeFixture();
		writeTransformConfig(root, "./html-transform.ts");
		// 坏模块：一旦被 import 即刻抛错——runPreview 正常 resolve 即证明未加载
		fs.writeFileSync(path.join(root, "html-transform.ts"), "throw new Error(\"transform module must not be imported\");\n");
		const warnings: string[] = [];
		const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
			warnings.push(args.join(" "));
		});
		const once = stubProcessSignals();

		await runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: stubStarter(port).starter,
		});
		once.restore();
		warnSpy.mockRestore();

		expect(warnings.join("\n")).toMatch(/htmlTransform/);
		expect(warnings.join("\n")).toMatch(/html_meta/);
	});

	it("未配置 htmlTransform → 无 WARN", async () => {
		const { root, siteDir, port } = makeFixture();
		const warnings: string[] = [];
		const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
			warnings.push(args.join(" "));
		});
		const once = stubProcessSignals();

		await runPreview(root, {
			siteDir,
			execOj: () => {},
			ojStarter: stubStarter(port).starter,
		});
		once.restore();
		warnSpy.mockRestore();

		expect(warnings).toEqual([]);
	});
});
