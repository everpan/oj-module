// BDD：CDN 上传端点（Phase A v4 §二：签名推送 + pair 约束 + DB 目录真源写行）。
// POST /api/_platform/cdn/upload?name=<file> —— 发布方（ojm market publish 远端模式）经
// X-OJM-Key-Id / X-OJM-Signature 签名推送发布 .tgz + .sig 旁车；pair 约束（sig 先 tgz 后），
// 处理顺序钉死：查库比对 → staging 解包抽 manifest（体积闸）→ 原子落盘 → db.tx 写行。
// 鉴权序：先验头（403 fail-fast，不消费 body）→ 再消费 body（413）→ 服务端重算 sha256
// 重构 canonical 验签（换字节/跨站重放 → 401）。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（market-api.spec 同约定） */
import type { FsFace } from "../../src/app/api/_platform/_lifecycle/atomic";
import type { ExecFace } from "../../src/app/api/_platform/_lifecycle/steps/extract";
import type { CdnUploadEnv } from "../../src/app/api/_platform/cdn/api";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTestKey, nodeVerifyEd25519, signedArchiveFor } from "../../../src/lifecycle/__tests__/helpers";
import { generateKeyPair } from "../../../src/lifecycle/keygen";
import { signCanonical } from "../../../src/lifecycle/sign";
import { createTrustStore } from "../../src/app/api/_platform/_lifecycle/trust";
import { installDb } from "../fixture";

const g = globalThis as any;

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++)
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/** 上传载荷字节（内容任意——exec 桩按 argv 形状响应，真 sha256 由客户端先算好签名） */
const ARCHIVE = new TextEncoder().encode("demo-archive-bytes\n");
const SHA256 = createHash("sha256").update(ARCHIVE).digest("hex");
/** 共享测试 key（播种进信任库；无私钥入仓） */
const TEST_KEY = defaultTestKey();
const KEY_ID = "test.publisher";
/** 本站点 registry 身份（canonical 首段） */
const REGISTRY = "test.registry";
const FILE = "demo-solution-0.1.0.tgz";
const SIG_FILE = `${FILE}.sig`;
const SIG_BYTES = new TextEncoder().encode(JSON.stringify(signedArchiveFor(ARCHIVE, "demo-solution", "0.1.0", { keyPair: TEST_KEY }).sig));

/** 上传签名面：canonical `cdn-upload:<registry_id>:<name>:<sha256(bytes)>`（与端点重算口径逐字一致） */
function uploadSignature(name: string, bytes: Uint8Array, opts: { registryId?: string, key?: typeof TEST_KEY } = {}): Record<string, string> {
	const key = opts.key ?? TEST_KEY;
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const canonical = `cdn-upload:${opts.registryId ?? REGISTRY}:${name}:${sha256}`;
	return { "x-ojm-key-id": KEY_ID, "x-ojm-signature": signCanonical(key.privateKeyPem, canonical) };
}

/** 包内嵌 manifest（tar 桩解包写出；name/version 与文件名逐字一致） */
const MANIFEST = {
	name: "demo-solution",
	version: "0.1.0",
	summary: "演示方案",
	description: "演示方案描述",
	author: "oj-module",
	license: "MIT",
	web: { entry: "modules/demo-solution/0.1.0/entry.js" },
};

let root: string;
let cdnDir: string;
let staging: string;
let trustPath: string;
let dbo: any;

let last: { status: number, msg?: string, data?: unknown } | null = null;

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

/** tar 桩：-tvzf 回 verbose 清单，-xzf 写出 manifest 夹具（dest = argv[4]） */
function uploadExec(overrides: { listing?: string, manifest?: unknown } = {}): ExecFace {
	return {
		run: async (argv) => {
			if (argv[0] === "tar" && argv[1] === "-tvzf")
				return { code: 0, stdout: overrides.listing ?? "-rw-r--r-- 0/0 200 2026-01-01 00:00 manifest.yaml\n", stderr: "" };
			if (argv[0] === "tar" && argv[1] === "-xzf") {
				await fsp.mkdir(argv[4]!, { recursive: true });
				await fsp.writeFile(join(argv[4]!, "manifest.yaml"), JSON.stringify(overrides.manifest ?? MANIFEST));
				return { code: 0, stdout: "", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		},
	};
}

function makeEnv(overrides: Partial<CdnUploadEnv> = {}): CdnUploadEnv {
	return {
		cdnDir,
		staging,
		trustPath,
		registryId: REGISTRY,
		configPath: join(root, "config.yaml"),
		exec: uploadExec(),
		sha256Hex: d => createHash("sha256").update(d).digest("hex"),
		verifyEd25519: nodeVerifyEd25519,
		...overrides,
	};
}

/** 组装一次请求：name=查询参数 + 头 + 单文件字节（oj http 面：files 元数据 + http.file(i) 取字节） */
function httpFor(name: string, bytes: Uint8Array, headers: Record<string, string> = uploadSignature(name, bytes)) {
	return { query: { name }, headers, files: [{}], file: async () => bytes };
}

/** 先推 sig 旁车（pair 前置），返回可继续推 tgz 的请求环境 */
async function pushSig(api: any, opts: { key?: typeof TEST_KEY, registryId?: string, sigBytes?: Uint8Array } = {}) {
	const sigBytes = opts.sigBytes ?? SIG_BYTES;
	g.http = httpFor(SIG_FILE, sigBytes, uploadSignature(SIG_FILE, sigBytes, { key: opts.key, registryId: opts.registryId }));
	await api.upload.post();
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-cdn-upload-"));
	cdnDir = join(root, "cdn");
	staging = join(root, "modules", ".staging-upload");
	trustPath = join(root, ".solutions", "trusted-keys.yaml");
	await fsp.mkdir(cdnDir, { recursive: true });
	await fsp.writeFile(join(root, "config.yaml"), "vars:\n  other: 1\n");
	g.fs = nodeFsFace();
	dbo = installDb();
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
	// 播种信任库（上传签名与包级签名同一把 TEST_KEY）
	await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).add(KEY_ID, TEST_KEY.publicKeyHex);
	g.yaml = { parse: async (t: string) => JSON.parse(t) };
	g.http = {};
	g.json = {
		ok: (data: unknown) => {
			last = { status: 200, data };
		},
		fail: (status: number, msg: string) => {
			last = { status, msg };
		},
	};
	last = null;
});

afterEach(async () => {
	g.fs = undefined;
	g.http = undefined;
	g.json = undefined;
	g.yaml = undefined;
	g.db = undefined;
	await fsp.rm(root, { recursive: true, force: true });
});

describe("POST upload（签名鉴权：canonical cdn-upload:<registry_id>:<name>:<sha256>，服务端重算）", () => {
	it("信任 key + 有效签名 + pair 齐 → 200：tgz 落 cdn/、market_release 行落库（published_at_source='upload'）", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		await pushSig(api);
		expect(last?.status).toBe(200);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		const data = last?.data as Record<string, unknown>;
		expect(data).toMatchObject({ name: "demo-solution", version: "0.1.0", sha256: SHA256, size: ARCHIVE.byteLength, key_id: KEY_ID });
		// 字节落位
		const onDisk = createHash("sha256").update(await fsp.readFile(join(cdnDir, FILE))).digest("hex");
		expect(onDisk).toBe(SHA256);
		// 行落库：product+version 唯一、签名三字段与包内嵌 manifest 抽取物入库
		const rows = dbo.prepare("SELECT * FROM market_release WHERE product=? AND version=?").all("demo-solution", "0.1.0");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			key_id: KEY_ID,
			sha256: SHA256,
			size: ARCHIVE.byteLength,
			published_at_source: "upload",
			yanked: 0,
			sig_alg: "Ed25519",
			sig_public_key: TEST_KEY.publicKeyHex,
		});
		expect(String(rows[0].sig_value)).toMatch(/^[A-Z0-9+/]+={0,2}$/i);
		expect(JSON.parse(rows[0].manifest)).toMatchObject({ name: "demo-solution", version: "0.1.0" });
	});

	it("未信任 key → 403（附 trust add 指引）；fail-fast 不消费 body", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		const foreign = generateKeyPair();
		g.http = httpFor(FILE, ARCHIVE, { ...uploadSignature(FILE, ARCHIVE, { key: foreign }), "x-ojm-key-id": "foreign.publisher" });
		const consume = vi.fn(async () => ARCHIVE);
		g.http.file = consume;
		await api.upload.post();
		expect(last?.status).toBe(403);
		expect(String(last?.msg)).toContain("trust");
		expect(consume).not.toHaveBeenCalled();
	});

	it("换字节 → 401：服务端从实收字节重算 sha256 重构 canonical，声明值与实收不符即拒签", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		// 对「别的字节」签名，却上传 ARCHIVE——重算后 canonical 不匹配
		const other = new TextEncoder().encode("other-bytes\n");
		g.http = httpFor(FILE, ARCHIVE, uploadSignature(FILE, other));
		await api.upload.post();
		expect(last?.status).toBe(401);
		// 零痕迹：cdn/ 无文件、库无行
		expect(await fsp.readdir(cdnDir)).toEqual([]);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(0);
	});

	it("registry_id 不符（跨站重放：对别的站点身份签的 canonical）→ 401", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		g.http = httpFor(FILE, ARCHIVE, uploadSignature(FILE, ARCHIVE, { registryId: "other.registry" }));
		await api.upload.post();
		expect(last?.status).toBe(401);
	});

	it("缺 X-OJM 头 → 401（签名制不经账号口令，企微用户无障碍；无角色检查）", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		g.http = httpFor(FILE, ARCHIVE, {});
		await api.upload.post();
		expect(last?.status).toBe(401);
	});

	it("registry_id 未配置（env 与 vars.registry_id 俱缺）→ 503 指向设置项", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv({ registryId: undefined }));
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(503);
		expect(String(last?.msg)).toContain("registry_id");
	});
});

describe("POST upload（name 所有权：product → 首发 key_id 绑定不可改，v4 §一）", () => {
	it("非首发 key 推既有 name 新版本 → 409；首发 key 推新版本 → 200", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		// 首发：demo-solution@0.1.0（key = test.publisher）
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		// 另一位受信发布方（入信任库；所有权仍绑定首发 key）
		const other = generateKeyPair();
		await createTrustStore(trustPath, { audit: () => {} }).add("other.publisher", other.publicKeyHex);
		const file2 = "demo-solution-0.2.0.tgz";
		const sig2 = new TextEncoder().encode(JSON.stringify(signedArchiveFor(ARCHIVE, "demo-solution", "0.2.0", { keyPair: other, keyId: "other.publisher" }).sig));
		g.http = httpFor(`${file2}.sig`, sig2, { ...uploadSignature(`${file2}.sig`, sig2, { key: other }), "x-ojm-key-id": "other.publisher" });
		await api.upload.post();
		expect(last?.status).toBe(200); // sig 旁车本身可替任意 name 预置（tgz 闸在写行处）
		g.http = httpFor(file2, ARCHIVE, { ...uploadSignature(file2, ARCHIVE, { key: other }), "x-ojm-key-id": "other.publisher" });
		await api.upload.post();
		expect(last?.status).toBe(409);
		expect(String(last?.msg)).toContain("所有权");
		// 首发 key 推新版本 → 200（manifest 版本随文件名）
		const sig3 = new TextEncoder().encode(JSON.stringify(signedArchiveFor(ARCHIVE, "demo-solution", "0.2.0", { keyPair: TEST_KEY }).sig));
		await fsp.writeFile(join(cdnDir, `${file2}.sig`), sig3);
		const api2 = createCdnUploadApi(makeEnv({ exec: uploadExec({ manifest: { ...MANIFEST, version: "0.2.0" } }) }));
		g.http = httpFor(file2, ARCHIVE);
		await api2.upload.post();
		expect(last?.status).toBe(200);
	});

	it("遗留行 key_id 为 NULL（syncReleases 时代）不建立所有权：首个上传采用并绑定", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		dbo.prepare("INSERT INTO market_release (product,version,key_id,sha256,size,published_at,published_at_source,yanked,first_seen_at) VALUES (?,?,NULL,NULL,NULL,?,'index',0,?)")
			.run("demo-solution", "0.0.9", 1000, 1000);
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		const row = dbo.prepare("SELECT key_id FROM market_release WHERE product=? AND version=?").get("demo-solution", "0.1.0");
		expect(row.key_id).toBe(KEY_ID);
	});
});

describe("POST upload（文件名白名单 + 体积 + 限速）", () => {
	it.each([
		["../evil-0.1.0.tgz", "路径逃逸"],
		["/abs/evil-0.1.0.tgz", "绝对路径"],
		["back\\slash-0.1.0.tgz", "反斜杠"],
		["demo-solution-0.1.0.zip", "扩展名"],
		["demo-solution.tgz", "缺版本段"],
		["Demo-0.1.0.tgz", "大写开头（C2-01 小写锚）"],
	])("非法文件名 %s → 400（%s）", async (name) => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		g.http = httpFor(name, ARCHIVE, uploadSignature(name, ARCHIVE));
		await api.upload.post();
		expect(last?.status).toBe(400);
		expect(await fsp.readdir(cdnDir)).toEqual([]);
	});

	it("name 缺失 → 400", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		g.http = { query: {}, headers: uploadSignature(FILE, ARCHIVE), files: [{}], file: async () => ARCHIVE };
		await api.upload.post();
		expect(last?.status).toBe(400);
	});

	it("大文件 → 413（MAX_PACKAGE_BYTES 闸）", async () => {
		const { createCdnUploadApi, MAX_UPLOAD_BYTES } = await import("../../src/app/api/_platform/cdn/api");
		const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
		const api = createCdnUploadApi(makeEnv());
		g.http = httpFor(FILE, big);
		await api.upload.post();
		expect(last?.status).toBe(413);
		expect(await fsp.readdir(cdnDir)).toEqual([]);
	});

	it("限速按 key_id 生效：超限 → 429", async () => {
		const { createCdnUploadApi, UPLOAD_RATE_LIMIT } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		for (let i = 0; i < UPLOAD_RATE_LIMIT.limit; i++) {
			g.http = httpFor(SIG_FILE, SIG_BYTES);
			await api.upload.post();
			expect(last?.status).toBe(200);
		}
		g.http = httpFor(SIG_FILE, SIG_BYTES);
		await api.upload.post();
		expect(last?.status).toBe(429);
	});
});

describe("POST upload（pair 约束：sig 先 tgz 后）", () => {
	it("tgz 无 sig 旁车 → 409", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(409);
		expect(String(last?.msg)).toContain("sig");
		expect(await fsp.readdir(cdnDir)).toEqual([]);
	});

	it.each([
		["缺 alg", { key_id: KEY_ID, public_key: TEST_KEY.publicKeyHex, value: "AA==", canon: "v2" }],
		["alg 非 Ed25519", { alg: "RSA", key_id: KEY_ID, public_key: TEST_KEY.publicKeyHex, value: "AA==", canon: "v2" }],
		["canon 非 v2", { alg: "Ed25519", key_id: KEY_ID, public_key: TEST_KEY.publicKeyHex, value: "AA==", canon: "v1" }],
		["public_key 非 64hex", { alg: "Ed25519", key_id: KEY_ID, public_key: "zz", value: "AA==", canon: "v2" }],
		["value 非 base64", { alg: "Ed25519", key_id: KEY_ID, public_key: TEST_KEY.publicKeyHex, value: "!!not-b64!!", canon: "v2" }],
		["缺 key_id", { alg: "Ed25519", public_key: TEST_KEY.publicKeyHex, value: "AA==", canon: "v2" }],
	])("sig 五字段非法（%s）→ 400", async (_label, sig) => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		const bad = new TextEncoder().encode(JSON.stringify(sig));
		g.http = httpFor(SIG_FILE, bad, uploadSignature(SIG_FILE, bad));
		await api.upload.post();
		expect(last?.status).toBe(400);
		expect(await fsp.readdir(cdnDir)).toEqual([]);
	});

	it("同字节重传 → 200 幂等（行数不变、published_at 不改写）", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		const first = dbo.prepare("SELECT published_at FROM market_release WHERE product=? AND version=?").get("demo-solution", "0.1.0");
		// 重传（pair 亦齐，sig 文件已在）
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(1);
		const second = dbo.prepare("SELECT published_at FROM market_release WHERE product=? AND version=?").get("demo-solution", "0.1.0");
		expect(second.published_at).toBe(first.published_at);
	});

	it("幂等自愈：行在而 tgz 文件丢失 → 同字节重传补齐文件（含 sig 缺失一并补）", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		await fsp.rm(join(cdnDir, FILE));
		await fsp.rm(join(cdnDir, SIG_FILE));
		expect(await fsp.readdir(cdnDir)).toEqual([]);
		// 先补 sig（pair 前置），再补 tgz
		g.http = httpFor(SIG_FILE, SIG_BYTES);
		await api.upload.post();
		expect(last?.status).toBe(200);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		expect(createHash("sha256").update(await fsp.readFile(join(cdnDir, FILE))).digest("hex")).toBe(SHA256);
		expect(JSON.parse(await fsp.readFile(join(cdnDir, SIG_FILE), "utf8"))).toMatchObject({ alg: "Ed25519" });
	});

	it("异字节同版本 → 409 不碰盘（防「文件先被换、DB 后拒」的字节持久损坏）", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		const tampered = new TextEncoder().encode("tampered-bytes\n");
		g.http = httpFor(FILE, tampered, uploadSignature(FILE, tampered));
		await api.upload.post();
		expect(last?.status).toBe(409);
		// 盘上仍是原字节
		expect(createHash("sha256").update(await fsp.readFile(join(cdnDir, FILE))).digest("hex")).toBe(SHA256);
	});
});

describe("POST upload（manifest 抽取 + 入库钳制）", () => {
	it("体积闸：tar 清单单条目超大（解压炸弹）→ 413 零落盘", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const bombListing = "-rw-r--r-- 0/0 300000000 2026-01-01 00:00 big.bin\n";
		const api = createCdnUploadApi(makeEnv({ exec: uploadExec({ listing: bombListing }) }));
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(413);
		// 零落盘 = tgz 不落（sig 旁车是前置合法推送）+ 库无行
		expect(await fsp.readdir(cdnDir)).not.toContain(FILE);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(0);
	});

	it("manifest.name/version 与上传文件名不符 → 400 零落盘", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv({ exec: uploadExec({ manifest: { ...MANIFEST, version: "9.9.9" } }) }));
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(400);
		expect(String(last?.msg)).toContain("9.9.9");
		expect(await fsp.readdir(cdnDir)).not.toContain(FILE);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(0);
	});

	it("坏 manifest（解析失败）→ 400 零落盘", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const badExec: ExecFace = {
			run: async (argv) => {
				if (argv[0] === "tar" && argv[1] === "-tvzf")
					return { code: 0, stdout: "-rw-r--r-- 0/0 200 2026-01-01 00:00 manifest.yaml\n", stderr: "" };
				if (argv[0] === "tar" && argv[1] === "-xzf") {
					await fsp.mkdir(argv[4]!, { recursive: true });
					await fsp.writeFile(join(argv[4]!, "manifest.yaml"), "{not-json");
					return { code: 0, stdout: "", stderr: "" };
				}
				return { code: 0, stdout: "", stderr: "" };
			},
		};
		const api = createCdnUploadApi(makeEnv({ exec: badExec }));
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(400);
		expect(await fsp.readdir(cdnDir)).not.toContain(FILE);
	});

	it("入库钳制：summary>200/description>2000 截断入库（catalog 展示字段）", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const fat = { ...MANIFEST, summary: "s".repeat(300), description: "d".repeat(3000) };
		const api = createCdnUploadApi(makeEnv({ exec: uploadExec({ manifest: fat }) }));
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		const row = dbo.prepare("SELECT manifest FROM market_release WHERE product=? AND version=?").get("demo-solution", "0.1.0");
		const stored = JSON.parse(row.manifest);
		expect(stored.summary).toHaveLength(200);
		expect(stored.description).toHaveLength(2000);
	});
});

describe("POST upload（发布审计落 market_history）", () => {
	it("发布成功 → action=publish status=success（operator=key_id）；409 冲突也记 failed", async () => {
		const { createCdnUploadApi } = await import("../../src/app/api/_platform/cdn/api");
		const api = createCdnUploadApi(makeEnv());
		await pushSig(api);
		g.http = httpFor(FILE, ARCHIVE);
		await api.upload.post();
		expect(last?.status).toBe(200);
		const ok = dbo.prepare("SELECT * FROM market_history WHERE action='publish' AND status='success'").all();
		expect(ok).toHaveLength(1);
		expect(ok[0]).toMatchObject({ solution: "demo-solution", version: "0.1.0", operator: KEY_ID });
		// 异字节冲突 → failed 留痕
		const tampered = new TextEncoder().encode("tampered-bytes\n");
		g.http = httpFor(FILE, tampered, uploadSignature(FILE, tampered));
		await api.upload.post();
		expect(last?.status).toBe(409);
		const failed = dbo.prepare("SELECT * FROM market_history WHERE action='publish' AND status='failed'").all();
		expect(failed.length).toBe(1);
		expect(failed[0]).toMatchObject({ solution: "demo-solution", version: "0.1.0", operator: KEY_ID });
	});
});
