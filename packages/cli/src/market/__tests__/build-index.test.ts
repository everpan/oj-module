// ojm market build-index spec（T4 + REG-CS5 三级化）：扫描 cdn/*.tgz → 全量重建三级索引。
//
// 三条必守：① 结果只取决于目录里有什么（多次执行字节一致）；② archive.file 逐字
// `<name>-<version>.tgz`——安装侧 P2-11 会拿它挡索引投毒，写歪一个字符就会装不上；
// ③ catalog 是提交点（红队 F2）：写完分片还没提交时，盘上仍是上一代、且不残留半文件。
import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

import { createDeterministicTgz } from "../../deterministic-tar";
import { verifyCanonical } from "../../lifecycle/sign";
import { INDEX_TTL_SECONDS, indexCanonical } from "../../publish";
import { buildIndex } from "../build-index";
import { buildFixturePackage, solutionManifest } from "../fixture";
import { compareSemver } from "../index-builder";
import { markYanked, readYankLedger } from "../yank-ledger";

const MOUNTS = "  - prefix: /api\n    api: src\n  - prefix: /cdn\n    web: ../cdn\n";
const CONFIG = `mounts:\n${MOUNTS}server:\n  host: 127.0.0.1\n  port: 9778\n`;
const KEY_ID = "cdn.maintainer";
/** 注入的重建时刻（epoch 秒；固定值使时效字段可断言，不随 wall clock 漂） */
const NOW = 1_800_000_000;

/** catalog 正文（三级索引的提交点：片钉 + 包名→片号映射 + seq/时效） */
interface CatalogDoc {
	seq?: number
	issued_at?: number
	expires_at?: number
	shards?: Record<string, number>
	solutions?: Array<{ name: string, shards: number[] }>
}

/** 分片正文（纯内容：方案条目 + Form B 版本明细，无任何元字段） */
interface ShardDoc {
	solutions?: Array<{ name: string, latest: string, versions: Array<Record<string, unknown>> }>
}

/** 索引 .sig 六字段（与 archive .sig 同构 + seq；REG-CS1 签名覆盖 kind 与 seq） */
interface IndexSig {
	alg: string
	key_id: string
	public_key: string
	value: string
	canon: string
	seq: number
}

function testPem(): string {
	return generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function newProject(): { root: string, cdn: string } {
	const root = mkdtempSync(join(tmpdir(), "ojm-market-index-"));
	mkdirSync(join(root, "api"), { recursive: true });
	writeFileSync(join(root, "api", "config.yaml"), CONFIG, "utf-8");
	const cdn = join(root, "cdn");
	mkdirSync(cdn, { recursive: true });
	return { root, cdn };
}

/** 把一个 fixture 方案打进 cdn 目录，返回 tgz 文件名 */
async function putPackage(cdn: string, staging: string, name: string, version: string): Promise<string> {
	const pkg = buildFixturePackage({ stagingDir: staging, name, version });
	const tgz = join(cdn, `${name}-${version}.tgz`);
	await createDeterministicTgz(pkg.dir, tgz);
	return `${name}-${version}.tgz`;
}

/**
 * 手造「只含一份真实形态 manifest.yaml」的 tgz（体积实测用）。
 *
 * 为什么不全真打包：需求 §7 的 Form B 体积（535–684B/条）由 manifest 形状决定，
 * 与方案树里的 api/web 文件无关——readEmbeddedManifest 只读包内 manifest.yaml。
 * 2500 个全真 fixture 要把整棵树写 2500 遍，等的是 IO 不是被测的体积口径。
 * ustar 布局照抄 fixture.ts 的 buildEvilZipSlipTgz（mtime=0 确定性）；readTgz 只读
 * name/size/typeflag、不校验 checksum，这份最小包与真包在读面等价。
 */
function putManifestPackage(cdn: string, name: string, version: string): void {
	const content = Buffer.from(yamlStringify(solutionManifest(name, version), { lineWidth: 0 }), "utf-8");
	const header = Buffer.alloc(512);
	header.write("manifest.yaml", 0, "utf-8"); // name[100]
	header.write("0000644\0", 100); // mode
	header.write("0000000\0", 108); // uid
	header.write("0000000\0", 116); // gid
	header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124); // size[12]
	header.write("00000000000\0", 136); // mtime[12] 置 0（确定性）
	header.fill(0x20, 148, 156); // chksum 先填空格
	header.write("0", 156); // typeflag：普通文件
	header.write("ustar\0", 257); // magic
	header.write("00", 263); // version
	let sum = 0;
	for (const b of header)
		sum += b;
	header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148); // chksum[8]
	const pad = Math.ceil(content.length / 512) * 512 - content.length;
	const tar = Buffer.concat([header, content, Buffer.alloc(pad), Buffer.alloc(1024)]);
	writeFileSync(join(cdn, `${name}-${version}.tgz`), gzipSync(tar));
}

function readCatalog(cdn: string): CatalogDoc {
	return yamlParse(readFileSync(join(cdn, "catalog.yaml"), "utf-8")) as CatalogDoc;
}

function readShard(cdn: string, no: number): ShardDoc {
	return yamlParse(readFileSync(join(cdn, "shards", `${no}.yaml`), "utf-8")) as ShardDoc;
}

/**
 * 按 catalog 映射合并某方案的全部版本（读方口径：片号倒序，最高片优先——
 * latest 只从最高片取，版本明细跨片合并后按 semver 升序）。
 */
function solutionOf(cdn: string, name: string): { latest: string, versions: Array<Record<string, unknown>> } {
	const entry = readCatalog(cdn).solutions!.find(s => s.name === name)!;
	const versions: Array<Record<string, unknown>> = [];
	let latest = "";
	for (const no of [...entry.shards].sort((a, b) => b - a)) {
		const sol = readShard(cdn, no).solutions!.find(s => s.name === name)!;
		if (latest === "")
			latest = sol.latest;
		versions.push(...sol.versions);
	}
	return { latest, versions: versions.sort((a, b) => compareSemver(String(a.version), String(b.version))) };
}

function sigOf(indexFile: string): IndexSig {
	return JSON.parse(readFileSync(`${indexFile}.sig`, "utf-8")) as IndexSig;
}

describe("compareSemver（S2-0 prerelease 序，与 _lifecycle/semver.ts 同源算法）", () => {
	it("预发布数字标识符按数值：1.0.0-10 > 1.0.0-2", () => {
		expect(compareSemver("1.0.0-10", "1.0.0-2")).toBe(1);
		expect(compareSemver("1.0.0-2", "1.0.0-10")).toBe(-1);
	});

	it("正式版 > 预发布版：1.0.0 > 1.0.0-rc.1", () => {
		expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
		expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
	});

	it("无预发布相等：1.0.0 == 1.0.0", () => {
		expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
	});

	it("缺省段视为 0：1.0 == 1.0.0", () => {
		expect(compareSemver("1.0", "1.0.0")).toBe(0);
	});

	it("预发布字母按字典序、数字 < 字母", () => {
		expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
		expect(compareSemver("1.0.0-rc.1", "1.0.0-zeta")).toBe(-1);
	});
});

describe("given cdn/ 里有预发布版本 When 重建索引", () => {
	it("then latest 取最大（含预发布序：1.0.0 > 1.0.0-rc.1 > 1.0.0-2）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "1.0.0-rc.1");
		await putPackage(cdn, staging, "demo-solution", "1.0.0-2");
		await putPackage(cdn, staging, "demo-solution", "1.0.0");
		await putPackage(cdn, staging, "demo-solution", "0.9.0");

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const demo = solutionOf(cdn, "demo-solution");
		expect(demo.latest).toBe("1.0.0");
		expect(demo.versions).toHaveLength(4);
	});
});

describe("given cdn/ 里有多个包与多个版本 When 重建索引", () => {
	it("then 按 semver 聚合：版本全留、latest 取最大", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		await putPackage(cdn, staging, "other-solution", "0.3.0");

		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		expect(result.solutions).toBe(2);
		// 三个版本一片装得下：两个包同指 1 号片
		expect(readCatalog(cdn).solutions).toEqual([
			{ name: "demo-solution", shards: [1] },
			{ name: "other-solution", shards: [1] },
		]);
		const demo = solutionOf(cdn, "demo-solution");
		expect(demo.latest).toBe("0.2.0");
		expect(demo.versions).toHaveLength(2);
	});

	it("then archive.file 逐字为 <name>-<version>.tgz（安装侧 P2-11 加固前置）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const hit = solutionOf(cdn, "demo-solution").versions[0]!;
		const archive = hit.archive as Record<string, unknown>;
		expect(archive.file).toBe("demo-solution-0.1.0.tgz");
		expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(archive.size).toBeGreaterThan(0);
	});

	it("then catalog 只记 包名→片号、版本明细全在片里（装一个包不拉全量）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		await putPackage(cdn, staging, "other-solution", "0.3.0");

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		// 映射条目只有 name/shards 两个键——没有 versions、没有 latest
		for (const entry of readCatalog(cdn).solutions!)
			expect(Object.keys(entry).sort()).toEqual(["name", "shards"]);
		// 片正文是纯内容：无 seq / 时效字段（代次只由 .sig 与 catalog 承载）
		const shardText = readFileSync(join(cdn, "shards", "1.yaml"), "utf-8");
		for (const field of ["seq:", "issued_at:", "expires_at:"])
			expect(shardText).not.toContain(field);
	});

	it("then 索引只取决于目录内容：连续两次执行字节一致（幂等；时效按注入时刻，不随 wall clock 漂）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		const key = testPem();

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });
		const first = {
			catalog: readFileSync(join(cdn, "catalog.yaml"), "utf-8"),
			catalogSig: readFileSync(join(cdn, "catalog.yaml.sig"), "utf-8"),
			shard: readFileSync(join(cdn, "shards", "1.yaml"), "utf-8"),
			shardSig: readFileSync(join(cdn, "shards", "1.yaml.sig"), "utf-8"),
		};
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });

		expect(readFileSync(join(cdn, "catalog.yaml"), "utf-8")).toBe(first.catalog);
		expect(readFileSync(join(cdn, "catalog.yaml.sig"), "utf-8")).toBe(first.catalogSig);
		expect(readFileSync(join(cdn, "shards", "1.yaml"), "utf-8")).toBe(first.shard);
		expect(readFileSync(join(cdn, "shards", "1.yaml.sig"), "utf-8")).toBe(first.shardSig);
	});
});

describe("given 一个已重建过的索引 When 目录内容发生变化后再次重建", () => {
	it("then seq 单调 +1（REG-CS2），变了的片取新号、旧号提交后清扫", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		const key = testPem();

		const first = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });
		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		const second = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW + 3600 });

		expect(first.seq).toBe(1);
		expect(second.seq).toBe(2); // 只增不减——读方据此挡回放
		expect(second.issuedAt).toBe(NOW + 3600);
		const catalog = readCatalog(cdn);
		expect(catalog.seq).toBe(2);
		expect(catalog.shards).toEqual({ 2: 2 }); // 内容变了的片取全新号
		expect(existsSync(join(cdn, "shards", "1.yaml"))).toBe(false); // 旧号不再被引用，提交后清扫
	});

	it("then 内容未变则 seq 不变（幂等不产生代次漂移），时效仍刷新", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		const key = testPem();

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });
		const again = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW + 86400 });

		expect(again.seq).toBe(1);
		expect(again.issuedAt).toBe(NOW + 86400);
		expect(again.expiresAt).toBe(NOW + 86400 + INDEX_TTL_SECONDS);
	});
});

describe("given 一次普通重建 When 检查产出索引的时效字段", () => {
	it("then catalog 盖有 issued_at / expires_at，跨度恰为 INDEX_TTL_SECONDS（REG-CS2）；分片是纯内容不盖", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");

		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem(), now: NOW });

		const catalog = readCatalog(cdn);
		expect(catalog.issued_at).toBe(NOW);
		expect(catalog.expires_at).toBe(NOW + INDEX_TTL_SECONDS);
		expect(catalog.seq).toBe(1);
		expect(result.issuedAt).toBe(NOW);
		expect(result.expiresAt).toBe(NOW + INDEX_TTL_SECONDS);
		expect(readFileSync(join(cdn, "shards", "1.yaml"), "utf-8")).not.toContain("issued_at");
	});
});

describe("given cdn/ 为空 When 重建索引", () => {
	it("then 产出空索引（不是缺 Solutions 段）——空目录也能验、也能装", async () => {
		const { root, cdn } = newProject();

		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		expect(result.solutions).toBe(0);
		const catalog = readCatalog(cdn);
		expect(catalog.solutions).toEqual([]);
		expect(catalog.shards).toEqual({ 1: 1 }); // 空索引也产一个空片，读方「拉 catalog 即知天下」
		expect(readShard(cdn, 1).solutions).toEqual([]);
	});
});

describe("given cdn/ 里有一个没有内嵌 manifest 的包 When 重建索引", () => {
	it("then 跳过该包并给出可读警告，其余包照常入索引", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		writeFileSync(join(cdn, "broken-0.1.0.tgz"), "garbage-not-a-tgz", "utf-8");
		await putPackage(cdn, staging, "demo-solution", "0.1.0");

		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		expect(result.skipped).toContain("broken-0.1.0.tgz");
		expect(result.solutions).toBe(1);
	});
});

describe("given 包带包级 .sig 侧车 When 重建索引", () => {
	it("then 版本条目的 archive.signature 带上它（否则安装器按 sig_missing 拒装）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		const file = await putPackage(cdn, staging, "demo-solution", "0.1.0");
		writeFileSync(`${join(cdn, file)}.sig`, JSON.stringify({ alg: "Ed25519", key_id: KEY_ID, public_key: "ab", value: "cd", canon: "v2", registry_id: "test.registry" }), "utf-8");

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const hit = solutionOf(cdn, "demo-solution").versions[0]!;
		expect((hit.archive as Record<string, unknown>).signature).toMatchObject({ key_id: KEY_ID });
	});
});

describe("given 给了签名身份 When 重建索引", () => {
	it("then catalog 与各分片都产出可复核的 .sig（kind 各归各、片签代次 = catalog 钉值）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const catalogText = readFileSync(join(cdn, "catalog.yaml"), "utf-8");
		const catalogSig = sigOf(join(cdn, "catalog.yaml"));
		expect(catalogSig.key_id).toBe(KEY_ID);
		expect(catalogSig.seq).toBe(1);
		expect(verifyCanonical(catalogSig.public_key, indexCanonical("catalog", catalogSig.seq, catalogText), catalogSig.value)).toBe(true);
		// 换代即失效——同内容换 seq 签不出来
		expect(verifyCanonical(catalogSig.public_key, indexCanonical("catalog", catalogSig.seq + 1, catalogText), catalogSig.value)).toBe(false);
		// kind 各归各（REG-CS1）：catalog 正文按 shard 的 kind 验不过
		expect(verifyCanonical(catalogSig.public_key, indexCanonical("shard", catalogSig.seq, catalogText), catalogSig.value)).toBe(false);

		for (const [no, pin] of Object.entries(readCatalog(cdn).shards!)) {
			const shardText = readFileSync(join(cdn, "shards", `${no}.yaml`), "utf-8");
			const sig = sigOf(join(cdn, "shards", `${no}.yaml`));
			expect(sig.seq).toBe(pin); // 片签代次 = catalog 钉值（F2 同代校验的写侧保证）
			expect(verifyCanonical(sig.public_key, indexCanonical("shard", sig.seq, shardText), sig.value)).toBe(true);
		}
	});
});

describe("given 误删最高版本包 When 重建索引", () => {
	it("then 拒建：latest 回退违反 REG-CS2 单调不降（宁可拒建，也不产往回走的索引）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		const key = testPem();
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });
		const before = readFileSync(join(cdn, "catalog.yaml"), "utf-8");

		rmSync(join(cdn, "demo-solution-0.2.0.tgz"));
		await expect(buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW + 60 }))
			.rejects
			.toThrow("latest 回退");
		// 拒建发生在落盘之前：上一代原样可读
		expect(readFileSync(join(cdn, "catalog.yaml"), "utf-8")).toBe(before);
	});
});

describe("rEG-CS4 yank（下线某版本：索引标记 + latest 跳过）", () => {
	it("yank 后该版本带 yanked:true + yanked_at，且 latest 跳到下一个未下线版本", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		await putPackage(cdn, staging, "demo-solution", "0.3.0");
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const r = markYanked(root, "demo-solution", "0.3.0", { by: "admin", reason: "安全漏洞" });
		expect(r.created).toBe(true);
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem(), now: NOW });

		const demo = solutionOf(cdn, "demo-solution");
		// latest 跳过已下线版本
		expect(demo.latest).toBe("0.2.0");
		const v030 = demo.versions.find(v => v.version === "0.3.0")!;
		expect(v030.yanked).toBe(true);
		expect(typeof v030.yanked_at).toBe("number");
		const v020 = demo.versions.find(v => v.version === "0.2.0")!;
		expect(v020.yanked).toBeUndefined();
	});

	it("重复 yank 幂等（不重复写、created=false），且 latest 仍正确跳过", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		expect(markYanked(root, "demo-solution", "0.2.0", { by: "admin" }).created).toBe(true);
		expect(markYanked(root, "demo-solution", "0.2.0", { by: "admin" }).created).toBe(false);
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem(), now: NOW });

		expect(solutionOf(cdn, "demo-solution").latest).toBe("0.1.0");
		// 账本文件未被改写（幂等）：仍是单条
		expect(readYankLedger(root).size).toBe(1);
	});

	it("对 cdn 中不存在的版本 yank → 抛明确错误（不污染账本）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");

		let thrown: unknown;
		try {
			await markYanked(root, "demo-solution", "9.9.9", { by: "admin" });
		}
		catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect(String((thrown as Error).message)).toContain("无法下线");
		expect(readYankLedger(root).size).toBe(0);
	});

	it("全部版本下线 → latest 降级取最高版（索引不空，避免 latest 缺失引发下游崩溃）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		markYanked(root, "demo-solution", "0.1.0", { by: "admin" });
		markYanked(root, "demo-solution", "0.2.0", { by: "admin" });
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem(), now: NOW });

		const demo = solutionOf(cdn, "demo-solution");
		expect(demo.latest).toBe("0.2.0");
		for (const v of demo.versions)
			expect(v.yanked).toBe(true);
	});
});

describe("given 2500 个版本、1 个包 When 重建索引（S2-1 BDD ①：超阈值自动分片）", () => {
	it("then 生成 3 个 shard 且每片 ≤1000 条，catalog 指向该包所在三片、latest 住在最高片；体积与内存有实测记录", async () => {
		const { root, cdn } = newProject();
		for (let i = 0; i < 2500; i++)
			putManifestPackage(cdn, "mega", `1.0.${i}`);

		// 内存实测（计划 §S2-1 验收「峰值内存有实测记录」）：buildIndex 全程同步，进程内无法采样峰值；
		// 能量到也最有意义的两个数——① 构建后存活集（构建前后各收一次垃圾）：中间对象是否真的被释放，
		// 这是需求 §7「中间对象 <100MB」的**可判定口径**（构建中最坏时点 packages + solutions + bodies
		// 同时存活，量级几十 MB；能全部释放即证明没有把全量数据攥在手里不放）；② 构建引起的堆增长
		// （不做事后 gc）：含未回收垃圾、随 V8 回收时机波动（155–242MB），**只记录不设闸**——
		// isolate 里堆逼近上限时 V8 会主动回收，预测 OOM 的是存活集不是增长量。
		// gc 由 vitest.config.ts 的 execArgv: ["--expose-gc"] 注入；lint 禁裸 global，走 globalThis
		const gc = (globalThis as { gc?: () => void }).gc;
		gc?.();
		const heapBefore = process.memoryUsage().heapUsed;
		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem(), now: NOW });
		const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
		gc?.();
		const retained = process.memoryUsage().heapUsed - heapBefore;

		expect(result.shards).toBe(3);
		const catalog = readCatalog(cdn);
		expect(catalog.shards).toEqual({ 1: 1, 2: 1, 3: 1 });
		expect(catalog.solutions).toEqual([{ name: "mega", shards: [1, 2, 3] }]);

		const shard1 = readShard(cdn, 1).solutions![0]!;
		const shard2 = readShard(cdn, 2).solutions![0]!;
		const shard3 = readShard(cdn, 3).solutions![0]!;
		expect(shard1.versions).toHaveLength(1000);
		expect(shard2.versions).toHaveLength(1000);
		expect(shard3.versions).toHaveLength(500);
		// 最高片装最新版：latest 落在最后一片（安装 latest 只拉这一片，不请求另两片）
		expect(shard3.latest).toBe("1.0.2499");
		expect(shard1.versions.at(-1)!.version).toBe("1.0.999");
		expect(shard2.versions[0]!.version).toBe("1.0.1000");
		expect(shard2.versions.at(-1)!.version).toBe("1.0.1999");
		expect(shard3.versions[0]!.version).toBe("1.0.2000");

		// 合并视图：全集升序、跨片边界不重不漏
		const mega = solutionOf(cdn, "mega");
		expect(mega.latest).toBe("1.0.2499");
		expect(mega.versions).toHaveLength(2500);
		expect(mega.versions[0]!.version).toBe("1.0.0");
		expect(mega.versions[999]!.version).toBe("1.0.999");
		expect(mega.versions[1000]!.version).toBe("1.0.1000");
		expect(mega.versions[1999]!.version).toBe("1.0.1999");
		expect(mega.versions[2000]!.version).toBe("1.0.2000");
		expect(mega.versions.at(-1)!.version).toBe("1.0.2499");
		const asVersions = mega.versions.map(v => String(v.version));
		expect([...asVersions].sort((a, b) => compareSemver(a, b))).toEqual(asVersions);

		// 验收（计划 §S2-1）：单片体积实测 ≤1.5MB（目标 1.2MB）——两个数都打进测试输出留痕
		const size = statSync(join(cdn, "shards", "1.yaml")).size;
		expect(size).toBeLessThanOrEqual(1.5 * 1024 * 1024);
		expect(retained).toBeLessThan(100 * 1024 * 1024); // 需求 §7：中间对象 <100MB（存活口径，构建后即释）
		console.log(`[REG-CS5 实测] 单片 ${(size / 1024).toFixed(0)}KB / 1000 条（目标 1.2MB、上限 1.5MB）；构建存活集 ${(retained / 1048576).toFixed(1)}MB（<100MB）、堆增长 ${(heapGrowth / 1048576).toFixed(0)}MB（含未回收垃圾，仅记录）`);
	}, 30_000); // 体积用例：2500 个包一次全量重建，远超单测默认 5s
});

describe("given 内容未变的分片 When 追加新包后再次重建（REG-CS5 内容匹配编号）", () => {
	it("then 字节一致的片沿用旧号与旧代次（连签名都不重写），变了的片取新号、旧号提交后清扫", async () => {
		const { root, cdn } = newProject();
		const key = testPem();
		for (let i = 0; i < 600; i++)
			putManifestPackage(cdn, "aaa-solution", `1.0.${i}`);
		for (let i = 0; i < 400; i++)
			putManifestPackage(cdn, "bbb-solution", `1.0.${i}`);

		// 第 1 代：aaa+bbb 恰满 1000 条，同住 1 号片
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });
		expect(readCatalog(cdn).shards).toEqual({ 1: 1 });
		expect(readCatalog(cdn).solutions).toEqual([
			{ name: "aaa-solution", shards: [1] },
			{ name: "bbb-solution", shards: [1] },
		]);
		const shard1Before = readFileSync(join(cdn, "shards", "1.yaml"));
		const shard1Mtime = statSync(join(cdn, "shards", "1.yaml")).mtimeMs;
		const shard1SigBefore = readFileSync(join(cdn, "shards", "1.yaml.sig"), "utf-8");

		// 第 2 代：追加 ccc(500) 放不进 1 号片 → 开 2 号片；1 号片内容未变
		for (let i = 0; i < 500; i++)
			putManifestPackage(cdn, "ccc-solution", `1.0.${i}`);
		const second = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW + 60 });
		expect(second.seq).toBe(2);
		expect(readCatalog(cdn).shards).toEqual({ 1: 1, 2: 2 });
		expect(readCatalog(cdn).solutions).toEqual([
			{ name: "aaa-solution", shards: [1] },
			{ name: "bbb-solution", shards: [1] },
			{ name: "ccc-solution", shards: [2] },
		]);
		// 沿用片：正文、mtime、签名都没动（缓存热、ETag 稳定）
		expect(readFileSync(join(cdn, "shards", "1.yaml"))).toEqual(shard1Before);
		expect(statSync(join(cdn, "shards", "1.yaml")).mtimeMs).toBe(shard1Mtime);
		expect(readFileSync(join(cdn, "shards", "1.yaml.sig"), "utf-8")).toBe(shard1SigBefore);

		// 第 3 代：追加 ddd(500) 与 ccc 同槽 → 2 号片内容变了，取新号 3；旧 2 号片提交后清扫
		for (let i = 0; i < 500; i++)
			putManifestPackage(cdn, "ddd-solution", `1.0.${i}`);
		const third = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW + 120 });
		expect(third.seq).toBe(3);
		const catalog = readCatalog(cdn);
		expect(catalog.shards).toEqual({ 1: 1, 3: 3 }); // 未变片沿用 1 号旧代；变了的片取新号 3、接新代
		expect(catalog.solutions).toEqual([
			{ name: "aaa-solution", shards: [1] },
			{ name: "bbb-solution", shards: [1] },
			{ name: "ccc-solution", shards: [3] },
			{ name: "ddd-solution", shards: [3] },
		]);
		// 1 号片自始至终没被重写
		expect(readFileSync(join(cdn, "shards", "1.yaml"))).toEqual(shard1Before);
		// 旧 2 号片不再被引用，提交后清扫；新 3 号片签名代次 = 钉值
		expect(existsSync(join(cdn, "shards", "2.yaml"))).toBe(false);
		expect(existsSync(join(cdn, "shards", "2.yaml.sig"))).toBe(false);
		expect(sigOf(join(cdn, "shards", "3.yaml")).seq).toBe(3);
		// 合并视图：四个包都读得到、latest 正确
		expect(solutionOf(cdn, "aaa-solution").latest).toBe("1.0.599");
		expect(solutionOf(cdn, "ccc-solution").versions).toHaveLength(500);
		expect(solutionOf(cdn, "ddd-solution").latest).toBe("1.0.499");
	}, 30_000); // 体积用例：2000 个包 + 3 次全量重建，远超单测默认 5s
});

describe("given 重建在写完分片、提交 catalog 前被打断 When 客户端此时来拉（红队 F2 / 计划 BDD ③）", () => {
	it("then 盘上仍是上一代：catalog 与旧分片字节不变、签名仍可复核，新分片回滚、无 tmp 残片", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		const key = testPem();
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });
		const gen1 = {
			catalog: readFileSync(join(cdn, "catalog.yaml"), "utf-8"),
			shard: readFileSync(join(cdn, "shards", "1.yaml"), "utf-8"),
		};

		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		await expect(buildIndex({
			projectRoot: root,
			id: KEY_ID,
			privateKeyPem: key,
			now: NOW + 60,
			afterShards: () => { throw new Error("模拟进程在分片写完后、catalog 提交前被杀"); },
		})).rejects.toThrow("模拟进程在分片写完后、catalog 提交前被杀");

		// 上一代原样可读、可验（catalog 未动 = 提交点语义）
		expect(readFileSync(join(cdn, "catalog.yaml"), "utf-8")).toBe(gen1.catalog);
		expect(readFileSync(join(cdn, "shards", "1.yaml"), "utf-8")).toBe(gen1.shard);
		const sig = sigOf(join(cdn, "catalog.yaml"));
		expect(verifyCanonical(sig.public_key, indexCanonical("catalog", sig.seq, gen1.catalog), sig.value)).toBe(true);
		// 新分片按「从未发生」回滚；tmp 残片扫净（没有可被当作索引读取的半文件）
		expect(existsSync(join(cdn, "shards", "2.yaml"))).toBe(false);
		for (const dir of [cdn, join(cdn, "shards")]) {
			for (const f of readdirSync(dir))
				expect(f).not.toContain(".tmp.");
		}

		// 恢复：干净重跑成功并进入第 2 代（旧代没被半写楔死）
		const recovered = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW + 120 });
		expect(recovered.seq).toBe(2);
		expect(solutionOf(cdn, "demo-solution").latest).toBe("0.2.0");
	});
});

describe("given 重建后要离线自检 When 带 check", () => {
	it("then catalog 与各分片签名全部复核通过（checkPassed，且不污染进程退出码）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");

		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem(), now: NOW, check: true });

		expect(result.checkPassed).toBe(true);
		expect(process.exitCode ?? 0).toBe(0);
	});
});
