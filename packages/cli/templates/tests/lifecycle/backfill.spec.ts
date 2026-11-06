// BDD：站点侧目录回填（计划 v4 §六——三用：回填=恢复=对账）。
// POST /api/oj-market/backfill（superadmin，R9）：扫 cdn/ 存量 tgz → 内嵌 manifest 抽取
// （与上传端点同一 manifestOfUpload 管线）+ 旁车 .sig（key_id/签名恢复）→ upsert
// market_release。幂等可重入；无 CLI 依赖（远端纯站点经 HTTP 触发）。
// 降级口径（数据表）：.sig 缺失/不可解析的行照常落库但 sig 四列 NULL（安装验签
// sig_missing fail-closed）；坏包进 skipped 不阻断其它文件；已 yank 行不回魂。

import type { FsFace } from "../../src/app/api/_platform/_lifecycle/atomic";
import type { ExecFace } from "../../src/app/api/_platform/_lifecycle/steps/extract";
import type { MarketEnv } from "../../src/oj-market/api/api";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTestKey, nodeVerifyEd25519, signedArchiveFor } from "../../../src/lifecycle/__tests__/helpers";
import { createMarketApi, marketEnv } from "../../src/oj-market/api/api";
import { installDb } from "../fixture";

const g = globalThis as any;

// tgz「字节」即 `<name>|<version>` 文本：manifestOfUpload 的 staging 文件名是常量 upload.tgz，
// tar stub 从 staged 字节读回 name/version（真实管道以包内 manifest 为真源，stub 同构模拟）。
// 签名/哈希全按实写字节算，假 tar 不需要真归档格式。
const TEST_KEY = defaultTestKey();
function pkgBytes(name: string, version: string): Uint8Array {
	return new TextEncoder().encode(`${name}|${version}\n`);
}
function shaOf(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** 捕获 json.ok/json.fail 出口（respond 收口后恰一次调用） */
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

/**
 * tar stub：list 恒过；extract 从 staged 字节读回 `<name>|<version>` 写扁平 manifest.yaml。
 *  「not-a-tar」字节模拟坏包（list 即失败）——staging 文件名是常量 upload.tgz，无法按名分流。
 */
function tarExec(manifestOverride?: (name: string, version: string) => Record<string, unknown>): ExecFace {
	return {
		run: async (argv) => {
			if (argv[0] === "tar" && argv[1] === "-tvzf") {
				const staged = await fsp.readFile(String(argv[2]), "utf-8");
				if (staged === "not-a-tar")
					return { code: 1, stdout: "", stderr: "garbage" };
				return { code: 0, stdout: "manifest.yaml\n", stderr: "" };
			}
			if (argv[0] === "tar" && argv[1] === "-xzf") {
				const dest = argv[4]!;
				const [name = "demo-solution", version = "0.1.0"] = (await fsp.readFile(String(argv[2]), "utf-8")).split("|");
				await fsp.mkdir(dest, { recursive: true });
				await fsp.writeFile(join(dest, "manifest.yaml"), JSON.stringify(
					manifestOverride?.(name, version) ?? { name, version: version.replace(/\n$/, ""), summary: "存量回填包" },
				));
				return { code: 0, stdout: "", stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		},
	};
}

let root: string;
let cdnDir: string;
let staging: string;
let dbPath: string;
let dbo: any;

function makeEnv(overrides: Partial<MarketEnv> = {}): MarketEnv {
	return {
		...marketEnv(),
		sharedRoot: join(root, "dist", "api"),
		staging,
		taskDir: join(root, "modules", ".install-tasks"),
		statePath: join(root, ".solutions", "state.yaml"),
		trustPath: join(root, ".solutions", "trusted-keys.yaml"),
		dbPath,
		siteModulesDir: join(root, "dist", "web", "modules"),
		modulesJsonPath: join(root, "dist", "web", "modules.json"),
		cdnDir,
		exec: tarExec(),
		sha256Hex: d => createHash("sha256").update(d).digest("hex"),
		verifyEd25519: nodeVerifyEd25519,
		...overrides,
	} as MarketEnv;
}

/** cdn/ 落一个存量包：tgz 字节（`<name>|<version>`）+ 可选 .sig 旁车（六字段） */
async function dropCdnPackage(name: string, version: string, opts: { sig?: boolean, bytes?: Uint8Array } = {}): Promise<Uint8Array> {
	const bytes = opts.bytes ?? pkgBytes(name, version);
	await fsp.writeFile(join(cdnDir, `${name}-${version}.tgz`), bytes);
	if (opts.sig !== false) {
		const sig = signedArchiveFor(bytes, name, version, { keyPair: TEST_KEY }).sig;
		await fsp.writeFile(join(cdnDir, `${name}-${version}.tgz.sig`), JSON.stringify(sig));
	}
	return bytes;
}

function rows(): Array<Record<string, unknown>> {
	return dbo.prepare("SELECT * FROM market_release ORDER BY product, version").all();
}

beforeEach(async () => {
	root = await fsp.mkdtemp(join(tmpdir(), "ojm-backfill-"));
	cdnDir = join(root, "cdn");
	staging = join(root, "modules", ".staging");
	dbPath = join(root, "db.sqlite");
	await fsp.mkdir(cdnDir, { recursive: true });
	await fsp.writeFile(dbPath, new TextEncoder().encode("sqlite-header\n"));
	g.fs = nodeFsFace();
	dbo = installDb();
	dbo.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_name) VALUES (?, ?)").run(1, "superadmin");
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
	await fsp.rm(root, { recursive: true, force: true });
});

describe("场景：回填（cdn/ 存量 → DB 目录行）", () => {
	it("给定 存量 tgz+.sig 无 DB 行，当 回填，则 行落库：published_at_source='file'、sig 四列取旁车", async () => {
		const bytes = await dropCdnPackage("demo-solution", "0.1.0");
		const api = createMarketApi(makeEnv());
		await api.backfill.post();
		expect(last?.status).toBe(200);
		const rs = rows();
		expect(rs).toHaveLength(1);
		expect(rs[0]).toMatchObject({
			product: "demo-solution",
			version: "0.1.0",
			key_id: "test.publisher",
			sha256: shaOf(bytes),
			size: bytes.byteLength,
			published_at_source: "file",
			yanked: 0,
		});
		expect(String(rs[0]!.sig_alg)).toBe("Ed25519");
		expect(typeof rs[0]!.sig_value).toBe("string");
		expect(typeof rs[0]!.sig_registry_id).toBe("string");
		const report = last?.data as { scanned: number, upserted: number, sigMissing: string[] };
		expect(report).toMatchObject({ scanned: 1, upserted: 1, sigMissing: [] });
	});

	it("数据表 .sig 缺失降级：行照落库，sig 四列 NULL，文件名进 sigMissing", async () => {
		await dropCdnPackage("demo-solution", "0.1.0", { sig: false });
		const api = createMarketApi(makeEnv());
		await api.backfill.post();
		expect(last?.status).toBe(200);
		const rs = rows();
		expect(rs).toHaveLength(1);
		expect(rs[0]).toMatchObject({ sig_alg: null, sig_value: null, sig_public_key: null, sig_registry_id: null, key_id: null });
		expect((last?.data as { sigMissing: string[] }).sigMissing).toEqual(["demo-solution-0.1.0.tgz"]);
	});

	it("数据表 旁车验签失败（形全但 sha 与字节不绑定，投毒旁车）：行照落库，sig 四列 NULL，进 sigMissing（fail-closed 与缺签同口径）", async () => {
		const bytes = pkgBytes("demo-solution", "0.1.0");
		// 形全实毒：对其它字节按同名同版本签出——结构合法、签名有效，唯与实收字节无绑定
		const poisoned = signedArchiveFor(pkgBytes("evil", "9.9.9"), "demo-solution", "0.1.0", { keyPair: TEST_KEY });
		await fsp.writeFile(join(cdnDir, "demo-solution-0.1.0.tgz"), bytes);
		await fsp.writeFile(join(cdnDir, "demo-solution-0.1.0.tgz.sig"), JSON.stringify(poisoned.sig));
		const api = createMarketApi(makeEnv());
		await api.backfill.post();
		expect(last?.status).toBe(200);
		const rs = rows();
		expect(rs).toHaveLength(1);
		expect(rs[0]).toMatchObject({ sig_alg: null, sig_value: null, sig_public_key: null, sig_registry_id: null, key_id: null, sha256: shaOf(bytes) });
		expect((last?.data as { sigMissing: string[] }).sigMissing).toEqual(["demo-solution-0.1.0.tgz"]);
	});
});

describe("场景：幂等可重入（对账）", () => {
	it("给定 已回填，当 重跑，则 行数不变、upserted=0、published_at 等审计列不被改写", async () => {
		await dropCdnPackage("demo-solution", "0.1.0");
		const api = createMarketApi(makeEnv());
		await api.backfill.post();
		const before = rows();
		await api.backfill.post();
		const report = last?.data as { upserted: number, unchanged: number };
		expect(report).toMatchObject({ upserted: 0, unchanged: 1 });
		expect(rows()).toEqual(before);
	});

	it("给定 遗留行（sig 列 NULL、published_at 旧值、yanked=1），当 回填，则 sig 列补齐且 published_at/first_seen_at/yanked 原样保留（yank 不回魂）", async () => {
		await dropCdnPackage("demo-solution", "0.1.0");
		dbo.prepare("INSERT INTO market_release (product,version,key_id,sha256,size,published_at,published_at_source,yanked,first_seen_at,sig_alg,sig_value,sig_public_key,sig_registry_id,manifest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
			.run("demo-solution", "0.1.0", null, "old-sha", 1, 424242, "file", 1, 424242, null, null, null, null, null);
		const api = createMarketApi(makeEnv());
		await api.backfill.post();
		expect(last?.status).toBe(200);
		const rs = rows();
		expect(rs).toHaveLength(1);
		expect(rs[0]).toMatchObject({
			sha256: shaOf(pkgBytes("demo-solution", "0.1.0")),
			published_at: 424242,
			first_seen_at: 424242,
			yanked: 1,
			key_id: "test.publisher",
		});
		expect(String(rs[0]!.sig_alg)).toBe("Ed25519");
	});
});

describe("场景：灾备恢复（清表 → 扫描恢复）", () => {
	it("给定 表清空 cdn/ 完好，当 回填，则 行恢复且重复跑行数不变", async () => {
		await dropCdnPackage("demo-solution", "0.1.0");
		await dropCdnPackage("other-solution", "2.0.0");
		const api = createMarketApi(makeEnv());
		await api.backfill.post();
		dbo.prepare("DELETE FROM market_release").run();
		await api.backfill.post();
		expect(rows()).toHaveLength(2);
		await api.backfill.post();
		expect(rows()).toHaveLength(2);
	});
});

describe("场景：门禁与坏包分流", () => {
	it("数据表 角色门禁：匿名 401 / 非 superadmin 403", async () => {
		const api = createMarketApi(makeEnv());
		g.http = {};
		await api.backfill.post();
		expect(last?.status).toBe(403); // assertSuperAdmin 对匿名亦 403（不泄露存在性）
		g.http = { user: { id: 2 } };
		await api.backfill.post();
		expect(last?.status).toBe(403);
	});

	it("给定 坏包与好包并存，当 回填，则 坏包进 skipped 带 reason、好包照落库", async () => {
		await dropCdnPackage("good-solution", "0.1.0");
		await fsp.writeFile(join(cdnDir, "broken-9.9.9.tgz"), new TextEncoder().encode("not-a-tar"));
		const api = createMarketApi(makeEnv({ exec: tarExec() }));
		await api.backfill.post();
		expect(last?.status).toBe(200);
		expect(rows()).toHaveLength(1);
		const report = last?.data as { skipped: Array<{ file: string, reason: string }> };
		expect(report.skipped).toHaveLength(1);
		expect(report.skipped[0]!.file).toBe("broken-9.9.9.tgz");
		expect(report.skipped[0]!.reason).toContain("列表失败");
	});

	it("给定 manifest 名实不符（文件名 demo-a、包内 manifest name=demo-b），当 回填，则 跳过并给出 reason", async () => {
		await dropCdnPackage("demo-a", "0.1.0");
		// 包内 manifest 写 demo-b → 与文件名 demo-a 名实不符
		const api = createMarketApi(makeEnv({ exec: tarExec(() => ({ name: "demo-b", version: "0.1.0" })) }));
		await api.backfill.post();
		expect(rows()).toHaveLength(0);
		const report = last?.data as { skipped: Array<{ file: string, reason: string }> };
		expect(report.skipped[0]!.reason).toContain("名实不符");
	});

	it("给定 孤立 .sig（tgz 缺失），当 回填，则 忽略不报错（容忍口径，不加 GC）", async () => {
		await fsp.writeFile(join(cdnDir, "lonely-1.0.0.tgz.sig"), "{}");
		const api = createMarketApi(makeEnv());
		await api.backfill.post();
		expect(last?.status).toBe(200);
		expect(rows()).toHaveLength(0);
		expect((last?.data as { scanned: number }).scanned).toBe(0);
	});
});
