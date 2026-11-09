// BDD：离线包上传端点（2026-11-10 round 3：内网手动上传升级——方案 B 页面入库）。
// POST /api/oj-market/upload?name=<n>-<v>.tgz（superadmin）：multipart 双文件
// files[0]=tgz、files[1]=.sig 旁车——单请求配对，无 cdn 推送的 sig 先行 pair 时序。
// 信任锚 = 门禁人（superadmin）+ 包旁车与实收字节绑定验签（服务端重算 sha256 重构
// canonical `package:<registry_id>:<name>@<version>:<sha256>`）；**未审指纹放行入库**
// （目录 ≠ 信任，安装才是信任闸），trusted 字段如实暴露。目录行语义与 cdn/upload 一致：
// 同版本幂等/异字节 409 不碰盘、name 所有权首发绑定、manifestOfUpload 同一管线、
// 审计落 market_history（operator = 登录人，message 注明离线上传）。
/* eslint-disable test/prefer-lowercase-title -- 端点动词/路径是验收锚点，保留大写（cdn-upload.spec 同约定） */
import type { FsFace } from "../../src/app/api/_platform/_lifecycle/atomic";
import type { ExecFace } from "../../src/app/api/_platform/_lifecycle/steps/extract";
import type { MarketEnv } from "../../src/oj-market/api/api";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTestKey, nodeVerifyEd25519, signedArchiveFor } from "../../../src/lifecycle/__tests__/helpers";
import { generateKeyPair } from "../../../src/lifecycle/keygen";
import { createTrustStore } from "../../src/app/api/_platform/_lifecycle/trust";
import { invalidateAllUsers } from "../../src/app/api/_platform/_shared/service/infra/access";
import { createMarketApi, marketEnv } from "../../src/oj-market/api/api";
import { installDb } from "../fixture";

const g = globalThis as any;

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++)
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

const ARCHIVE = new TextEncoder().encode("demo-archive-bytes\n");
const SHA256 = createHash("sha256").update(ARCHIVE).digest("hex");
/** 共享测试 key（播进信任库 = trusted 面；无私钥入仓） */
const TEST_KEY = defaultTestKey();
const KEY_ID = "test.publisher";
const FILE = "demo-solution-0.1.0.tgz";
const SIG_BYTES = new TextEncoder().encode(JSON.stringify(signedArchiveFor(ARCHIVE, "demo-solution", "0.1.0", { keyPair: TEST_KEY }).sig));

/** 包内嵌 manifest（tar 桩解包写出；name/version 与文件名逐字一致） */
const MANIFEST = { name: "demo-solution", version: "0.1.0", summary: "演示方案" };

let root: string;
let cdnDir: string;
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

/** tar 桩：-tvzf 回 verbose 清单，-xzf 写出 manifest 夹具（dest = argv[4]；upload.ts 与 cdn 同一 manifestOfUpload 管线） */
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

function makeEnv(overrides: Partial<MarketEnv> = {}): MarketEnv {
	const base = marketEnv();
	return {
		...base,
		staging: join(root, "modules", ".staging"),
		trustPath,
		cdnDir,
		exec: uploadExec(),
		sha256Hex: d => createHash("sha256").update(d).digest("hex"),
		verifyEd25519: nodeVerifyEd25519,
		...overrides,
	};
}

/** 组装一次请求：query.name + 登录用户 + 双文件（files 顺序 [tgz, sig] 即协议——oj http 面不透出文件名） */
function httpFor(name: string, tgz: Uint8Array, sigBytes: Uint8Array, userId = 1) {
	return { user: { id: userId }, query: { name }, files: [{}, {}], file: async (i: number) => (i === 0 ? tgz : sigBytes) };
}

async function upload(api: ReturnType<typeof createMarketApi>, name = FILE, tgz = ARCHIVE, sigBytes = SIG_BYTES, userId = 1) {
	g.http = httpFor(name, tgz, sigBytes, userId);
	await api.upload.post();
	return last!;
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-upload-offline-"));
	cdnDir = join(root, "cdn");
	trustPath = join(root, "modules", ".solutions", "trusted-keys.yaml");
	await fsp.mkdir(cdnDir, { recursive: true });
	g.fs = nodeFsFace();
	dbo = installDb();
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
	await createTrustStore(trustPath, { audit: () => {}, fingerprintOf: pk => createHash("sha256").update(hexToBytes(pk)).digest("hex") }).add(KEY_ID, TEST_KEY.publicKeyHex);
	g.yaml = { parse: async (t: string) => JSON.parse(t) };
	g.http = { user: { id: 1 } };
	g.json = {
		ok: (data: unknown) => {
			last = { status: 200, data };
		},
		fail: (status: number, msg: string) => {
			last = { status, msg };
		},
		header: () => {},
	};
	last = null;
});

afterEach(async () => {
	g.fs = undefined;
	g.http = undefined;
	g.json = undefined;
	g.yaml = undefined;
	g.db = undefined;
	invalidateAllUsers();
	await fsp.rm(root, { recursive: true, force: true });
});

describe("POST upload（离线上传入库：门禁人 + 旁车绑定双锚）", () => {
	it("信任 key + pair 齐 → 200：行落库（published_at_source='upload'）、cdn/ 双文件落盘、trusted=true、fingerprint=sha256(pk)", async () => {
		const api = createMarketApi(makeEnv());
		const r = await upload(api);
		expect(r.status).toBe(200);
		expect(r.data).toMatchObject({ ok: true, name: "demo-solution", version: "0.1.0", sha256: SHA256, size: ARCHIVE.byteLength, key_id: KEY_ID, trusted: true, idempotent: false });
		expect(r.data.fingerprint).toBe(createHash("sha256").update(hexToBytes(TEST_KEY.publicKeyHex)).digest("hex"));
		const onDisk = createHash("sha256").update(await fsp.readFile(join(cdnDir, FILE))).digest("hex");
		expect(onDisk).toBe(SHA256);
		expect(JSON.parse(await fsp.readFile(join(cdnDir, `${FILE}.sig`), "utf8"))).toMatchObject({ alg: "Ed25519", key_id: KEY_ID });
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
	});

	it("未审指纹放行入库：key 不在信任库 → 200 {trusted:false}，行照落（目录 ≠ 信任，安装才是信任闸）", async () => {
		const api = createMarketApi(makeEnv());
		const rival = generateKeyPair();
		const rivalSig = new TextEncoder().encode(JSON.stringify(signedArchiveFor(ARCHIVE, "demo-solution", "0.1.0", { keyPair: rival, keyId: "rival.publisher" }).sig));
		const r = await upload(api, FILE, ARCHIVE, rivalSig);
		expect(r.status).toBe(200);
		expect(r.data).toMatchObject({ trusted: false, key_id: "rival.publisher" });
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(1);
	});

	it("非 superadmin → 403（拒权不泄露存在性）", async () => {
		const api = createMarketApi(makeEnv());
		const r = await upload(api, FILE, ARCHIVE, SIG_BYTES, 2);
		expect(r.status).toBe(403);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(0);
	});

	it("只传 1 个文件 → 400 人话（tgz 与 .sig 缺一不可）", async () => {
		const api = createMarketApi(makeEnv());
		g.http = { user: { id: 1 }, query: { name: FILE }, files: [{}], file: async () => ARCHIVE };
		await api.upload.post();
		expect(last?.status).toBe(400);
		expect(String(last?.msg)).toContain("两个文件");
		expect(await fsp.readdir(cdnDir)).toEqual([]);
	});

	it("非法文件名 → 400（白名单 fail-closed，零落盘）", async () => {
		const api = createMarketApi(makeEnv());
		const r = await upload(api, "../evil-0.1.0.tgz");
		expect(r.status).toBe(400);
		expect(await fsp.readdir(cdnDir)).toEqual([]);
	});

	it("旁车与实收字节不绑定（sig 对别的字节签）→ 409 不碰盘：cdn/ 零痕迹、库无行", async () => {
		const api = createMarketApi(makeEnv());
		const other = new TextEncoder().encode("other-bytes\n");
		const staleSig = new TextEncoder().encode(JSON.stringify(signedArchiveFor(other, "demo-solution", "0.1.0", { keyPair: TEST_KEY }).sig));
		const r = await upload(api, FILE, ARCHIVE, staleSig);
		expect(r.status).toBe(409);
		expect(String(r.msg)).toContain("绑定");
		expect(await fsp.readdir(cdnDir)).toEqual([]);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(0);
	});

	it("同字节重传 → 200 {idempotent:true}：行数不变、published_at 不改写、缺文件自愈补齐", async () => {
		const api = createMarketApi(makeEnv());
		expect((await upload(api)).status).toBe(200);
		const first = dbo.prepare("SELECT published_at FROM market_release WHERE product=? AND version=?").get("demo-solution", "0.1.0");
		await fsp.rm(join(cdnDir, FILE));
		const r = await upload(api);
		expect(r.status).toBe(200);
		expect(r.data).toMatchObject({ idempotent: true });
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(1);
		const second = dbo.prepare("SELECT published_at FROM market_release WHERE product=? AND version=?").get("demo-solution", "0.1.0");
		expect(second.published_at).toBe(first.published_at);
		expect(createHash("sha256").update(await fsp.readFile(join(cdnDir, FILE))).digest("hex")).toBe(SHA256);
	});

	it("异字节同版本 → 409 不碰盘（同一版本号只允许一份字节；盘上仍是原字节）", async () => {
		const api = createMarketApi(makeEnv());
		expect((await upload(api)).status).toBe(200);
		const tampered = new TextEncoder().encode("tampered-bytes\n");
		const tamperedSig = new TextEncoder().encode(JSON.stringify(signedArchiveFor(tampered, "demo-solution", "0.1.0", { keyPair: TEST_KEY }).sig));
		const r = await upload(api, FILE, tampered, tamperedSig);
		expect(r.status).toBe(409);
		expect(createHash("sha256").update(await fsp.readFile(join(cdnDir, FILE))).digest("hex")).toBe(SHA256);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(1);
	});

	it("name 所有权：既有行由 key A 首发，key B 的 pair 新版本 → 409（换主 = superadmin 操作）", async () => {
		const api = createMarketApi(makeEnv());
		expect((await upload(api)).status).toBe(200);
		const rival = generateKeyPair();
		const v2 = "demo-solution-0.2.0.tgz";
		const rivalSig2 = new TextEncoder().encode(JSON.stringify(signedArchiveFor(ARCHIVE, "demo-solution", "0.2.0", { keyPair: rival, keyId: "rival.publisher" }).sig));
		const rivalManifest = { ...MANIFEST, version: "0.2.0" };
		const api2 = createMarketApi(makeEnv({ exec: uploadExec({ manifest: rivalManifest }) }));
		const r = await upload(api2, v2, ARCHIVE, rivalSig2);
		expect(r.status).toBe(409);
		expect(String(r.msg)).toContain("所有权");
	});

	it("manifest.name/version 与上传文件名不符 → 400 零落盘", async () => {
		const api = createMarketApi(makeEnv({ exec: uploadExec({ manifest: { ...MANIFEST, version: "9.9.9" } }) }));
		const r = await upload(api);
		expect(r.status).toBe(400);
		expect(String(r.msg)).toContain("9.9.9");
		expect(await fsp.readdir(cdnDir)).toEqual([]);
		expect(dbo.prepare("SELECT COUNT(*) c FROM market_release").all()[0].c).toBe(0);
	});

	it("大文件 → 413（MAX_PACKAGE_BYTES 闸，零落盘）", async () => {
		const { MAX_PACKAGE_BYTES } = await import("../../src/app/api/_platform/_lifecycle/limits");
		const api = createMarketApi(makeEnv());
		const big = new Uint8Array(MAX_PACKAGE_BYTES + 1);
		const bigSig = new TextEncoder().encode(JSON.stringify(signedArchiveFor(big, "demo-solution", "0.1.0", { keyPair: TEST_KEY }).sig));
		const r = await upload(api, FILE, big, bigSig);
		expect(r.status).toBe(413);
		expect(await fsp.readdir(cdnDir)).toEqual([]);
	});

	it("审计：成功落 market_history（action=publish，operator=登录人 admin，message 含「离线上传」与 trusted 状态）", async () => {
		const api = createMarketApi(makeEnv());
		expect((await upload(api)).status).toBe(200);
		const ok = dbo.prepare("SELECT * FROM market_history WHERE action='publish' AND status='success'").all();
		expect(ok).toHaveLength(1);
		expect(ok[0]).toMatchObject({ solution: "demo-solution", version: "0.1.0", operator: "admin" });
		expect(String(ok[0].message)).toContain("离线上传");
	});
});
