// BDD：`ojm registry import`（REG-R11 离线导入，运维侧）。
//
// 主场景是「源挂了还能救」——内容源（CDN/registry 读面）大概率已离线，但站点 admin 可直登这台机器跑命令。
// 所以 import 全程不触网：读 `<dir>/registry/`、复用站点已登记的 active 索引 key 验签、落盘（或 --dry-run）。
// 用例盯三件事：
//   ① 验签：catalog / 各分片 / revocations 的正文 + detached `.sig`，复用 `verifyCanonical`（与线上 REG-CS1 同口径）；
//   ② 吊销 seq 护栏：本地账本比代次，回退/缩水/同代清空都拒（`revocations_not_monotonic`），等价线上 `guardAndRecordRevocationSeq`；
//   ③ 落盘：public 用 --site 落到 `<cdn>/registry/`，private 用 --out；`--dry-run` 零写入。
// 判别码与线上 S5-3 同词汇，便于排障一眼归并。
import type { KeyPair } from "../lifecycle/keygen";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCli, localizeCacError, reportCliError } from "../cli";
import { generateKeyPair } from "../lifecycle/keygen";
import { signCanonical } from "../lifecycle/sign";
import { indexCanonical, revocationCanonical } from "../publish";
import { REGISTRY_SUBDIR, registryImportCommand, RegistryImportError } from "../registry-import";

let tmpRoot: string;
let cwd: string;
let tmpHome: string;

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-registry-import-"));
	cwd = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
	tmpHome = fs.mkdtempSync(path.join(tmpRoot, "home-"));
	vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** 造一个 detached `.sig` 六字段（alg/key_id/public_key/value/canon/seq），value 用真私钥签 canon */
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

/** 写一份 active 索引 key 集合 JSON（只含登记为 active 的 key） */
function writeKeys(key: KeyPair, name = "keys.json"): string {
	const file = path.join(cwd, name);
	fs.writeFileSync(file, JSON.stringify([{ key_id: "registry.index", public_key: key.publicKeyHex, status: "active" }]));
	return file;
}

/** 在本地信任库预置一份吊销 seq 账本（模拟「本源已见过更高代次」） */
function writeLedger(origin: string, maxSeq: number, contentSha = "deadbeef"): void {
	const dir = path.join(tmpHome, ".ojm", "registry", origin);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "revocation-seq.json"), `${JSON.stringify({ max_seq: maxSeq, content_sha: contentSha })}\n`);
}

interface BuildOpts {
	key: KeyPair
	/** 给则包含 revocations.yaml（签在该 seq）；不给则无吊销清单 */
	revocationSeq?: number
	shardNo?: number
	shardGen?: number
	catalogSeq?: number
	catalogBody?: string
	shardBody?: string
	/** 先签后改正文，制造「签名与正文不符」 */
	tamperCatalog?: boolean
}

/** 造一份合法离线包目录（<dir>/registry/...），返回 <dir> */
function buildPackage(opts: BuildOpts): string {
	const dir = fs.mkdtempSync(path.join(tmpRoot, "pkg-"));
	const reg = path.join(dir, REGISTRY_SUBDIR);
	fs.mkdirSync(path.join(reg, "shards"), { recursive: true });

	const shardNo = opts.shardNo ?? 1;
	const shardGen = opts.shardGen ?? 1;
	const catalogBody = opts.catalogBody ?? `seq: ${opts.catalogSeq ?? 1}
shards:
  "${shardNo}": ${shardGen}
`;
	const shardBody = opts.shardBody ?? "solutions: []\n";

	fs.writeFileSync(path.join(reg, "catalog.yaml"), catalogBody);
	fs.writeFileSync(path.join(reg, "catalog.yaml.sig"), makeSig(opts.key, opts.catalogSeq ?? 1, catalogBody, "catalog"));

	fs.writeFileSync(path.join(reg, "shards", `${shardNo}.yaml`), shardBody);
	fs.writeFileSync(path.join(reg, "shards", `${shardNo}.yaml.sig`), makeSig(opts.key, shardGen, shardBody, "shard"));

	if (opts.revocationSeq !== undefined) {
		const rev = `seq: ${opts.revocationSeq}
revoked: []
`;
		fs.writeFileSync(path.join(reg, "revocations.yaml"), rev);
		fs.writeFileSync(path.join(reg, "revocations.yaml.sig"), makeSig(opts.key, opts.revocationSeq, rev, "revocation"));
	}

	if (opts.tamperCatalog)
		fs.writeFileSync(path.join(reg, "catalog.yaml"), `${catalogBody}# tampered`);

	return dir;
}

/** 一个 --site 用的站点数据根，可选是否带 /cdn 挂载 */
function buildSite(withMount: boolean): string {
	const site = fs.mkdtempSync(path.join(tmpRoot, "site-"));
	const web = fs.mkdtempSync(path.join(site, "web"));
	const cfg = withMount
		? `mounts:\n  - prefix: /cdn\n    web: ${web}\n`
		: `mounts:\n  - prefix: /api\n    web: ${web}\n`;
	fs.writeFileSync(path.join(site, "config.yaml"), cfg);
	return site;
}

describe("registry import：三步校验（验签 + seq 护栏 + 落盘）", () => {
	it("scenario: 合法包 → 全验签通过，原样落盘到 --out，本地 seq 账本推进", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 5 });
		const out = fs.mkdtempSync(path.join(tmpRoot, "out-"));
		const result = registryImportCommand({ dir, out, keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome });

		expect(result.ok).toBe(true);
		expect(result.revocationSeq).toBe(5);
		expect(result.verified).toBe(3); // catalog + 1 片 + revocations
		for (const f of ["catalog.yaml", "catalog.yaml.sig", "shards/1.yaml", "shards/1.yaml.sig", "revocations.yaml", "revocations.yaml.sig"])
			expect(fs.existsSync(path.join(out, f)), `应落盘 ${f}`).toBe(true);
		// 落盘 = 包内原始正文（字节一致，未重渲染）
		expect(fs.readFileSync(path.join(out, "catalog.yaml"), "utf8")).toBe(fs.readFileSync(path.join(dir, REGISTRY_SUBDIR, "catalog.yaml"), "utf8"));
		// 本地 seq 账本推进到 5
		const ledger = JSON.parse(fs.readFileSync(path.join(tmpHome, ".ojm", "registry", "test-origin", "revocation-seq.json"), "utf8"));
		expect(ledger).toEqual({ max_seq: 5, content_sha: expect.any(String) });
	});

	it("scenario: 篡改总目录正文 → index_sig_mismatch（签名与正文不符，已拒载）", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 5, tamperCatalog: true });
		try {
			registryImportCommand({ dir, out: fs.mkdtempSync(path.join(tmpRoot, "o-")), keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome });
			throw new Error("应当失败");
		}
		catch (error) {
			expect(error).toBeInstanceOf(RegistryImportError);
			expect((error as RegistryImportError).code).toBe("index_sig_mismatch");
		}
		// 篡改后零落盘
		const out = fs.mkdtempSync(path.join(tmpRoot, "o-"));
		expect(() => registryImportCommand({ dir, out, keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome })).toThrow(RegistryImportError);
		expect(fs.existsSync(path.join(out, "catalog.yaml"))).toBe(false);
	});

	it("scenario: 签名公钥不在 active 集合 → index_key_mismatch（离线无法确认它属于 registry）", () => {
		const signer = generateKeyPair();
		const other = generateKeyPair();
		const dir = buildPackage({ key: signer, revocationSeq: 5 });
		try {
			registryImportCommand({ dir, out: fs.mkdtempSync(path.join(tmpRoot, "o-")), keys: writeKeys(other), registry: "test-origin", cwd, home: tmpHome });
			throw new Error("应当失败");
		}
		catch (error) {
			expect(error).toBeInstanceOf(RegistryImportError);
			expect((error as RegistryImportError).code).toBe("index_key_mismatch");
		}
	});

	it("scenario: 缺总目录 → offline_format（结构破损，已拒载）", () => {
		const key = generateKeyPair();
		const dir = fs.mkdtempSync(path.join(tmpRoot, "pkg-"));
		fs.mkdirSync(path.join(dir, REGISTRY_SUBDIR), { recursive: true }); // 有子目录但无 catalog.yaml
		try {
			registryImportCommand({ dir, out: fs.mkdtempSync(path.join(tmpRoot, "o-")), keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome });
			throw new Error("应当失败");
		}
		catch (error) {
			expect(error).toBeInstanceOf(RegistryImportError);
			expect((error as RegistryImportError).code).toBe("offline_format");
		}
	});

	it("scenario: --site 但无 /cdn 挂载 → static_mount_missing（registry 不新增 mounts）", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 5 });
		const site = buildSite(false); // 只有 /api 挂载
		try {
			registryImportCommand({ dir, site, keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome });
			throw new Error("应当失败");
		}
		catch (error) {
			expect(error).toBeInstanceOf(RegistryImportError);
			expect((error as RegistryImportError).code).toBe("static_mount_missing");
		}
	});

	it("scenario: 既无 --site 也无 --out → 用法错误（private 站点必须显式给 --out）", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 5 });
		expect(() => registryImportCommand({ dir, keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome }))
			.toThrowError(/--site|--out/);
	});

	it("scenario: --dry-run → 校验通过但零落盘，written 是计划而非实际写入", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 5 });
		const out = path.join(tmpRoot, "dryrun-out"); // 不预建，dry-run 也不该建
		const result = registryImportCommand({ dir, out, keys: writeKeys(key), registry: "test-origin", dryRun: true, cwd, home: tmpHome });
		expect(result.ok).toBe(true);
		expect(result.written.length).toBe(6); // 计划落 6 个文件
		expect(fs.existsSync(out)).toBe(false); // 零落盘
		// 本地 seq 账本也不推进
		expect(fs.existsSync(path.join(tmpHome, ".ojm", "registry", "test-origin", "revocation-seq.json"))).toBe(false);
	});
});

describe("registry import：吊销 seq 护栏（防黑名单回退）", () => {
	it("scenario: 本地账本已知更高代次 → revocations_not_monotonic（清单被回退，已拒载）", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 5 });
		writeLedger("test-origin", 99); // 本源已见过第 99 代
		try {
			registryImportCommand({ dir, out: fs.mkdtempSync(path.join(tmpRoot, "o-")), keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome });
			throw new Error("应当失败");
		}
		catch (error) {
			expect(error).toBeInstanceOf(RegistryImportError);
			expect((error as RegistryImportError).code).toBe("revocations_not_monotonic");
		}
	});

	it("scenario: 同代但正文指纹变了 → revocations_not_monotonic（同代清空黑名单被拦）", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 5 });
		writeLedger("test-origin", 5, "a-different-sha"); // 同代 5 但内容指纹不同
		try {
			registryImportCommand({ dir, out: fs.mkdtempSync(path.join(tmpRoot, "o-")), keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome });
			throw new Error("应当失败");
		}
		catch (error) {
			expect(error).toBeInstanceOf(RegistryImportError);
			expect((error as RegistryImportError).code).toBe("revocations_not_monotonic");
		}
	});

	it("scenario: 包不含吊销清单，但本地账本记过 → revocations_not_monotonic（等于把黑名单清空）", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key }); // 无 revocationSeq ⇒ 无 revocations.yaml
		writeLedger("test-origin", 3); // 本源已记录过第 3 代
		try {
			registryImportCommand({ dir, out: fs.mkdtempSync(path.join(tmpRoot, "o-")), keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome });
			throw new Error("应当失败");
		}
		catch (error) {
			expect(error).toBeInstanceOf(RegistryImportError);
			expect((error as RegistryImportError).code).toBe("revocations_not_monotonic");
		}
	});

	it("scenario: 本地账本为空或更低代次 → 放行并推进账本", () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 7 });
		writeLedger("test-origin", 3); // 更低代次，可前进
		const out = fs.mkdtempSync(path.join(tmpRoot, "out-"));
		const result = registryImportCommand({ dir, out, keys: writeKeys(key), registry: "test-origin", cwd, home: tmpHome });
		expect(result.ok).toBe(true);
		expect(result.revocationSeq).toBe(7);
		const ledger = JSON.parse(fs.readFileSync(path.join(tmpHome, ".ojm", "registry", "test-origin", "revocation-seq.json"), "utf8"));
		expect(ledger.max_seq).toBe(7);
	});
});

describe("registry import：CLI 接线与信封", () => {
	interface RunResult { out: string[], err: string[], exitCode: number | undefined }
	async function run(argv: string[]): Promise<RunResult> {
		const out: string[] = [];
		const err: string[] = [];
		const outSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			out.push(args.map(String).join(" "));
		});
		const errSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
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
		outSpy.mockRestore();
		errSpy.mockRestore();
		return { out, err, exitCode: exitSpy.mock.calls[0]?.[0] as number | undefined };
	}

	it("scenario: 合法包 --json 成功 → stdout 只有一行信封，written 在 data 里", async () => {
		const key = generateKeyPair();
		const dir = buildPackage({ key, revocationSeq: 5 });
		const out = fs.mkdtempSync(path.join(tmpRoot, "out-"));
		const keys = writeKeys(key);
		const r = await run(["registry", "import", dir, "--out", out, "--keys", keys, "--registry", "test-origin", "--json"]);
		expect(r.exitCode).toBeUndefined();
		expect(r.out).toHaveLength(1);
		const env = JSON.parse(r.out[0]!) as { ok: boolean, command: string, code: string, data: { verified: number, written: string[], revocationSeq: number | null, dryRun: boolean } };
		expect(env.ok).toBe(true);
		expect(env.command).toBe("registry import");
		expect(env.code).toBe("ok");
		expect(env.data.verified).toBe(3);
		expect(env.data.revocationSeq).toBe(5);
		expect(env.data.written.sort()).toEqual(["catalog.yaml", "catalog.yaml.sig", "revocations.yaml", "revocations.yaml.sig", "shards/1.yaml", "shards/1.yaml.sig"].sort());
	});

	it("scenario: 公钥不符 → exit 1，信封 code = index_key_mismatch（CI 靠码分支，不解析人话）", async () => {
		const signer = generateKeyPair();
		const other = generateKeyPair();
		const dir = buildPackage({ key: signer, revocationSeq: 5 });
		const out = fs.mkdtempSync(path.join(tmpRoot, "out-"));
		const keys = writeKeys(other);
		const r = await run(["registry", "import", dir, "--out", out, "--keys", keys, "--registry", "test-origin", "--json"]);
		expect(r.exitCode).toBe(1);
		expect(r.out).toHaveLength(1);
		const env = JSON.parse(r.out[0]!) as { ok: boolean, code: string, data: unknown };
		expect(env).toMatchObject({ ok: false, code: "index_key_mismatch", data: null });
	});

	it("scenario: 未知子命令 → 用法错误（拼错是 2，不是业务失败 1）", async () => {
		const typo = await run(["registry", "improt", "/tmp/nope", "--out", "/tmp/o"]);
		expect(typo.exitCode).toBe(2);
	});
});
