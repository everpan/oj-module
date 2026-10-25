// BDD：`ojm registry sign`（REG-R7 外置签名，CI 侧）。
//
// 这条命令是「私钥不进服务端」的另一半：registry 只渲染并导出未签索引，签名发生在离线侧。
// 用例盯三件事：
//   ① 产出的 signatures 能被**真验签**（不是「字段齐了就算过」）——规范串与 sha256 都由命令自己拼；
//   ② 三条 fail-closed 各自有码：公钥不符 / 正文被改 / 参数缺去处；
//   ③ CLI 接线：`--json` 下 stdout 只有一行信封，业务失败 exit 1 且信封 code 是稳定机器码。
import type { KeyPair } from "../lifecycle/keygen";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCli, localizeCacError, reportCliError } from "../cli";
import { generateKeyPair } from "../lifecycle/keygen";
import { fingerprintOfPublicKey, verifyCanonical } from "../lifecycle/sign";
import { indexCanonical } from "../publish";
import { registrySignCommand, RegistrySignError } from "../registry-sign";

const CATALOG = `seq: 3
issued_at: 1700000000
expires_at: 1700604800
shards:
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
      - name: demo-solution
        version: 0.1.0
`;
const SHARD2 = SHARD1.replace("0.1.0", "0.1.1");

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ojm-registry-sign-"));
	cwd = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function sha256(text: string): string {
	return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

interface ExportFile { kind: "catalog" | "shard", no: number, text: string, seq?: number }

/** 造一份 `POST /index/unsigned` 的响应体（形状与 registry 的 UNSIGNED_INDEX_SCHEMA 一致） */
function exportBody(opts: { gen: number, keys: Array<{ keyId: string, key: KeyPair }>, files?: ExportFile[] }): string {
	const files = opts.files ?? [
		{ kind: "catalog" as const, no: 0, text: CATALOG, seq: opts.gen },
		{ kind: "shard" as const, no: 1, text: SHARD1 },
		{ kind: "shard" as const, no: 2, text: SHARD2 },
	];
	const pending = files.map(f => ({ kind: f.kind, no: f.no, seq: f.seq ?? opts.gen, sha256: sha256(f.text), text: f.text, needsSignature: true, signature: null }));
	return JSON.stringify({
		gen: opts.gen,
		state: "pending",
		issuedAt: 1700000000,
		expiresAt: 1700604800,
		pending,
		files: pending,
		keys: opts.keys.map(k => ({ keyId: k.keyId, fingerprint: fingerprintOfPublicKey(k.key.publicKeyHex) })),
	});
}

function writeExport(body: string): string {
	const file = path.join(cwd, "unsigned.json");
	fs.writeFileSync(file, body);
	return file;
}

function keyFile(key: KeyPair, name = "key.pem"): string {
	const file = path.join(cwd, name);
	fs.writeFileSync(file, key.privateKeyPem, { mode: 0o600 });
	return file;
}

describe("registry sign：产出可直接回传的六字段签名", () => {
	it("scenario: 正常路径 → 每个待签文件一条签名，真验签通过，回传体落盘", () => {
		const key = generateKeyPair();
		const file = writeExport(exportBody({ gen: 3, keys: [{ keyId: "registry.index", key }] }));

		const result = registrySignCommand({
			file,
			id: "registry.index",
			key: keyFile(key),
			out: "signatures.json",
			cwd,
		});

		expect(result.gen).toBe(3);
		expect(result.signed).toBe(3);
		expect(result.keyId).toBe("registry.index");
		expect(result.fingerprint).toBe(fingerprintOfPublicKey(key.publicKeyHex));
		expect(result.signatures.map(s => `${s.kind}:${s.no}`)).toEqual(["catalog:0", "shard:1", "shard:2"]);
		for (const sig of result.signatures) {
			expect(sig).toMatchObject({ alg: "Ed25519", key_id: "registry.index", public_key: key.publicKeyHex, canon: "v2", seq: 3 });
			const text = sig.no === 0 ? CATALOG : sig.no === 1 ? SHARD1 : SHARD2;
			expect(verifyCanonical(key.publicKeyHex, indexCanonical(sig.kind, sig.seq, text), sig.value), `${sig.kind}:${sig.no} 必须真验得过`).toBe(true);
		}

		// 落盘的就是回传请求体：`{ gen, signatures }`，可直接 `-d @`
		const body = JSON.parse(fs.readFileSync(result.outPath!, "utf8")) as { gen: number, signatures: Array<Record<string, unknown>> };
		expect(body.gen).toBe(3);
		expect(body.signatures).toEqual(result.signatures);
	});

	it("scenario: 沿用片按导出给的旧代次签（seq < gen），不会自作主张签成新代次", () => {
		const key = generateKeyPair();
		const file = writeExport(exportBody({
			gen: 4,
			keys: [{ keyId: "registry.index", key }],
			files: [
				{ kind: "catalog", no: 0, text: CATALOG, seq: 4 },
				{ kind: "shard", no: 1, text: SHARD1, seq: 2 },
			],
		}));
		const result = registrySignCommand({ file, id: "registry.index", key: keyFile(key), out: "s.json", cwd });
		expect(result.signatures.map(s => `${s.kind}:${s.no}@${s.seq}`)).toEqual(["catalog:0@4", "shard:1@2"]);
		const shard = result.signatures.find(s => s.kind === "shard")!;
		expect(verifyCanonical(key.publicKeyHex, indexCanonical("shard", 2, SHARD1), shard.value)).toBe(true);
	});

	it("scenario: 这一代没有待签文件 → 幂等成功，不碰私钥（CI 重跑不该因为没 key 变红）", () => {
		const key = generateKeyPair();
		const file = writeExport(exportBody({ gen: 2, keys: [{ keyId: "registry.index", key }], files: [] }));
		const result = registrySignCommand({ file, id: "registry.index", key: path.join(cwd, "does-not-exist.pem"), out: "s.json", cwd });
		expect(result.signed).toBe(0);
		expect(result.signatures).toEqual([]);
		expect(JSON.parse(fs.readFileSync(result.outPath!, "utf8"))).toEqual({ gen: 2, signatures: [] });
	});
});

describe("registry sign：三条 fail-closed", () => {
	it("scenario: 私钥与登记的公钥不是一对 → index_key_mismatch（上传前就挡，省一次流水线）", () => {
		const registered = generateKeyPair();
		const attacker = generateKeyPair();
		const file = writeExport(exportBody({ gen: 1, keys: [{ keyId: "registry.index", key: registered }] }));
		expect(() => registrySignCommand({ file, id: "registry.index", key: keyFile(attacker), out: "s.json", cwd }))
			.toThrow(RegistrySignError);
		try {
			registrySignCommand({ file, id: "registry.index", key: keyFile(attacker), out: "s.json", cwd });
		}
		catch (error) {
			expect((error as RegistrySignError).code).toBe("index_key_mismatch");
		}
	});

	it("scenario: key_id 没在导出里登记 → index_key_mismatch", () => {
		const key = generateKeyPair();
		const file = writeExport(exportBody({ gen: 1, keys: [{ keyId: "registry.index", key }] }));
		expect(() => registrySignCommand({ file, id: "other.index", key: keyFile(key), out: "s.json", cwd }))
			.toThrowError(/没有登记 key_id「other\.index」/);
	});

	it("scenario: 正文被改过（与声明的 sha256 不符）→ index_export_tampered", () => {
		const key = generateKeyPair();
		const body = JSON.parse(exportBody({ gen: 1, keys: [{ keyId: "registry.index", key }] })) as { pending: Array<Record<string, unknown>> };
		body.pending[1]!.text = `${String(body.pending[1]!.text)}#tampered`;
		const file = writeExport(JSON.stringify(body));
		try {
			registrySignCommand({ file, id: "registry.index", key: keyFile(key), out: "s.json", cwd });
			throw new Error("应当失败");
		}
		catch (error) {
			expect(error).toBeInstanceOf(RegistrySignError);
			expect((error as RegistrySignError).code).toBe("index_export_tampered");
		}
	});

	it("scenario: 既没 --out 也没 --json → 用法错误（签名结果不能凭空消失）", () => {
		const key = generateKeyPair();
		const file = writeExport(exportBody({ gen: 1, keys: [{ keyId: "registry.index", key }] }));
		expect(() => registrySignCommand({ file, id: "registry.index", key: keyFile(key), cwd }))
			.toThrowError(/签名结果必须有去处/);
	});
});

/* ────────────────────────────── CLI 接线（真分发） ────────────────────────────── */

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

describe("registry sign：CLI 接线与信封", () => {
	it("scenario: --json 成功 → stdout 只有一行信封，signatures 在 data 里", async () => {
		const key = generateKeyPair();
		const file = writeExport(exportBody({ gen: 1, keys: [{ keyId: "registry.index", key }] }));
		const r = await run(["registry", "sign", file, "--id", "registry.index", "--key", keyFile(key), "--out", "s.json", "--json"]);
		expect(r.exitCode).toBeUndefined();
		expect(r.out).toHaveLength(1);
		const envelope = JSON.parse(r.out[0]!) as { ok: boolean, command: string, code: string, data: { gen: number, signed: number, signatures: Array<Record<string, unknown>>, out: string } };
		expect(envelope.ok).toBe(true);
		expect(envelope.command).toBe("registry sign");
		expect(envelope.code).toBe("ok");
		expect(envelope.data.gen).toBe(1);
		expect(envelope.data.signed).toBe(3);
		expect(envelope.data.signatures).toHaveLength(3);
		expect(envelope.data.out).toBe("s.json");
	});

	it("scenario: 公钥不符 → exit 1，信封 code = index_key_mismatch（CI 靠码分支，不解析人话）", async () => {
		const registered = generateKeyPair();
		const attacker = generateKeyPair();
		const file = writeExport(exportBody({ gen: 1, keys: [{ keyId: "registry.index", key: registered }] }));
		const r = await run(["registry", "sign", file, "--id", "registry.index", "--key", keyFile(attacker), "--out", "s.json", "--json"]);
		expect(r.exitCode).toBe(1);
		expect(r.out).toHaveLength(1);
		const envelope = JSON.parse(r.out[0]!) as { ok: boolean, code: string, data: unknown };
		expect(envelope).toMatchObject({ ok: false, code: "index_key_mismatch", data: null });
	});

	it("scenario: 未知子命令 / 裸 registry → 帮助或用法错误（拼错是 2，不是业务失败 1）", async () => {
		const bare = await run(["registry"]);
		expect(bare.exitCode).toBeUndefined();
		expect(bare.out.join("\n")).toContain("registry sign");
		const typo = await run(["registry", "sing"]);
		expect(typo.exitCode).toBe(2);
	});
});
