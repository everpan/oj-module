import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startOj } from "../../packages/cli/src/oj";

/**
 * 设计 §4（P3）：oj 子进程编排（不依赖真二进制，桩 bin/oj）。
 *  - spawn 参数：server -c <abs config> -b /api --api-path <abs api/src>，
 *    端口经 readOjPort 从 config 读取（T3）
 *  - 健康：桩监听并 200 {base}/health → ready resolve
 *  - 秒退：ready 拒绝且 stderr 尾部在错误信息里（人话报错）
 *  - 永不监听：超时拒绝（测试注入 10ms/150ms 缩短）
 *  - stop() 回收子进程（SIGTERM 后退出）
 */

const FIXTURE_ROOT = path.join(process.cwd(), ".tmp-oj-fx");

function makeFixture(mode: "healthy" | "exit" | "silent"): { root: string, configPath: string, port: number } {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, `oj-${mode}-`));
	// 并行测试端口区间不得重叠（2026-09-04 flaky 根因，见 playground-oj 设计 §10）
	const port = 20000 + Math.floor(Math.random() * 1000);
	const configPath = path.join(root, "api/config.yaml");
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, `server:\n  host: 127.0.0.1\n  port: ${port}\n  base: /api\n`);
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));

	const binDir = path.join(root, "bin");
	fs.mkdirSync(binDir, { recursive: true });
	const argsFile = JSON.stringify(path.join(root, "oj-args.json"));
	const stoppedFile = JSON.stringify(path.join(root, "oj-stopped"));
	fs.writeFileSync(path.join(binDir, "oj"), [
		"#!/usr/bin/env node",
		"import fs from \"node:fs\";",
		"import http from \"node:http\";",
		"const argv = process.argv.slice(2);",
		`fs.writeFileSync(${argsFile}, JSON.stringify(argv));`,
		"const mode = process.env.STUB_OJ_MODE ?? \"healthy\";",
		"if (mode === \"exit\") {",
		"\tconsole.error(\"boom-fatal: certificate not found\");",
		"\tprocess.exit(7);",
		"}",
		"const configText = fs.readFileSync(argv[argv.indexOf(\"-c\") + 1], \"utf-8\");",
		"const port = Number(configText.match(/port:\\s*(\\d+)/)[1]);",
		"if (mode === \"silent\") {",
		"\tsetInterval(() => {}, 1000);",
		"} else {",
		"\thttp.createServer((_req, res) => { res.writeHead(200, {\"content-type\": \"application/json\"}); res.end(\"{}\"); }).listen(port, \"127.0.0.1\");",
		"}",
		`process.on(\"SIGTERM\", () => { fs.writeFileSync(${stoppedFile}, \"1\"); process.exit(0); });`,
		"",
	].join("\n"));
	fs.chmodSync(path.join(binDir, "oj"), 0o755);
	return { root, configPath, port };
}

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("startOj 子进程编排", () => {
	it("健康路径：spawn 参数 server/-c/-b/--api-path 全按契约，ready resolve，stop() 回收", async () => {
		const { root, configPath, port } = makeFixture("healthy");
		const apiSrc = path.join(root, "api/src");
		fs.mkdirSync(apiSrc, { recursive: true });

		// timeoutMs 对齐生产默认：全量并行时 node 子进程冷启动可超 3s（§10 flaky 根因）
		const proc = startOj(configPath, "/api", apiSrc, { intervalMs: 20, timeoutMs: 10000 });
		await proc.ready;

		const args = JSON.parse(fs.readFileSync(path.join(root, "oj-args.json"), "utf-8")) as string[];
		expect(args[0]).toBe("server");
		const cfgFlag = args[args.indexOf("-c") + 1];
		const apiFlag = args[args.indexOf("--api-path") + 1];
		expect(path.isAbsolute(cfgFlag)).toBe(true);
		expect(cfgFlag).toBe(configPath);
		expect(args[args.indexOf("-b") + 1]).toBe("/api");
		expect(path.isAbsolute(apiFlag)).toBe(true);
		expect(apiFlag).toBe(apiSrc);
		expect(proc.port).toBe(port);

		await proc.stop();
		// 桩在 SIGTERM 时写 stopped 标记再退出
		const stopped = path.join(root, "oj-stopped");
		await new Promise<void>((resolve) => {
			const started = Date.now();
			const check = () => {
				if (fs.existsSync(stopped) || Date.now() - started > 2000)
					resolve();
				else
					setTimeout(check, 20);
			};
			check();
		});
		expect(fs.existsSync(stopped)).toBe(true);
	});

	it("extraArgs 透传（preview 的 --app-path 场景）", async () => {
		const { root, configPath } = makeFixture("healthy");
		const proc = startOj(configPath, "/api", path.join(root, "api/src"), { intervalMs: 20, timeoutMs: 10000 }, ["--app-path", "/tmp/site"]);
		await proc.ready;
		const args = JSON.parse(fs.readFileSync(path.join(root, "oj-args.json"), "utf-8")) as string[];
		expect(args.slice(-2)).toEqual(["--app-path", "/tmp/site"]);
		await proc.stop();
	});

	it("秒退 → ready 拒绝且 stderr 尾部在错误信息里", async () => {
		const { root, configPath } = makeFixture("exit");
		process.env.STUB_OJ_MODE = "exit";
		const proc = startOj(configPath, "/api", path.join(root, "api/src"), { intervalMs: 20, timeoutMs: 3000 });
		await expect(proc.ready).rejects.toThrowError(/boom-fatal/);
		await proc.stop();
		delete process.env.STUB_OJ_MODE;
	});

	it("永不监听 → 注入超时后 ready 拒绝且报错提到健康检查超时", async () => {
		const { root, configPath, port } = makeFixture("silent");
		process.env.STUB_OJ_MODE = "silent";
		const proc = startOj(configPath, "/api", path.join(root, "api/src"), { intervalMs: 10, timeoutMs: 150 });
		await expect(proc.ready).rejects.toThrowError(/超时/);
		await proc.stop();
		delete process.env.STUB_OJ_MODE;
		expect(port).toBeGreaterThan(0);
	});
});
