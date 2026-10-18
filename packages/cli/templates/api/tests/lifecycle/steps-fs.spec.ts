// BDD：下载/校验/解压三步（P1-6，S1-2 裁决范式）。
// download = fetch → fs.writeFile（落 .staging/<archive.file>，S1-2.3）；verify = sha256 fail-closed
// 比对（C2-29；P1 无签名阶段 CDN 与安装器同信任域，仅防传输损坏不防投毒——设计 §9 补充①）；
// extract = list→validate→extract 三步（R1 zip-slip 防护）：-tvzf listing（消费方铁律①）trim 尾部
// 空行（铁律②）后过 validateTarListing，任一恶意成员全拒则零解压零落盘。
// 命令构造为纯函数，argv 逐字断言（与平台 exec 白名单逐字对齐，S1-2 基座）；
// exec/fetch/sha256 面经 ctx 注入 stub，不真跑网络；合法夹具集成用例的 exec stub 落到真实系统 tar
// （与生产同路径：isolate 不内嵌解压，exec.run 系统 tar）。
import type { FsFace } from "../../src/_platform/_lifecycle/atomic";
import type { StateStore } from "../../src/_platform/_lifecycle/state";
import type { DownloadContext } from "../../src/_platform/_lifecycle/steps/download";
import type { ExecFace, ExtractContext } from "../../src/_platform/_lifecycle/steps/extract";
import type { VerifyContext } from "../../src/_platform/_lifecycle/steps/verify";
import { execFile as execFileCb } from "node:child_process";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTestKey, nodeVerifyEd25519, signedArchiveFor } from "../../../../src/lifecycle/__tests__/helpers";
import { archiveFileOf, download } from "../../src/_platform/_lifecycle/steps/download";
import { buildExtractCmd, buildListCmd, checkModuleManifest, extract } from "../../src/_platform/_lifecycle/steps/extract";
import { verify } from "../../src/_platform/_lifecycle/steps/verify";
import { createTrustStore } from "../../src/_platform/_lifecycle/trust";

const execFileP = promisify(execFileCb);
const g = globalThis as any;

const FILE = "demo-solution-0.1.0.tgz";
const BYTES = new TextEncoder().encode("demo-archive-bytes\n");
const shaOf = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");

/** 共享测试 key（进程内稳定；信任库播种 + 夹具签名同一把——无私钥入仓，P2-0 口径） */
const TEST_KEY = defaultTestKey();
/** 未知发布方 key（TOFU 场景；不同 key_id） */
const STRANGER = signedArchiveFor(BYTES, "demo-solution", "0.1.0", { keyPair: TEST_KEY, keyId: "stranger.pub" });
const STRANGER_KEY = { key_id: "stranger.pub", public_key: STRANGER.publicKeyHex };

function nodeFsFace(): FsFace {
	return {
		writeFile: (path, data) => fsp.writeFile(path, data),
		readFile: path => fsp.readFile(path),
		mkdir: (path, opts) => fsp.mkdir(path, opts),
		remove: (path, opts) => fsp.rm(path, opts),
		rename: (oldPath, newPath) => fsp.rename(oldPath, newPath),
		copyFile: (src, dest) => fsp.copyFile(src, dest),
		readdir: path => fsp.readdir(path),
	};
}

function stateStore(): StateStore {
	return { read: () => ({ solutions: {} }), write: async () => {} };
}

function manifest(archive: Record<string, unknown> = { file: FILE, sha256: shaOf(BYTES), size: BYTES.byteLength, signature: signedArchiveFor(BYTES, "demo-solution", "0.1.0").sig }): any {
	return { name: "demo-solution", version: "0.1.0", archive };
}

let root: string;
let staging: string;
let trustPath: string;

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-steps-fs-"));
	staging = join(root, "modules", ".staging");
	trustPath = join(root, "modules", ".solutions", "trusted-keys.yaml");
	g.fs = nodeFsFace();
	// 播种信任库（走真实 store：序列化格式零重复）。key_id 与 signedArchiveFor 缺省 keyId 一致
	await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => shaOf(hexToBytes(pk)) }).add("test.publisher", TEST_KEY.publicKeyHex);
});

/** hex → bytes（指纹面注入用） */
function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++)
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

afterEach(async () => {
	g.fs = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

/** 记录 argv 的 exec stub（默认恒成功；handler 可模拟失败） */
function recordingExec(handler?: (argv: string[]) => Promise<{ code: number, stdout: string, stderr: string }>): ExecFace & { calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		run: async (argv) => {
			calls.push([...argv]);
			return handler
				? handler(argv)
				: { code: 0, stdout: "", stderr: "" };
		},
	};
}

/** 落到真实系统 tar 的 exec stub（生产同路径） */
function realTarExec(): ExecFace & { calls: string[][] } {
	return recordingExec(async (argv) => {
		try {
			const { stdout, stderr } = await execFileP(argv[0]!, argv.slice(1));
			return { code: 0, stdout, stderr };
		}
		catch (e: any) {
			return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e) };
		}
	});
}

function dlCtx(overrides: Partial<DownloadContext> = {}): DownloadContext {
	return {
		manifest: manifest(),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		archiveUrl: `https://cdn.example.com/${FILE}`,
		staging,
		fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => BYTES.slice().buffer as ArrayBuffer }),
		...overrides,
	};
}

function vfCtx(overrides: Partial<VerifyContext> = {}): VerifyContext {
	return {
		manifest: manifest(),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		staging,
		sha256Hex: shaOf,
		trustPath,
		verifyEd25519: nodeVerifyEd25519,
		...overrides,
	};
}

function exCtx(overrides: Partial<ExtractContext> = {}): ExtractContext {
	return {
		manifest: manifest(),
		name: "demo-solution",
		version: "0.1.0",
		state: stateStore(),
		staging,
		exec: recordingExec(),
		...overrides,
	};
}

describe("命令构造纯函数（无 exec；argv 逐字断言，exec 白名单对齐 S1-2）", () => {
	it("buildListCmd 逐字：[tar, -tvzf, file]", () => {
		expect(buildListCmd("/m/.staging/demo-solution-0.1.0.tgz")).toEqual([
			"tar",
			"-tvzf",
			"/m/.staging/demo-solution-0.1.0.tgz",
		]);
	});

	it("列表命令必须 verbose 形态（铁律①：非 verbose 裸名撞 l/h 误拒，禁退化 -tzf）", () => {
		const argv = buildListCmd("x.tgz");
		expect(argv).toContain("-tvzf");
		expect(argv).not.toContain("-tzf");
	});

	it("buildExtractCmd 逐字：[tar, -xzf, file, -C, staging]（-C 限定目标目录）", () => {
		expect(buildExtractCmd("/m/.staging/x.tgz", "/m/.staging")).toEqual([
			"tar",
			"-xzf",
			"/m/.staging/x.tgz",
			"-C",
			"/m/.staging",
		]);
	});

	it("archiveFileOf：合法 Form B 提取 file（archive 段随行返回供 verify 取 sha256）", () => {
		const r = archiveFileOf(manifest());
		expect(r.ok).toBe(true);
		expect(r.ok && r.file).toBe(FILE);
	});

	it("archiveFileOf：archive 段缺失拒（C2-29）", () => {
		const r = archiveFileOf({ name: "demo-solution" });
		expect(r.ok).toBe(false);
		expect(!r.ok && r.message).toContain("C2-29");
	});

	it("archiveFileOf：路径穿越/分隔符形态拒（C2-29 安全形态，信任边界）", () => {
		for (const file of ["../evil.tgz", "a/b.tgz", ".hidden.tgz", "", ".."]) {
			const r = archiveFileOf(manifest({ file }));
			expect(r.ok).toBe(false);
			expect(!r.ok && r.message).toContain("C2-29");
		}
	});
});

describe("download（stage=downloading，S1-2.3 fetch→fs.writeFile）", () => {
	it("成功：落盘 .staging/<archive.file>，staging 不存在自动创建，字节完整", async () => {
		const r = await download(dlCtx());
		expect(r.stage).toBe("downloading");
		expect(r.ok).toBe(true);
		expect(new Uint8Array(await fsp.readFile(join(staging, FILE)))).toEqual(BYTES);
	});

	it("hTTP 非 2xx：ok=false retryable=true，message 带状态码与附录 A 引用，零落盘", async () => {
		const r = await download(dlCtx({ fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("下载失败");
		expect(r.message).toContain("404");
		expect(r.message).toContain("附录 A");
		await expect(fsp.readdir(staging)).rejects.toThrow();
	});

	it("fetch 抛错（网络异常）：ok=false retryable=true", async () => {
		const r = await download(dlCtx({ fetch: async () => {
			throw new Error("ECONNREFUSED");
		} }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("下载失败");
	});

	it("archive.file 缺失（Form A 占位无身份）：ok=false retryable=false 引 C2-29，fetch 零调用", async () => {
		let calls = 0;
		const r = await download(dlCtx({
			manifest: manifest({}),
			fetch: async () => {
				calls++;
				return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
			},
		}));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("C2-29");
		expect(calls).toBe(0);
	});
});

describe("verify（stage=verifying，C2-29 sha256 fail-closed + P2-3 六码验签）", () => {
	async function seed(): Promise<void> {
		await fsp.mkdir(staging, { recursive: true });
		await fsp.writeFile(join(staging, FILE), BYTES);
	}

	it("成功：sha256 与索引一致 + 已信任 key 验签通过 → ok=true", async () => {
		await seed();
		const r = await verify(vfCtx());
		expect(r.stage).toBe("verifying");
		expect(r.ok).toBe(true);
		expect(r.message).toContain("验签通过");
	});

	it("摘要不符：ok=false retryable=true，message 引 C2-29 且含实得摘要", async () => {
		await seed();
		const r = await verify(vfCtx({ manifest: manifest({ file: FILE, sha256: "0".repeat(64), size: 1, signature: signedArchiveFor(BYTES, "demo-solution", "0.1.0").sig }) }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("C2-29");
		expect(r.message).toContain(shaOf(BYTES));
	});

	it("archive.sha256 缺失：fail-closed 拒（retryable=false，Form A 占位不可用于安装校验）", async () => {
		await seed();
		const r = await verify(vfCtx({ manifest: manifest({ file: FILE }) }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("C2-29");
		expect(r.message).toContain("fail-closed");
	});

	it("盘上文件缺失：ok=false retryable=true（附录 A verifying：请重试下载）", async () => {
		const r = await verify(vfCtx());
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("附录 A");
	});

	it("摘要能力不可用（ctx 未注入且运行时全局无 sha256Hex）：fail-closed 不静默跳过", async () => {
		await seed();
		expect((g.crypto ?? {}).sha256Hex).toBeUndefined();
		const { sha256Hex: _drop, ...without } = vfCtx();
		const r = await verify(without as VerifyContext);
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("fail-closed");
	});

	// ── P2-3 六码（契约附录 A.2；retryable 恒 false、零解压零落盘）────────────────────

	it("六码数据表：sig_missing/sig_alg/sig_key/tampered/sig_format 逐码一例", async () => {
		await seed();
		const good = signedArchiveFor(BYTES, "demo-solution", "0.1.0").sig;

		// sig_missing：无 signature
		const noSig = await verify(vfCtx({ manifest: manifest({ file: FILE, sha256: shaOf(BYTES), size: BYTES.byteLength }) }));
		expect(noSig).toMatchObject({ ok: false, code: "sig_missing", retryable: false });

		// sig_alg：小写 ed25519 / 未知枚举
		const badAlg = await verify(vfCtx({ manifest: manifest({ ...manifest().archive, signature: { ...good, alg: "ed25519" } }) }));
		expect(badAlg).toMatchObject({ ok: false, code: "sig_alg", retryable: false });

		// sig_key：key_id 命名空间违规（裸通用名）
		const badNs = await verify(vfCtx({ manifest: manifest({ ...manifest().archive, signature: { ...good, key_id: "default" } }) }));
		expect(badNs).toMatchObject({ ok: false, code: "sig_key", retryable: false });

		// sig_format：public_key 非 64hex / value 含 -（base64url 特征字符）/ canon 非 v1
		const badKey = await verify(vfCtx({ manifest: manifest({ ...manifest().archive, signature: { ...good, public_key: "abc" } }) }));
		expect(badKey).toMatchObject({ ok: false, code: "sig_format" });
		const b64url = await verify(vfCtx({ manifest: manifest({ ...manifest().archive, signature: { ...good, value: `${good.value.slice(0, 10)}-${good.value.slice(11)}` } }) }));
		expect(b64url).toMatchObject({ ok: false, code: "sig_format" });
		const badCanon = await verify(vfCtx({ manifest: manifest({ ...manifest().archive, signature: { ...good, canon: "v2" } }) }));
		expect(badCanon).toMatchObject({ ok: false, code: "sig_format" });

		// tampered：value 首字符翻转（仍是合法标准 base64）
		const tamperedValue = (good.value[0] === "A" ? "B" : "A") + good.value.slice(1);
		const tampered = await verify(vfCtx({ manifest: manifest({ ...manifest().archive, signature: { ...good, value: tamperedValue } }) }));
		expect(tampered).toMatchObject({ ok: false, code: "tampered", retryable: false });
	});

	it("sig_key：已信任 key_id 但包内公钥与库绑定不一致（首次绑定不可改族）", async () => {
		await seed();
		// 另一把私钥冒用已信任 key_id（trusted key_id + 异公钥 = 绑定不一致）
		const { signedArchiveFor: signFor } = await import("../../../../src/lifecycle/__tests__/helpers");
		const { generateKeyPair } = await import("../../../../src/lifecycle/keygen");
		const impostor = signFor(BYTES, "demo-solution", "0.1.0", { keyPair: generateKeyPair(), keyId: "test.publisher" });
		const r = await verify(vfCtx({ manifest: manifest({ ...manifest().archive, signature: impostor.sig }) }));
		expect(r).toMatchObject({ ok: false, code: "sig_key" });
		expect(r.message).toContain("首次绑定不可改");
	});

	it("unknown_key → needsTrust：staging 不清场语义由编排层保证，此处返回待确认 key 信息", async () => {
		await seed();
		const r = await verify(vfCtx({ manifest: manifest({ ...manifest().archive, signature: STRANGER.sig }) }));
		expect(r).toMatchObject({ ok: false, code: "unknown_key", needsTrust: true, retryable: false });
		expect(r.trust).toMatchObject({ key_id: "stranger.pub", public_key: STRANGER.publicKeyHex });
		expect(r.trust?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		// 零解压：staging 仍只有原始 tgz（本步不触 extract）
		expect(await fsp.readdir(staging)).toEqual([FILE]);
	});

	it("双层语义分码：验签面抛错 → sig_format（上游 verifyEd25519: 前缀）；返回 false → tampered", async () => {
		await seed();
		const throwing = await verify(vfCtx({
			verifyEd25519: () => { throw new Error("verifyEd25519: signature not base64"); },
		}));
		expect(throwing).toMatchObject({ ok: false, code: "sig_format" });
		expect(throwing.message).toContain("verifyEd25519: ");
		const falseFace = await verify(vfCtx({ verifyEd25519: () => false }));
		expect(falseFace).toMatchObject({ ok: false, code: "tampered" });
	});

	it("原语/信任库不可得：验签面缺失或 trustPath 缺失 → fail-closed 拒装（无静默跳过）", async () => {
		await seed();
		const { verifyEd25519: _drop, ...withoutFace } = vfCtx();
		expect((g.crypto ?? {}).verifyEd25519).toBeUndefined();
		const r1 = await verify(withoutFace as VerifyContext);
		expect(r1).toMatchObject({ ok: false, code: "sig_format" });
		expect(r1.message).toContain("fail-closed");
		const { trustPath: _drop2, ...withoutTrust } = vfCtx();
		const r2 = await verify(withoutTrust as VerifyContext);
		expect(r2).toMatchObject({ ok: false, code: "sig_missing" });
		expect(r2.message).toContain("信任库");
	});

	it("tOFU 全链（store 层）：未知 key 确认入信任库后同包重试即过", async () => {
		await seed();
		const manifestUnknown = manifest({ ...manifest().archive, signature: STRANGER.sig });
		expect((await verify(vfCtx({ manifest: manifestUnknown }))).needsTrust).toBe(true);
		// 确认（端点同路径：store.add）
		await createTrustStore(trustPath, { audit: () => {} }).add(STRANGER_KEY.key_id, STRANGER_KEY.public_key);
		const r2 = await verify(vfCtx({ manifest: manifestUnknown }));
		expect(r2.ok).toBe(true);
		expect(r2.message).toContain("stranger.pub");
	});
});

describe("extract（stage=extracting，R1 list→validate→extract 三步）", () => {
	it("合法夹具集成（真实系统 tar）：§2.9 单根包解压后归平为扁平 staging，两次 exec argv 逐字对齐命令构造", async () => {
		const pkg = join(root, "pkg", "demo-solution-0.1.0");
		await fsp.mkdir(join(pkg, "src"), { recursive: true });
		await fsp.writeFile(join(pkg, "manifest.yaml"), "name: demo-solution\n");
		await fsp.writeFile(join(pkg, "src", "entry.js"), "export default {};\n");
		await fsp.mkdir(staging, { recursive: true });
		const tgz = join(staging, FILE);
		await execFileP("tar", ["-czf", tgz, "-C", join(root, "pkg"), "demo-solution-0.1.0"]);

		const exec = realTarExec();
		const r = await extract(exCtx({ exec }));
		expect(r.stage).toBe("extracting");
		expect(r.ok).toBe(true);
		// 单根归平（附录 B-10）：包根内容上提一层，安装器全链消费扁平 staging
		expect(await fsp.readFile(join(staging, "manifest.yaml"), "utf8")).toBe("name: demo-solution\n");
		expect(await fsp.readFile(join(staging, "src", "entry.js"), "utf8")).toBe("export default {};\n");
		expect(await fsp.readdir(staging)).toEqual(["demo-solution-0.1.0.tgz", "manifest.yaml", "src"].sort());
		expect(exec.calls[0]).toEqual(buildListCmd(tgz));
		expect(exec.calls[1]).toEqual(buildExtractCmd(tgz, staging));
	});

	it("flat 布局包（manifest.yaml 在包根）：归平为空操作，layout 原样", async () => {
		const flat = join(root, "flat-pkg");
		await fsp.mkdir(flat, { recursive: true });
		await fsp.writeFile(join(flat, "manifest.yaml"), "name: demo-solution\n");
		await fsp.mkdir(staging, { recursive: true });
		const tgz = join(staging, FILE);
		await execFileP("tar", ["-czf", tgz, "-C", flat, "manifest.yaml"]);

		const exec = realTarExec();
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(true);
		expect(await fsp.readFile(join(staging, "manifest.yaml"), "utf8")).toBe("name: demo-solution\n");
		expect(await fsp.readdir(staging)).toEqual(["demo-solution-0.1.0.tgz", "manifest.yaml"].sort());
	});

	it("恶意 listing（symlink + `..` 成员）：validate 段全拒，零解压零落盘（exec 仅 1 次列表调用）", async () => {
		const exec = recordingExec(async () => ({
			code: 0,
			stdout: [
				"-rw-r--r--  0 ever staff    7 10 17 12:00 demo-solution-0.1.0/manifest.yaml",
				"lrwxr-xr-x  0 ever staff    0 10 17 12:00 demo-solution-0.1.0/link -> /etc/passwd",
				"-rw-r--r--  0 ever staff    7 10 17 12:00 ../evil",
			].join("\n"),
			stderr: "",
		}));
		await fsp.mkdir(staging, { recursive: true });
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("R1");
		expect(r.message).toContain("零解压");
		expect(r.message).toContain("demo-solution-0.1.0/link");
		expect(exec.calls.length).toBe(1);
		expect(exec.calls[0]).toEqual(buildListCmd(join(staging, FILE)));
		expect(await fsp.readdir(staging)).toEqual([]);
	});

	it("列表命令失败（exit≠0）：ok=false retryable=true，stderr 入 message", async () => {
		const exec = recordingExec(async () => ({ code: 2, stdout: "", stderr: "tar: unrecognized format" }));
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("tar: unrecognized format");
		expect(exec.calls.length).toBe(1);
	});

	it("解压命令失败（合法 listing 后 exit≠0）：ok=false retryable=true", async () => {
		const clean = "-rw-r--r--  0 ever staff    7 10 17 12:00 demo-solution-0.1.0/manifest.yaml";
		const exec = recordingExec(async argv => argv[1] === "-xzf"
			? { code: 1, stdout: "", stderr: "tar: cannot extract" }
			: { code: 0, stdout: clean, stderr: "" });
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(true);
		expect(r.message).toContain("解压失败");
		expect(exec.calls.length).toBe(2);
	});

	it("铁律②：尾部多空行的 listing 先 trim 再校验，合法成员照常放行", async () => {
		const exec = recordingExec(async () => ({
			code: 0,
			stdout: "-rw-r--r--  0 ever staff    7 10 17 12:00 demo-solution-0.1.0/manifest.yaml\n\n\n",
			stderr: "",
		}));
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(true);
		expect(exec.calls.length).toBe(2);
	});

	it("空 listing：退化行=空成员名，fail-closed 拒绝", async () => {
		const exec = recordingExec(async () => ({ code: 0, stdout: "", stderr: "" }));
		const r = await extract(exCtx({ exec }));
		expect(r.ok).toBe(false);
		expect(r.message).toContain("R1");
		expect(exec.calls.length).toBe(1);
	});
});

// B-11/C2-31 安装期复核：包内 api/<name>-<version>/manifest.yaml 是 oj 原生清单（desc 必填，
// serve 装配 parse_one 消费面），与 C2 Form A 的 summary 字段由构建期映射（ojm build --bundle
// 写入并核对）；安装期只验不写——写等于掩盖上游不一致（映射被篡改的包必须拒装）。
// 纯函数与 packages/cli 侧 bundle.ts checkModuleManifest 双端 DRY 于夹具（preflight 同纪律）。
describe("checkModuleManifest（C2-31 安装期复核纯函数：C2 manifest ↔ 包内 oj 原生清单）", () => {
	const c2 = { name: "demo-solution", version: "0.1.0", summary: "演示方案 Demo — émoji 🎉" };
	const native = { name: "demo-solution", desc: "演示方案 Demo — émoji 🎉", version: "0.1.0" };

	it("合法：desc === summary（多字节逐字相等）、name/version 三方一致、七键之内 → ok", () => {
		expect(checkModuleManifest(c2, native, "demo-solution", "0.1.0")).toEqual({ ok: true });
	});

	it("summary 缺省（C2 侧无映射真源）→ 拒", () => {
		const r = checkModuleManifest({ name: "demo-solution", version: "0.1.0" }, native, "demo-solution", "0.1.0");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.message).toContain("summary");
	});

	it("desc 缺失 → 拒（oj Manifest 必填字段，serve 装配即炸）", () => {
		const r = checkModuleManifest(c2, { name: "demo-solution", version: "0.1.0" }, "demo-solution", "0.1.0");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.message).toContain("desc");
	});

	it("desc 为空白串 → 拒（oj 原生 desc 语义：非空描述）", () => {
		const r = checkModuleManifest(c2, { ...native, desc: "   " }, "demo-solution", "0.1.0");
		expect(r.ok).toBe(false);
	});

	it("desc !== summary → 拒（构建期映射被篡改/上游不一致）", () => {
		const r = checkModuleManifest(c2, { ...native, desc: "另一个描述" }, "demo-solution", "0.1.0");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.message).toContain("desc");
	});

	it("name 或 version 与包身份不一致 → 拒", () => {
		expect(checkModuleManifest(c2, { ...native, name: "other" }, "demo-solution", "0.1.0").ok).toBe(false);
		expect(checkModuleManifest(c2, { ...native, version: "0.2.0" }, "demo-solution", "0.1.0").ok).toBe(false);
	});

	it("白名单外键（七键 name/desc/version/config/db/tables/deps 之外）→ 拒（OJ-X 红线）", () => {
		const r = checkModuleManifest(c2, { ...native, evil: "x" }, "demo-solution", "0.1.0");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.message).toContain("evil");
	});

	it("七键之内可选键（config/db/tables/deps）放行", () => {
		const rich = { ...native, tables: ["note"], deps: { _platform: ">=0.1.0" } };
		expect(checkModuleManifest(c2, rich, "demo-solution", "0.1.0")).toEqual({ ok: true });
	});

	it("native 非键值对象 → 拒（fail-closed 不猜）", () => {
		for (const bad of [null, "text", 42, ["demo-solution"]]) {
			expect(checkModuleManifest(c2, bad, "demo-solution", "0.1.0").ok).toBe(false);
		}
	});
});

describe("extract C2-31 安装期复核（B-11：api 段声明与包内原生清单互相钉住）", () => {
	beforeEach(() => {
		g.yaml = { parse: async (t: string) => JSON.parse(t) };
	});

	afterEach(() => {
		g.yaml = undefined;
	});

	/** 组装 §2.9 单根包并 tar 真打包（含 api 模块目录：原生清单 + routes.js + 迁移 SQL） */
	async function seedBundle(opts: { withApi?: boolean, nativeManifest?: unknown } = {}): Promise<string> {
		const pkg = join(root, "pkg", "demo-solution-0.1.0");
		if (opts.withApi !== false) {
			const apiDir = join(pkg, "api", "demo-solution-0.1.0", "migrations");
			await fsp.mkdir(apiDir, { recursive: true });
			const nm = opts.nativeManifest ?? { name: "demo-solution", desc: "演示方案 Demo", version: "0.1.0" };
			await fsp.writeFile(join(pkg, "api", "demo-solution-0.1.0", "manifest.yaml"), JSON.stringify(nm));
			await fsp.writeFile(join(pkg, "api", "demo-solution-0.1.0", "routes.js"), "export {};\n");
			await fsp.writeFile(join(pkg, "api", "demo-solution-0.1.0", "migrations", "0001__init.sql"), "CREATE TABLE note (id INTEGER PRIMARY KEY);\n");
		}
		await fsp.mkdir(join(pkg, "web", "modules", "demo-solution", "0.1.0"), { recursive: true });
		await fsp.writeFile(join(pkg, "manifest.yaml"), JSON.stringify({ name: "demo-solution", version: "0.1.0", summary: "演示方案 Demo", api: { prefix: "/api/demo-solution" } }));
		await fsp.writeFile(join(pkg, "web", "modules", "demo-solution", "0.1.0", "entry.js"), "export {};\n");
		await fsp.mkdir(staging, { recursive: true });
		const tgz = join(staging, FILE);
		await execFileP("tar", ["-czf", tgz, "-C", join(root, "pkg"), "demo-solution-0.1.0"]);
		return tgz;
	}

	function c2Manifest(): any {
		return { name: "demo-solution", version: "0.1.0", summary: "演示方案 Demo", archive: { file: FILE, sha256: shaOf(BYTES), size: BYTES.byteLength }, api: { prefix: "/api/demo-solution" } };
	}

	it("api 段声明 + 包内原生清单合法（desc === summary）→ extract ok", async () => {
		await seedBundle();
		const r = await extract(exCtx({ manifest: c2Manifest(), exec: realTarExec() }));
		expect(r.ok).toBe(true);
		// 单根归平后 api 模块目录在 staging 根（migrate svc 物化与 lockCommit rename 的消费面）
		await fsp.access(join(staging, "api", "demo-solution-0.1.0", "routes.js"));
	});

	it("manifest 声明 api 段而包内 api/<name>-<version>/ 缺失 → C2-31 拒（retryable=false）", async () => {
		await seedBundle({ withApi: false });
		const r = await extract(exCtx({ manifest: c2Manifest(), exec: realTarExec() }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("C2-31");
	});

	it("包内原生清单 desc !== summary → C2-31 拒（映射被篡改）", async () => {
		await seedBundle({ nativeManifest: { name: "demo-solution", desc: "另一个描述", version: "0.1.0" } });
		const r = await extract(exCtx({ manifest: c2Manifest(), exec: realTarExec() }));
		expect(r.ok).toBe(false);
		expect(r.retryable).toBe(false);
		expect(r.message).toContain("C2-31");
	});
});
