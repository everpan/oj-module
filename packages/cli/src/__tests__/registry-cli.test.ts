// REG-R12 CLI 自动化契约：退出码三档（0/1/2）、`--json` 信封、`--dry-run` 零写入、
// `OJM_REGISTRY_TOKEN`，以及 `ojm config ls --show-origin`。
//
// 为什么这些用例走**真分发**（buildCli → 真 publishCommand → 真 fs）而不 mock：
// 契约的全部价值在于「同一份 argv 在 CI 里得到同样的退出码与可解析输出」。
// 一旦把业务 mock 掉，测的就只剩「mock 被调用了」，退 0/1/2 的分界也不再受检验。
//
// 三条纪律在这里被钉成断言（不只是注释）：
//   ① `--json` 下 **stdout 只有一行信封**：人话一个字都不许混进来（混进来 CI 就没法 parse）；
//   ② `--dry-run` **盘上一个字节都不变**，且有正控制（非 dry-run 会真的写）——
//      否则「零写入」可能只是「什么都没干」；
//   ③ 凭据**永不回显**：日志里只出现来源名，token 明文在任何通道都搜不到。
import type { KeyPair } from "../lifecycle/keygen";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCli, localizeCacError, reportCliError, reportUnknownCommand } from "../cli";
import { failEnvelope, OK_CODE, okEnvelope } from "../cli-output";
import { configRows } from "../config-cmd";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, exitCodeOf, UsageError } from "../exit-codes";
import { defaultTestKey } from "../lifecycle/__tests__/helpers";
import { describeCredential, normalizeRegistryUrl, resolveRegistryCredential, resolveRegistrySource, resolveRegistrySourceOptional } from "../registry-source";
import { uninstallCommand } from "../uninstall";

const CATALOG = `shards:
  "1": 1
solutions:
  - name: demo-solution
    shards:
      - 1
`;
const SHARD1 = `solutions:
  - name: demo-solution
    latest: 0.1.0
    versions:
      - version: 0.1.0
        file: demo-solution-0.1.0.tgz
`;
const REGISTRY = "https://registry.example.com";
const TOKEN = "s3cr3t-token-must-never-be-printed";

let out: string[];
let err: string[];
let home: string;
let homeBackup: string | undefined;
let tmpRoot: string;

beforeEach(() => {
	out = [];
	err = [];
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => out.push(args.map(String).join(" ")));
	vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => err.push(args.map(String).join(" ")));
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-r12-"));
	// 空 HOME：让「有没有本地凭据文件」这件事由用例决定，而不是被开发机现状左右
	home = path.join(tmpRoot, "home");
	fs.mkdirSync(home, { recursive: true });
	homeBackup = process.env.HOME;
	process.env.HOME = home;
	delete process.env.OJM_REGISTRY_TOKEN;
});

afterEach(() => {
	vi.restoreAllMocks();
	if (homeBackup === undefined)
		delete process.env.HOME;
	else
		process.env.HOME = homeBackup;
	delete process.env.OJM_REGISTRY_TOKEN;
});

interface RunResult { out: string[], err: string[], exitCode: number | undefined }

/** 跑一次真 CLI：`argv` 同时喂给 buildCli 与 reportCliError（`--json` 失败信封的归因依据） */
async function run(argv: string[], cwd: string): Promise<RunResult> {
	// 一个用例里可能连跑多轮（如「不加 --show-origin」再「--json」）：每轮重开通道，别混账
	out.length = 0;
	err.length = 0;
	const exitSpy = vi.fn();
	const exit = exitSpy as unknown as (code: number) => never;
	const cli = buildCli(cwd, "zh-CN", { exit, argv });
	try {
		cli.parse(["node", "ojm", ...argv], { run: true });
	}
	catch (error) {
		// cac 的未知选项/缺参是**同步**抛的：真入口在 index.ts 顶层 catch 里同样落到 reportCliError，
		// 测试若只 try 不接，就会绕开「--json 失败也给信封」这条契约
		reportCliError(localizeCacError(error, "zh-CN"), exit, argv);
	}
	try {
		await vi.waitUntil(() => out.length > 0 || err.length > 0 || exitSpy.mock.calls.length > 0, { timeout: 3000, interval: 10 });
	}
	catch {
		// 无输出型动作：兜底继续（断言会以空输出失败，比这里抛更清楚）
	}
	await new Promise(r => setTimeout(r, 30));
	return { out: [...out], err: [...err], exitCode: exitSpy.mock.calls[0]?.[0] as number | undefined };
}

/** 建一个可发布的索引目录（catalog + 1 片 + 私钥），返回目录与 key 路径 */
function publishDir(opts: { registry?: string } = {}): { dir: string, keyPath: string, key: KeyPair } {
	const dir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
	fs.writeFileSync(path.join(dir, "catalog.yaml"), CATALOG);
	fs.mkdirSync(path.join(dir, "shards"), { recursive: true });
	fs.writeFileSync(path.join(dir, "shards", "1.yaml"), SHARD1);
	const key = defaultTestKey();
	const keyPath = path.join(dir, "key.pem");
	fs.writeFileSync(keyPath, key.privateKeyPem);
	if (opts.registry !== undefined)
		fs.writeFileSync(path.join(dir, ".ojmrc"), JSON.stringify({ registry: opts.registry }));
	return { dir, keyPath, key };
}

/** 目录快照：相对路径 → (sha256, mtimeMs)。dry-run 的「零写入」用它逐项比对 */
function snapshot(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (d: string): void => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) {
				walk(p);
				continue;
			}
			const st = fs.statSync(p);
			out[path.relative(root, p)] = `${createHash("sha256").update(fs.readFileSync(p)).digest("hex")}@${st.mtimeMs}`;
		}
	};
	walk(root);
	return out;
}

/** stdout 恰好一行、可解析；返回解析后的对象（解析失败就让用例红在这个断言上） */
function stdoutEnvelope(r: RunResult): { ok: boolean, command: string, code: string, message: string, data: Record<string, unknown> | null } {
	expect(r.out).toHaveLength(1);
	return JSON.parse(r.out[0]!) as ReturnType<typeof stdoutEnvelope>;
}

describe("a 退出码三档：0 成功 / 1 业务失败 / 2 用法错误", () => {
	it("0：publish --dry-run 算得出来就是成功（人话在 stdout，无 --json 时）", async () => {
		const { dir, keyPath } = publishDir({ registry: REGISTRY });
		const r = await run(["publish", "--id", "test.publisher", "--key", keyPath, "--dry-run"], dir);
		expect(r.exitCode).toBeUndefined(); // 不 exit 即 0
		expect(r.out.join("\n")).toContain("--dry-run：只算不写");
	});

	it("2：publish --registry 不是 http(s) 地址（命令行写错，不是业务拒绝）", async () => {
		const { dir, keyPath } = publishDir();
		const r = await run(["publish", "--id", "test.publisher", "--key", keyPath, "--registry", "registry.example.com"], dir);
		expect(r.exitCode).toBe(EXIT_USAGE);
		expect(r.err.join("\n")).toContain("只接受 http(s) 地址");
	});

	it("2：publish 缺 --id（少一个 token，补上就能跑）", async () => {
		const { dir } = publishDir();
		const r = await run(["publish", "--dry-run"], dir);
		expect(r.exitCode).toBe(EXIT_USAGE);
		expect(r.err.join("\n")).toContain("--id");
	});

	it("1：publish 目录里没有 catalog.yaml（命令跑通了，业务说不）", async () => {
		const empty = fs.mkdtempSync(path.join(tmpRoot, "empty-"));
		const keyPath = path.join(empty, "key.pem");
		fs.writeFileSync(keyPath, defaultTestKey().privateKeyPem);
		const r = await run(["publish", "--id", "test.publisher", "--key", keyPath], empty);
		expect(r.exitCode).toBe(EXIT_FAILURE);
		expect(r.err.join("\n")).toContain("须含 catalog.yaml");
	});

	it("2：config 未知子命令（不静默当 ls 跑）", async () => {
		const { dir } = publishDir();
		const r = await run(["config", "set"], dir);
		expect(r.exitCode).toBe(EXIT_USAGE);
		expect(r.err.join("\n")).toContain("config 只支持 ls");
	});

	it("0：config ls 在「一条源都没配」时也是成功（诊断命令要把空着显示出来）", async () => {
		const { dir } = publishDir();
		const r = await run(["config", "ls"], dir);
		expect(r.exitCode).toBeUndefined();
		expect(r.out.join("\n")).toContain("（未配置）");
	});

	it("2：uninstall 不接 --registry（Q7：卸载不涉及仓库）", async () => {
		const { dir } = publishDir();
		const r = await run(["uninstall", "demo", "--registry", REGISTRY], dir);
		expect(r.exitCode).toBe(EXIT_USAGE);
		expect(r.err.join("\n")).toContain("不涉及仓库");
	});

	it("未知选项也是 2（cac 报错被升格为用法错误）", async () => {
		const { dir, keyPath } = publishDir();
		const r = await run(["publish", "--id", "test.publisher", "--key", keyPath, "--nope"], dir);
		expect(r.exitCode).toBe(EXIT_USAGE);
		expect(r.err.join("\n")).toContain("未知选项：--nope");
	});

	it("未知命令 + --json：stdout 只有信封，帮助文本改走 stderr（实测踩过的洞）", () => {
		// 回归：以前 `ojm nope --json` 把整页帮助打到 stdout，CI 的 JSON.parse 直接炸
		const r = reportUnknownCommand("nope", "zh-CN", false, ["nope", "--json"]);
		expect(r.code).toBe(EXIT_USAGE);
		expect(out).toHaveLength(1);
		const env = JSON.parse(out[0]!) as { ok: boolean, code: string, command: string };
		expect([env.ok, env.code, env.command]).toEqual([false, "usage_error", "nope"]);
		expect(err.join("\n")).toContain("工程脚手架"); // 帮助还在，只是在人通道
		// 不带 --json：帮助照旧走 stdout（交互用户看到的就是帮助）
		out.length = 0;
		err.length = 0;
		reportUnknownCommand("nope", "zh-CN", false, ["nope"]);
		expect(out.join("\n")).toContain("工程脚手架");
		expect(err).toHaveLength(0);
	});

	it("exitCodeOf：只有 UsageError 归 2，其余一律 1（拿不准就归 1）", () => {
		expect(exitCodeOf(new UsageError("x"))).toBe(EXIT_USAGE);
		expect(exitCodeOf(new Error("x"))).toBe(EXIT_FAILURE);
		expect(exitCodeOf("x")).toBe(EXIT_FAILURE);
		expect(EXIT_OK).toBe(0);
	});
});

describe("b --json 稳定字段（schema 断言，不做快照全量比对）", () => {
	it("成功信封：字段名与类型固定，payload 只含契约里的键", async () => {
		const { dir, keyPath } = publishDir({ registry: REGISTRY });
		process.env.OJM_REGISTRY_TOKEN = TOKEN;
		const r = await run(["publish", "--id", "test.publisher", "--key", keyPath, "--dry-run", "--json"], dir);
		const env = stdoutEnvelope(r);
		// 信封：加字段可以，改名/删字段是破坏性变更 → 这里把「现在是哪五个」写死
		expect(Object.keys(env).sort()).toEqual(["code", "command", "data", "message", "ok"]);
		expect(env.ok).toBe(true);
		expect(env.command).toBe("publish");
		expect(env.code).toBe(OK_CODE);
		expect(typeof env.message).toBe("string");
		// 载荷：CI 靠这些键分支
		expect(Object.keys(env.data!).sort()).toEqual([
			"catalog",
			"checkPassed",
			"credential",
			"dryRun",
			"fingerprint",
			"keyId",
			"registry",
			"seq",
			"shards",
			"writes",
		]);
		expect(env.data!.dryRun).toBe(true);
		expect(env.data!.seq).toBe(1);
		expect(env.data!.keyId).toBe("test.publisher");
		expect(env.data!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(env.data!.registry).toEqual({ url: REGISTRY, level: "project" });
		expect(env.data!.credential).toBe("env");
		expect(env.data!.catalog).toBe("catalog.yaml");
		expect(env.data!.shards).toEqual(["shards/1.yaml"]);
		expect(env.data!.writes).toEqual(["shards/1.yaml", "shards/1.yaml.sig", "catalog.yaml", "catalog.yaml.sig"]);
	});

	it("stdout 只有信封：人话全在 stderr（CI 不必从文案里刨 JSON）", async () => {
		const { dir, keyPath } = publishDir({ registry: REGISTRY });
		process.env.OJM_REGISTRY_TOKEN = TOKEN;
		const r = await run(["publish", "--id", "test.publisher", "--key", keyPath, "--dry-run", "--json"], dir);
		expect(r.out).toHaveLength(1);
		expect(() => JSON.parse(r.out[0]!)).not.toThrow();
		// 人类可读的每一行都在 stderr
		expect(r.err.join("\n")).toContain("[ojm] 仓库源");
		expect(r.err.join("\n")).toContain("--dry-run：只算不写");
	});

	it("失败信封：ok=false、data=null、code 区分 usage_error / failed", async () => {
		const { dir, keyPath } = publishDir();
		const usage = await run(["publish", "--id", "test.publisher", "--key", keyPath, "--registry", "nope", "--json"], dir);
		expect(usage.exitCode).toBe(EXIT_USAGE);
		const ue = stdoutEnvelope(usage);
		expect(ue.ok).toBe(false);
		expect(ue.data).toBeNull();
		expect([ue.code, ue.command]).toEqual(["usage_error", "publish"]);
		expect(Object.keys(ue).sort()).toEqual(["code", "command", "data", "message", "ok"]);

		const failed = await run(["publish", "--json"], dir);
		expect(failed.exitCode).toBe(EXIT_USAGE); // 缺 --id 仍是用法错误
		const fe = stdoutEnvelope(failed);
		expect(fe.code).toBe("usage_error");
	});

	it("信封构造器：成功/失败的 code 与 data 语义不混（失败永不夹带半份载荷）", () => {
		expect(okEnvelope("publish", { a: 1 })).toMatchObject({ ok: true, code: OK_CODE, data: { a: 1 } });
		expect(failEnvelope("publish", "failed", "boom")).toMatchObject({ ok: false, code: "failed", data: null });
	});
});

describe("c --dry-run 全程零写入（有正控制）", () => {
	it("dry-run 后盘上一个字节都没变，且 .sig 一个都没落地", async () => {
		const { dir, keyPath } = publishDir({ registry: REGISTRY });
		const before = snapshot(dir);
		const r = await run(["publish", "--id", "test.publisher", "--key", keyPath, "--dry-run", "--json"], dir);
		const env = stdoutEnvelope(r);
		expect(env.data!.dryRun).toBe(true);
		// 「本应写入」照常报出来：CI 可以先 diff 意图，再决定是否真发
		expect(env.data!.writes).toHaveLength(4);
		expect(snapshot(dir)).toEqual(before);
		expect(fs.existsSync(path.join(dir, "catalog.yaml.sig"))).toBe(false);
		expect(fs.existsSync(path.join(dir, "shards", "1.yaml.sig"))).toBe(false);
	});

	it("正控制：同目录去掉 --dry-run 就真的写（证明零写入不是「什么都没干」）", async () => {
		const { dir, keyPath } = publishDir({ registry: REGISTRY });
		const before = snapshot(dir);
		await run(["publish", "--id", "test.publisher", "--key", keyPath, "--json"], dir);
		const after = snapshot(dir);
		expect(after).not.toEqual(before);
		expect(fs.existsSync(path.join(dir, "catalog.yaml.sig"))).toBe(true);
		expect(fs.existsSync(path.join(dir, "shards", "1.yaml.sig"))).toBe(true);
	});
});

describe("d OJM_REGISTRY_TOKEN：CI 不跑 login 也能发（且不落任何凭据文件）", () => {
	it("gherkin：env token + 无本地凭据文件 → exit 0 + stdout 是 JSON + 没有上传", async () => {
		const { dir, keyPath } = publishDir({ registry: REGISTRY });
		process.env.OJM_REGISTRY_TOKEN = TOKEN;
		// 「无本地凭据文件」是事实而非假设：HOME 指向空目录
		expect(fs.existsSync(path.join(home, ".ojm", "config.json"))).toBe(false);
		const before = snapshot(dir);

		const r = await run(["publish", "--json", "--dry-run", "--id", "test.publisher", "--key", keyPath], dir);

		expect(r.exitCode).toBeUndefined();
		const env = stdoutEnvelope(r);
		expect(env.ok).toBe(true);
		expect(env.data!.credential).toBe("env");
		expect(env.data!.registry).toEqual({ url: REGISTRY, level: "project" });
		// 没有上传：dry-run 不写盘，也从未产生任何网络副作用（本命令今天只落本地目录）
		expect(snapshot(dir)).toEqual(before);
		// 凭据来源写在日志里，token 明文不写在任何通道
		expect(r.err.join("\n")).toContain("OJM_REGISTRY_TOKEN（已设置）");
		expect([...r.out, ...r.err].join("\n")).not.toContain(TOKEN);
	});

	it("凭据解析：env > 用户配置分桶 > 缺失；工程级 .ojmrc 永不收 token", () => {
		const userFile = path.join(home, ".ojm", "config.json");
		fs.mkdirSync(path.dirname(userFile), { recursive: true });
		fs.writeFileSync(userFile, JSON.stringify({
			registry: REGISTRY,
			registries: { [new URL(REGISTRY).origin]: { token: "store-token" } },
		}));
		const source = resolveRegistrySource({ cwd: tmpRoot, home });

		expect(resolveRegistryCredential(source, { home }).kind).toBe("store");
		expect(resolveRegistryCredential(source, { home, env: { OJM_REGISTRY_TOKEN: TOKEN } as NodeJS.ProcessEnv })).toMatchObject({ kind: "env", token: TOKEN });
		// 换源不会串用：分桶的键是 origin
		expect(resolveRegistryCredential({ url: "https://other.example.com", level: "flag", originFile: null }, { home }).kind).toBe("missing");
		// .ojmrc 里写 token 也不被读（它要入库，token 入仓即泄露）：换个只有工程级配置的源，
		// 用户配置里没有它的分桶 → 仍然「缺失」，证明 token 键被无视
		const projectOnly = "https://project-only.example.com";
		fs.writeFileSync(path.join(tmpRoot, ".ojmrc"), JSON.stringify({ registry: projectOnly, token: "project-token" }));
		expect(resolveRegistryCredential(resolveRegistrySource({ cwd: tmpRoot, home }), { home, env: {} as NodeJS.ProcessEnv }).kind).toBe("missing");
	});

	it("describeCredential 只报来源，永不回显 token", () => {
		const text = describeCredential({ kind: "env", token: TOKEN, origin: "OJM_REGISTRY_TOKEN" });
		expect(text).toContain("OJM_REGISTRY_TOKEN");
		expect(text).not.toContain(TOKEN);
		const stored = describeCredential({ kind: "store", token: TOKEN, origin: "/home/u/.ojm/config.json（https://r）" });
		expect(stored).toContain("已保存");
		expect(stored).not.toContain(TOKEN);
		expect(describeCredential({ kind: "missing", token: null, origin: null })).toContain("缺失");
	});
});

describe("e 源解析：--registry > .ojmrc > 用户配置；没配 ≠ 配错", () => {
	it("三级顺序逐级生效，高层一给就不再读文件", () => {
		const proj = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
		fs.writeFileSync(path.join(proj, ".ojmrc"), JSON.stringify({ registry: "https://project.example.com/" }));
		const userFile = path.join(home, ".ojm", "config.json");
		fs.mkdirSync(path.dirname(userFile), { recursive: true });
		fs.writeFileSync(userFile, JSON.stringify({ registry: "https://user.example.com" }));

		expect(resolveRegistrySource({ cwd: proj, home })).toMatchObject({ url: "https://project.example.com", level: "project" });
		expect(resolveRegistrySource({ cwd: proj, home, flag: "https://flag.example.com" })).toMatchObject({ url: "https://flag.example.com", level: "flag" });
		const empty = fs.mkdtempSync(path.join(tmpRoot, "noproj-"));
		expect(resolveRegistrySource({ cwd: empty, home })).toMatchObject({ url: "https://user.example.com", level: "user" });
	});

	it("一条源都没配 → Optional 返 null，严格版抛用法错误（列出三种配法）", () => {
		const empty = fs.mkdtempSync(path.join(tmpRoot, "none-"));
		const emptyHome = fs.mkdtempSync(path.join(tmpRoot, "nohome-"));
		expect(resolveRegistrySourceOptional({ cwd: empty, home: emptyHome })).toBeNull();
		expect(() => resolveRegistrySource({ cwd: empty, home: emptyHome })).toThrow(/未指定仓库源[\s\S]*--registry[\s\S]*\.ojmrc/);
	});

	it("配了但配坏了 → 抛错（绝不降级成「未配置」）", () => {
		const bad = fs.mkdtempSync(path.join(tmpRoot, "bad-"));
		fs.writeFileSync(path.join(bad, ".ojmrc"), "{ not json");
		expect(() => resolveRegistrySourceOptional({ cwd: bad, home })).toThrow(/配置文件不可解析/);
		// 坏 .ojmrc 不是用法错误（退出码 1）：改的是文件内容，不是命令行
		expect(exitCodeOf(new Error("[ojm] 配置文件不可解析"))).toBe(EXIT_FAILURE);
	});

	it("normalizeRegistryUrl：去尾斜杠、只收 http(s)、空值即用法错误", () => {
		expect(normalizeRegistryUrl("https://r.example.com///")).toBe("https://r.example.com");
		expect(() => normalizeRegistryUrl("ftp://r")).toThrow(UsageError);
		expect(() => normalizeRegistryUrl("  ")).toThrow(UsageError);
	});
});

describe("f config ls --show-origin：把「从哪来」摊开", () => {
	it("人话列：registry.url 带来源级别，token 只报来源", async () => {
		const { dir } = publishDir({ registry: REGISTRY });
		process.env.OJM_REGISTRY_TOKEN = TOKEN;
		const r = await run(["config", "ls", "--show-origin"], dir);
		const text = r.out.join("\n");
		expect(r.exitCode).toBeUndefined();
		expect(text).toMatch(/registry\.url\s+https:\/\/registry\.example\.com\s+← \.ojmrc/);
		expect(text).toMatch(/registry\.token\s+OJM_REGISTRY_TOKEN（已设置）/);
		expect(text).toContain("site.url");
		expect(text).not.toContain(TOKEN);
	});

	it("--show-origin 省略时不加来源列（但 --json 里恒有 origin 字段）", async () => {
		const { dir } = publishDir({ registry: REGISTRY });
		const plain = await run(["config", "ls"], dir);
		expect(plain.out.join("\n")).not.toContain("←");

		const json = await run(["config", "ls", "--json"], dir);
		const env = stdoutEnvelope(json);
		expect(env.command).toBe("config ls");
		expect(Object.keys(env.data!).sort()).toEqual(["rows"]);
		const rows = env.data!.rows as Array<Record<string, unknown>>;
		expect(rows.map(row => row.key)).toEqual(["registry.url", "registry.token", "site.url", "site.credentials"]);
		for (const row of rows)
			expect(Object.keys(row).sort()).toEqual(["key", "origin", "value"]);
	});

	it("configRows：未配置时四行都退化成人话，而不是抛错", () => {
		const rows = configRows({ cwd: tmpRoot, home, env: {} as NodeJS.ProcessEnv });
		expect(rows[0]).toMatchObject({ key: "registry.url", value: "（未配置）" });
		expect(rows[0]!.origin).toContain("--registry");
		expect(rows[1]).toMatchObject({ key: "registry.token", value: "（无源可绑定）" });
		expect(rows[2]!.value).toMatch(/^https?:\/\//);
		expect(rows[3]!.value).toContain("缺失");
	});

	it("configRows：站点凭据只报设没设，不回显账号密码", () => {
		const rows = configRows({ cwd: tmpRoot, home, env: { OJM_USER: "admin", OJM_PASS: "p@ss" } as NodeJS.ProcessEnv });
		const site = rows.find(row => row.key === "site.credentials")!;
		expect(site.value).toContain("已设置");
		expect(JSON.stringify(rows)).not.toContain("p@ss");
	});
});

describe("g Q7：uninstall 在联网前就拒绝 --registry", () => {
	it("命令体直接抛用法错误，一次 fetch 都没发", async () => {
		const fetchFn = vi.fn();
		await expect(uninstallCommand("demo", { url: "http://x", user: "u", pass: "p", registry: REGISTRY, fetchFn: fetchFn as unknown as typeof fetch }))
			.rejects
			.toThrow(/不涉及仓库/);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
