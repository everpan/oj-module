// BDD：`ojm registry export`（REG-R11 离线包的产出端）。
//
// 这条命令的存在理由：离线包的**消费端**（`ojm registry import`）早就有，产出端一直靠手工拼——
// public 站点能整拷 `<cdn>/registry/`，private 站点（REG-R8 的 private 载体）没有那个静态目录，
// 只能照格式一个个 curl。所以用例盯四件事：
//   ① 产物与 import 逐字对齐：跑完 export 直接把目录喂给 import，能过验签（否则「导出的包自己导不进去」）；
//   ② 三条自洽校验各拦一次：正文与侧车不符 / 分片代数与钉值不符 / 包体 sha 或长度与索引不符；
//   ③ 失败不留半份包：暂存目录整体换位，失败后 `<out>/registry/` 不存在、隐藏暂存也不残留；
//   ④ `--dry-run` 只验索引、不下载包体、零落盘。
import type { KeyPair } from "../lifecycle/keygen";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { buildCli, localizeCacError, reportCliError } from "../cli";
import { generateKeyPair } from "../lifecycle/keygen";
import { signCanonical } from "../lifecycle/sign";
import { indexCanonical, revocationCanonical } from "../publish";
import { registryExportCommand, RegistryExportError } from "../registry-export";
import { registryImportCommand } from "../registry-import";

let tmpRoot: string;
let cwd: string;
let tmpHome: string;

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-registry-export-"));
	cwd = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
	tmpHome = fs.mkdtempSync(path.join(tmpRoot, "home-"));
	vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const SITE = "https://reg.example.com";
const API = `${SITE}/api/oj-registry/cdn`;

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/** 造一份 detached `.sig` 六字段（alg/key_id/public_key/value/canon/seq） */
function makeSig(key: KeyPair, seq: number, body: string, kind: "catalog" | "shard" | "revocation"): string {
	const canon = kind === "revocation" ? revocationCanonical(seq, body) : indexCanonical(kind, seq, body);
	return JSON.stringify({
		alg: "Ed25519",
		key_id: "registry.index",
		public_key: key.publicKeyHex,
		value: signCanonical(key.privateKeyPem, canon),
		canon: "v2",
		seq,
	});
}

interface Route { status?: number, body?: string | Uint8Array }

interface FixtureOpts {
	key: KeyPair
	/** 索引里的版本（默认一个 acme-demo@1.0.0） */
	versions?: Array<{ slug: string, version: string }>
	/** 分片正文里声明的 sha256（不给 = 真实摘要；给了就制造「摘要不符」） */
	declaredSha?: string
	/** 分片签名代次（默认 = catalog 钉值） */
	shardSeq?: number
	catalogSeq?: number
	/** catalog 钉的分片代次（默认 2；与 shardSeq 不同即制造「半代索引」） */
	catalogPin?: number
	/** 先签后改正文，制造「正文与侧车不符」 */
	tamperShard?: boolean
	/** 不给则吊销签名返回 404（模拟「站点还没签过名」） */
	revocationSigned?: boolean
	/** 覆盖任意路由（后写优先） */
	overrides?: Record<string, Route>
}

interface Fixture {
	fetchFn: typeof fetch
	calls: string[]
	/** 每个包体的真实字节（断言落盘逐字节一致） */
	bodies: Map<string, Uint8Array>
}

/** 假 registry：按读面路径给 catalog / 分片 / 吊销清单 / 包体与各自的 .sig */
function buildRegistry(opts: FixtureOpts): Fixture {
	const catalogSeq = opts.catalogSeq ?? 3;
	const catalogPin = opts.catalogPin ?? 2;
	const shardSeq = opts.shardSeq ?? catalogPin;
	const versions = opts.versions ?? [{ slug: "acme-demo", version: "1.0.0" }];
	const bodies = new Map<string, Uint8Array>();
	const routes = new Map<string, Route>();

	// 每版本一份假包体；分片正文按索引条目形状生成（archive.file 写错也无所谓：导出按 slug/version 自己拼）
	const bySlug = new Map<string, Array<{ version: string, sha256: string, size: number }>>();
	for (const v of versions) {
		const bytes = new Uint8Array(Buffer.from(`tgz:${v.slug}@${v.version}`));
		bodies.set(`${v.slug}-${v.version}.tgz`, bytes);
		const list = bySlug.get(v.slug) ?? [];
		list.push({ version: v.version, sha256: opts.declaredSha ?? sha256Hex(bytes), size: bytes.byteLength });
		bySlug.set(v.slug, list);
	}
	const solutions = [...bySlug.entries()].map(([slug, list]) => ({
		name: slug,
		latest: list[list.length - 1]!.version,
		versions: list.map(v => ({
			name: slug,
			version: v.version,
			archive: { file: `${slug}-${v.version}.tgz`, sha256: v.sha256, size: v.size },
		})),
	}));
	const shardBody = yamlStringify({ solutions });
	const catalogBody = `seq: ${catalogSeq}\nissued_at: 1700000000\nexpires_at: 1700604800\nshards:\n  "1": ${catalogPin}\nsolutions:\n  - name: acme-demo\n    shards: [1]\n`;
	const revBody = "seq: 0\nrevoked: []\n";

	routes.set(`${API}/index`, { body: catalogBody });
	routes.set(`${API}/index/signature`, { body: makeSig(opts.key, catalogSeq, catalogBody, "catalog") });
	routes.set(`${API}/shard/1`, { body: opts.tamperShard ? `${shardBody}# tampered` : shardBody });
	routes.set(`${API}/shard/1/signature`, { body: makeSig(opts.key, shardSeq, shardBody, "shard") });
	routes.set(`${API}/revocations`, { body: revBody });
	routes.set(`${API}/revocations/signature`, opts.revocationSigned === false
		? { status: 404, body: "" }
		: { body: makeSig(opts.key, 0, revBody, "revocation") });
	for (const v of versions) {
		const file = `${v.slug}-${v.version}.tgz`;
		const bytes = bodies.get(file)!;
		routes.set(`${API}/package/${v.slug}/${v.version}`, { body: bytes });
		routes.set(`${API}/package/${v.slug}/${v.version}/signature`, { body: "{\"alg\":\"Ed25519\",\"key_id\":\"publisher.key\"}" });
	}
	for (const [k, v] of Object.entries(opts.overrides ?? {}))
		routes.set(k, v);

	const calls: string[] = [];
	const fetchFn = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		calls.push(url);
		const route = routes.get(url);
		if (route === undefined)
			return new Response("not found", { status: 404 });
		return new Response((route.body ?? "") as BodyInit, { status: route.status ?? 200 });
	}) as unknown as typeof fetch;
	return { fetchFn, calls, bodies };
}

/** 写一份 active 索引 key 集合 JSON（给 import 回环用） */
function writeKeys(key: KeyPair): string {
	const file = path.join(cwd, "keys.json");
	fs.writeFileSync(file, JSON.stringify([{ key_id: "registry.index", public_key: key.publicKeyHex, status: "active" }]));
	return file;
}

async function exportErr(opts: Parameters<typeof registryExportCommand>[0]): Promise<RegistryExportError> {
	try {
		await registryExportCommand(opts);
	}
	catch (error) {
		expect(error).toBeInstanceOf(RegistryExportError);
		return error as RegistryExportError;
	}
	throw new Error("应当失败");
}

describe("registry export：产物结构与 import 回环", () => {
	it("scenario: 导出 → 产物逐字节等于源、目录结构就是 import 吃的形态，直接回环导入能过验签", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key });
		const out = path.join(tmpRoot, "pkg");
		// 预置旧产物：导出成功后必须整体换位，旧文件不许残留
		fs.mkdirSync(path.join(out, "registry"), { recursive: true });
		fs.writeFileSync(path.join(out, "registry", "stale.yaml"), "old\n");

		const result = await registryExportCommand({ siteUrl: SITE, out, fetchFn: reg.fetchFn, cwd });

		expect(result).toMatchObject({ catalogSeq: 3, revocationSeq: 0, shards: [1], packages: 1, verified: 3, dryRun: false });
		const target = path.join(out, "registry");
		for (const f of ["catalog.yaml", "catalog.yaml.sig", "shards/1.yaml", "shards/1.yaml.sig", "revocations.yaml", "revocations.yaml.sig", "acme-demo-1.0.0.tgz", "acme-demo-1.0.0.tgz.sig"])
			expect(fs.existsSync(path.join(target, f)), `应落盘 ${f}`).toBe(true);
		expect(fs.existsSync(path.join(target, "stale.yaml")), "旧产物应被整体换掉").toBe(false);

		// 包体逐字节等于源（离线包的价值就在这里，重渲染/改行尾都会让 sha 对不上）
		expect(new Uint8Array(fs.readFileSync(path.join(target, "acme-demo-1.0.0.tgz")))).toEqual(reg.bodies.get("acme-demo-1.0.0.tgz"));
		// source.json 带 origin：import 用它给 seq 账本分桶（而不是 `offline:<绝对路径>`）
		expect(JSON.parse(fs.readFileSync(path.join(out, "source.json"), "utf8"))).toMatchObject({ origin: SITE, catalog_seq: 3, revocation_seq: 0, shards: [1], packages: 1 });

		// 回环：import 直接吃这个目录（不给 --registry，靠 source.json 的 origin）
		const restored = path.join(tmpRoot, "restored");
		const imported = registryImportCommand({ dir: out, out: restored, keys: writeKeys(key), cwd, home: tmpHome });
		expect(imported.ok).toBe(true);
		expect(imported.verified).toBe(3);
		expect(fs.existsSync(path.join(restored, "acme-demo-1.0.0.tgz"))).toBe(true);
	});

	it("scenario: 包体 sha 与索引声明不符 → package_sha_mismatch，且不在磁盘留半份包", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key, declaredSha: "0".repeat(64) });
		const out = path.join(tmpRoot, "pkg");
		const error = await exportErr({ siteUrl: SITE, out, fetchFn: reg.fetchFn, cwd });
		expect(error.code).toBe("package_sha_mismatch");
		expect(fs.existsSync(path.join(out, "registry"))).toBe(false);
		expect(fs.existsSync(path.join(out, "source.json"))).toBe(false);
		// 隐藏暂存目录也要清掉（否则下次导出会捡到上次的残骸）
		expect(fs.readdirSync(out).filter(n => n.startsWith(".ojm-registry-export-"))).toEqual([]);
	});

	it("scenario: 分片签名代数 ≠ 总目录钉值 → index_generation_mismatch（源正在重建，抓到的是半代索引）", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key, shardSeq: 9 });
		const error = await exportErr({ siteUrl: SITE, out: path.join(tmpRoot, "pkg"), fetchFn: reg.fetchFn, cwd });
		expect(error.code).toBe("index_generation_mismatch");
	});

	it("scenario: 正文被改过（侧车对不上）→ index_sig_mismatch", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key, tamperShard: true });
		const error = await exportErr({ siteUrl: SITE, out: path.join(tmpRoot, "pkg"), fetchFn: reg.fetchFn, cwd });
		expect(error.code).toBe("index_sig_mismatch");
	});

	it("scenario: 站点没给吊销清单签过名（404）→ revocations_sig_missing，不产「看起来没吊销」的包", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key, revocationSigned: false });
		const error = await exportErr({ siteUrl: SITE, out: path.join(tmpRoot, "pkg"), fetchFn: reg.fetchFn, cwd });
		expect(error.code).toBe("revocations_sig_missing");
	});

	it("scenario: 读面不可用（503）→ export_fetch_failed，消息里带地址", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key, overrides: { [`${API}/index`]: { status: 503, body: "down" } } });
		const error = await exportErr({ siteUrl: SITE, out: path.join(tmpRoot, "pkg"), fetchFn: reg.fetchFn, cwd });
		expect(error.code).toBe("export_fetch_failed");
		expect(error.message).toContain(`${API}/index`);
		expect(error.message).toContain("503");
	});

	it("scenario: 包体缺 .sig 侧车 → export_fetch_failed（缺它安装侧无法验包）", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key, overrides: { [`${API}/package/acme-demo/1.0.0/signature`]: { status: 404, body: "" } } });
		const error = await exportErr({ siteUrl: SITE, out: path.join(tmpRoot, "pkg"), fetchFn: reg.fetchFn, cwd });
		expect(error.code).toBe("export_fetch_failed");
		expect(error.message).toContain("签名");
	});

	it("scenario: --dry-run → 索引层全验、列全计划文件，但不下载任何包体、零落盘", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key });
		const out = path.join(tmpRoot, "dry");
		const result = await registryExportCommand({ siteUrl: SITE, out, fetchFn: reg.fetchFn, cwd, dryRun: true });

		expect(result.dryRun).toBe(true);
		expect(result.written).toContain("registry/acme-demo-1.0.0.tgz");
		expect(result.written).toContain("source.json");
		expect(result.packages).toBe(1);
		// 一次包体请求都没发（dry-run 的全部价值：不消耗流量）
		expect(reg.calls.filter(u => u.includes("/package/"))).toEqual([]);
		expect(fs.existsSync(out)).toBe(false);
	});
});

describe("registry export：CLI 接线与信封", () => {
	interface RunResult { out: string[], err: string[], exitCode: number | undefined }
	async function run(argv: string[]): Promise<RunResult> {
		const out: string[] = [];
		const err: string[] = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			out.push(args.map(String).join(" "));
		});
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			err.push(args.map(String).join(" "));
		});
		const exitSpy = vi.fn();
		const exit = exitSpy as unknown as (code: number) => never;
		const cli = buildCli(cwd, "zh-CN", { exit, argv });
		try {
			cli.parse(["node", "ojm", ...argv], { run: true });
		}
		catch (error) {
			reportCliError(localizeCacError(error, "zh-CN"), exit, argv);
		}
		await vi.waitUntil(() => out.length > 0 || err.length > 0 || exitSpy.mock.calls.length > 0, { timeout: 3000, interval: 10 });
		return { out, err, exitCode: exitSpy.mock.calls[0]?.[0] as number | undefined };
	}

	it("scenario: --json 成功 → stdout 只有一行信封，代次与文件清单在 data 里", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key });
		vi.stubGlobal("fetch", reg.fetchFn);
		const out = path.join(tmpRoot, "pkg");
		const r = await run(["registry", "export", "--site-url", SITE, "--out", out, "--json"]);

		expect(r.exitCode).toBeUndefined();
		expect(r.out).toHaveLength(1);
		const env = JSON.parse(r.out[0]!) as { ok: boolean, command: string, code: string, data: { catalogSeq: number, revocationSeq: number, packages: number, written: string[] } };
		expect(env).toMatchObject({ ok: true, command: "registry export", code: "ok" });
		expect(env.data).toMatchObject({ catalogSeq: 3, revocationSeq: 0, packages: 1 });
		expect(env.data.written).toContain("registry/catalog.yaml");
	});

	it("scenario: 摘要不符 → exit 1，信封 code = package_sha_mismatch（CI 靠码分支）", async () => {
		const key = generateKeyPair();
		const reg = buildRegistry({ key, declaredSha: "0".repeat(64) });
		vi.stubGlobal("fetch", reg.fetchFn);
		const r = await run(["registry", "export", "--site-url", SITE, "--out", path.join(tmpRoot, "pkg"), "--json"]);

		expect(r.exitCode).toBe(1);
		const env = JSON.parse(r.out[0]!) as { ok: boolean, code: string, data: unknown };
		expect(env).toMatchObject({ ok: false, code: "package_sha_mismatch", data: null });
	});

	it("scenario: 缺 --site-url → 用法错误（2，不是业务失败 1）", async () => {
		const r = await run(["registry", "export", "--out", path.join(tmpRoot, "pkg")]);
		expect(r.exitCode).toBe(2);
		expect(r.err.join("\n")).toMatch(/--site-url/);
	});
});
