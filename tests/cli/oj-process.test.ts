import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startOj } from "../../packages/cli/src/oj";

/**
 * 设计 §4（P3）：oj 子进程编排（不依赖真二进制，桩 bin/oj）。
 *  - spawn 参数：serve -c <abs config> -b /api --api-path <abs api/src>
 *    --console-log（oj 新版终端默认静默，只落 logs/，ojm 透传管道须显式打开），
 *    端口经 readOjPort 从 config 读取（T3）
 *    子命令是 serve 不是 server——oj 0.1.50 已移除 server（实测 `oj server --help`
 *    → unrecognized subcommand），ojm 按最新版对齐，不做兼容分支。
 *  - 健康：桩监听并 200 {base}/health → ready resolve
 *  - 秒退：ready 拒绝且 stderr 尾部在错误信息里（人话报错）
 *  - 永不监听：超时拒绝（测试注入 10ms/150ms 缩短）
 *  - stop() 回收子进程（SIGTERM 后退出）
 */

const FIXTURE_ROOT = path.join(process.cwd(), ".tmp-oj-fx");

function makeFixture(mode: "healthy" | "exit" | "silent" | "logonly"): { root: string, configPath: string, port: number } {
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
	const envFile = JSON.stringify(path.join(root, "oj-env.json"));
	const stoppedFile = JSON.stringify(path.join(root, "oj-stopped"));
	fs.writeFileSync(path.join(binDir, "oj"), [
		"#!/usr/bin/env node",
		"import fs from \"node:fs\";",
		"import http from \"node:http\";",
		"import crypto from \"node:crypto\";",
		"import path from \"node:path\";",
		"const argv = process.argv.slice(2);",
		`fs.writeFileSync(${argsFile}, JSON.stringify(argv));`,
		`fs.writeFileSync(${envFile}, JSON.stringify({ ojPluginsDir: process.env.OJ_PLUGINS_DIR ?? null }));`,
		"const mode = process.env.STUB_OJ_MODE ?? \"healthy\";",
		"// 凭据密封桩：keygen/seal/open 用同一把对称密钥派生（sha256(pem)），密钥不配对即解密失败",
		"if (argv[0] === \"secret\") {",
		"\tconst sub = argv[1];",
		"\tif (sub === \"keygen\") {",
		"\t\tconst dir = argv[argv.indexOf(\"--out-dir\") + 1];",
		"\t\tconst { privateKey, publicKey } = crypto.generateKeyPairSync(\"ed25519\");",
		"\t\tfs.writeFileSync(dir + \"/secrets-private.pem\", privateKey.export({ type: \"pkcs8\", format: \"pem\" }));",
		"\t\tfs.writeFileSync(dir + \"/secrets-public.pem\", publicKey.export({ type: \"spki\", format: \"pem\" }));",
		"\t\tprocess.exit(0);",
		"\t}",
		"\tconst pub = argv[argv.indexOf(\"-k\") + 1];",
		"\tconst key = crypto.createHash(\"sha256\").update(fs.readFileSync(pub)).digest();",
		"\tif (sub === \"seal\") {",
		"\t\tconst plain = fs.readFileSync(0, \"utf-8\");",
		"\t\tconst nonce = crypto.randomBytes(12);",
		"\t\tconst cipher = crypto.createCipheriv(\"aes-256-gcm\", key, nonce);",
		"\t\tconst ct = Buffer.concat([cipher.update(plain, \"utf-8\"), cipher.final()]);",
		"\t\tconst tag = cipher.getAuthTag();",
		"\t\tprocess.stdout.write(\"ENC[\" + Buffer.concat([nonce, tag, ct]).toString(\"base64\") + \"]\");",
		"\t\tprocess.exit(0);",
		"\t}",
		"\tconst privPem = fs.readFileSync(pub);",
		"\tconst pubPem = crypto.createPublicKey(crypto.createPrivateKey(privPem)).export({ type: \"spki\", format: \"pem\" });",
		"\tconst key2 = crypto.createHash(\"sha256\").update(pubPem).digest();",
		"\tconst enc = argv[argv.length - 1];",
		"\tconst raw = Buffer.from(enc.slice(4, -1), \"base64\");",
		"\tconst nonce = raw.subarray(0, 12); const tag = raw.subarray(12, 28); const ct = raw.subarray(28);",
		"\ttry { const d = crypto.createDecipheriv(\"aes-256-gcm\", key2, nonce); d.setAuthTag(tag); d.update(ct); d.final(); process.exit(0); }",
		"\tcatch { process.stderr.write(\"open failed\\n\"); process.exit(1); }",
		"}",
		"if (mode === \"exit\") {",
		"\tconsole.error(\"boom-fatal: certificate not found\");",
		"\tprocess.exit(7);",
		"}",
		"if (mode === \"logonly\") {",
		"\tconst configPath = argv[argv.indexOf(\"-c\") + 1];",
		"\tconst logsDir = path.join(path.dirname(configPath), \"logs\");",
		"\tfs.mkdirSync(logsDir, { recursive: true });",
		"\tfs.writeFileSync(path.join(logsDir, 'server-' + Date.now() + '_' + process.pid + '.log'), \"FATAL: jwt_secret decrypt failed: private key mismatch\\n[oj] 2026-11-03T00:00:00Z ERROR auth setup aborted\\n\");",
		"\tprocess.exit(1);",
		"}",
		"const configText = fs.readFileSync(argv[argv.indexOf(\"-c\") + 1], \"utf-8\");",
		"const port = Number(configText.match(/port:\\s*(\\d+)/)[1]);",
		"if (mode === \"silent\") {",
		"\tsetInterval(() => {}, 1000);",
		"} else {",
		"\thttp.createServer((_req, res) => { res.writeHead(200, {\"content-type\": \"application/json\"}); res.end(\"{}\"); }).listen(port, \"127.0.0.1\");",
		"}",
		"// 模拟 oj 原生 tracing 输出：首行带 [oj] 前缀，续行裸缩进（SQL 多行场景）",
		"if (process.env.STUB_OJ_LOG === \"1\") {",
		"\tprocess.stdout.write(\"[oj] 2026-10-07T03:05:54.004158Z  INFO request method=GET path=/api/x status=200 ms=0\\n\");",
		"\tprocess.stdout.write(\"  permission, status, create_time\\n\");",
		"\tprocess.stdout.write(\"plain-console-log-from-handler\\n\");",
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

// bin/oj 桩是 shebang 脚本，Windows CreateProcess 只认 PE，无法 spawn（vendor.test.ts 同款 posixOnly）。
describe.skipIf(process.platform === "win32")("startOj 子进程编排", () => {
	it("健康路径：spawn 参数 serve/-c/-b/--api-path 全按契约，ready resolve，stop() 回收", async () => {
		const { root, configPath, port } = makeFixture("healthy");
		const apiSrc = path.join(root, "api/src");
		fs.mkdirSync(apiSrc, { recursive: true });

		// timeoutMs 对齐生产默认：全量并行时 node 子进程冷启动可超 3s（§10 flaky 根因）
		const proc = startOj(configPath, "/api", apiSrc, { intervalMs: 20, timeoutMs: 10000 });
		await proc.ready;

		const args = JSON.parse(fs.readFileSync(path.join(root, "oj-args.json"), "utf-8")) as string[];
		// oj 0.1.50 子命令是 serve（server 已移除）
		expect(args[0]).toBe("serve");
		const cfgFlag = args[args.indexOf("-c") + 1];
		const apiFlag = args[args.indexOf("--api-path") + 1];
		expect(path.isAbsolute(cfgFlag)).toBe(true);
		expect(cfgFlag).toBe(configPath);
		expect(args[args.indexOf("-b") + 1]).toBe("/api");
		expect(args).toContain("--console-log");
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

	it("bin/plugins 存在 → spawn 注入 OJ_PLUGINS_DIR（不依赖 oj 的 current_exe 启发式）", async () => {
		const { root, configPath } = makeFixture("healthy");
		fs.mkdirSync(path.join(root, "bin/plugins/x86_64-unknown-linux-gnu"), { recursive: true });
		const proc = startOj(configPath, "/api", path.join(root, "api/src"), { intervalMs: 20, timeoutMs: 10000 });
		await proc.ready;
		const env = JSON.parse(fs.readFileSync(path.join(root, "oj-env.json"), "utf-8")) as { ojPluginsDir: string | null };
		// 指向 base 目录，<triple> 子目录由 oj 的 resolve_plugins_dir 拼接
		expect(env.ojPluginsDir).toBe(path.join(root, "bin", "plugins"));
		await proc.stop();
	});

	it("config 顶层声明 plugins_dir → 不注入（env 优先级高于 toml，注入会静默覆盖用户配置）", async () => {
		const { root, configPath } = makeFixture("healthy");
		fs.mkdirSync(path.join(root, "bin/plugins/x86_64-unknown-linux-gnu"), { recursive: true });
		fs.appendFileSync(configPath, "plugins_dir: ./custom\n");
		const proc = startOj(configPath, "/api", path.join(root, "api/src"), { intervalMs: 20, timeoutMs: 10000 });
		await proc.ready;
		const env = JSON.parse(fs.readFileSync(path.join(root, "oj-env.json"), "utf-8")) as { ojPluginsDir: string | null };
		expect(env.ojPluginsDir).toBeNull();
		await proc.stop();
	});

	it("bin/plugins 缺失 → 不注入（保持 oj 原行为，不生「plugins dir not found」次生错误）", async () => {
		const { root, configPath } = makeFixture("healthy");
		const proc = startOj(configPath, "/api", path.join(root, "api/src"), { intervalMs: 20, timeoutMs: 10000 });
		await proc.ready;
		const env = JSON.parse(fs.readFileSync(path.join(root, "oj-env.json"), "utf-8")) as { ojPluginsDir: string | null };
		expect(env.ojPluginsDir).toBeNull();
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

	it("stdout/stderr 直接透传（不叠 [oj] 前缀；oj 自身 tracing 已带 [oj]）", async () => {
		const { root, configPath } = makeFixture("healthy");
		process.env.STUB_OJ_LOG = "1";
		const written: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
			written.push(String(c));
			return true;
		});
		const proc = startOj(configPath, "/api", path.join(root, "api/src"), { intervalMs: 20, timeoutMs: 10000 });
		await proc.ready;
		// 等 stub 的 STUB_OJ_LOG 输出被管道刷出
		await new Promise(r => setTimeout(r, 100));
		await proc.stop();
		spy.mockRestore();
		delete process.env.STUB_OJ_LOG;

		const all = written.join("");
		// 不得叠成 [oj] [oj]
		expect(all).not.toContain("[oj] [oj]");
		// 原生 [oj] 行原样保留
		expect(all).toContain("[oj] 2026-10-07T03:05:54.004158Z  INFO request method=GET");
		// 续行（原裸缩进）原样保留，未被强加 [oj] 前缀
		expect(all).toContain("  permission, status, create_time");
		// 裸 handler console.log 原样透传，不加 [oj] 前缀
		expect(all).toContain("plain-console-log-from-handler");
	});

	it("失败不吞提示（G4）：oj 只落盘 logs/、stderr 空 → ready 拒绝信息含日志真实错误行（非「无输出」）", async () => {
		const { root, configPath } = makeFixture("logonly");
		process.env.STUB_OJ_MODE = "logonly";
		const proc = startOj(configPath, "/api", path.join(root, "api/src"), { intervalMs: 20, timeoutMs: 3000 });
		// 关键不变量：错误信息必须来自 logs/server-*.log（非 stderr），不再只剩「（无输出）」
		let err: Error | undefined;
		try {
			await proc.ready;
		}
		catch (e) {
			err = e as Error;
		}
		expect(err).toBeDefined();
		expect(err!.message).toContain("jwt_secret decrypt failed");
		expect(err!.message).not.toContain("（无输出）");
		await proc.stop();
		delete process.env.STUB_OJ_MODE;
	});
});
