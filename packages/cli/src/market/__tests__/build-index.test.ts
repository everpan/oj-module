// ojm market build-index spec（T4）：扫描 cdn/*.tgz → 全量重建 Form B 索引。
//
// 两条必守：① 结果只取决于目录里有什么（多次执行字节一致）；② bundles 的 file 必须逐字
// `<name>-<version>.tgz`——安装侧 P2-11 会拿它挡索引投毒，写歪一个字符就会装不上。
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";

import { createDeterministicTgz } from "../../deterministic-tar";
import { verifyCanonical } from "../../lifecycle/sign";
import { INDEX_TTL_SECONDS, indexCanonical } from "../../publish";
import { buildIndex } from "../build-index";
import { buildFixturePackage } from "../fixture";

const MOUNTS = "  - prefix: /api\n    api: src\n  - prefix: /cdn\n    web: ../cdn\n";
const CONFIG = `mounts:\n${MOUNTS}server:\n  host: 127.0.0.1\n  port: 9778\n`;
const KEY_ID = "cdn.maintainer";
/** 注入的重建时刻（epoch 秒；固定值使时效字段可断言，不随 wall clock 漂） */
const NOW = 1_800_000_000;

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

function readBundles(cdn: string): { solutions?: Array<Record<string, unknown>> } {
	return yamlParse(readFileSync(join(cdn, "bundles.yaml"), "utf-8")) as { solutions?: Array<Record<string, unknown>> };
}

describe("given cdn/ 里有多个包与多个版本 When 重建索引", () => {
	it("then 按 semver 聚合：版本全留、latest 取最大", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		await putPackage(cdn, staging, "demo-solution", "0.2.0");
		await putPackage(cdn, staging, "other-solution", "0.3.0");

		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const bundles = readBundles(cdn);
		expect(result.solutions).toBe(2);
		const demo = bundles.solutions!.find(s => s.name === "demo-solution")!;
		expect(demo.latest).toBe("0.2.0");
		expect(demo.versions as unknown[]).toHaveLength(2);
		const manifests = yamlParse(readFileSync(join(cdn, "manifests.yaml"), "utf-8")) as unknown[];
		expect(manifests).toHaveLength(3);
	});

	it("then bundles 的 file 逐字为 <name>-<version>.tgz（安装侧 P2-11 加固前置）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const demo = readBundles(cdn).solutions![0]!;
		const hit = (demo.versions as Array<Record<string, unknown>>)[0]!;
		expect(hit.file).toBe("demo-solution-0.1.0.tgz");
		expect(hit.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(hit.size).toBeGreaterThan(0);
	});

	it("then 索引只取决于目录内容：连续两次执行字节一致（幂等；时效按注入时刻，不随 wall clock 漂）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");
		const key = testPem();

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });
		const first = readFileSync(join(cdn, "bundles.yaml"), "utf-8");
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: key, now: NOW });
		const second = readFileSync(join(cdn, "bundles.yaml"), "utf-8");

		expect(second).toBe(first);
	});
});

describe("given 一个已重建过的索引 When 目录内容发生变化后再次重建", () => {
	it("then seq 单调 +1（REG-CS2），且时效随之刷新", async () => {
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
		expect((readBundles(cdn) as { seq?: number }).seq).toBe(2);
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
	it("then bundles.yaml 盖有 issued_at / expires_at，跨度恰为 INDEX_TTL_SECONDS（REG-CS2）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");

		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem(), now: NOW });

		const bundles = readBundles(cdn) as { issued_at?: number, expires_at?: number };
		expect(bundles.issued_at).toBe(NOW);
		expect(bundles.expires_at).toBe(NOW + INDEX_TTL_SECONDS);
		expect(result.issuedAt).toBe(NOW);
		expect(result.expiresAt).toBe(NOW + INDEX_TTL_SECONDS);
	});
});

describe("given cdn/ 为空 When 重建索引", () => {
	it("then 产出空索引（不是缺 Solutions 段）——空目录也能验、也能装", async () => {
		const { root, cdn } = newProject();

		const result = await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		expect(result.solutions).toBe(0);
		const bundles = readBundles(cdn);
		expect(bundles.solutions).toEqual([]);
		expect(yamlParse(readFileSync(join(cdn, "manifests.yaml"), "utf-8"))).toEqual([]);
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
	it("then manifests 的 archive.signature 带上它（否则安装器按 sig_missing 拒装）", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		const file = await putPackage(cdn, staging, "demo-solution", "0.1.0");
		writeFileSync(`${join(cdn, file)}.sig`, JSON.stringify({ alg: "Ed25519", key_id: KEY_ID, public_key: "ab", value: "cd", canon: "v1" }), "utf-8");

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const manifests = yamlParse(readFileSync(join(cdn, "manifests.yaml"), "utf-8")) as Array<Record<string, unknown>>;
		const archive = manifests[0]!.archive as Record<string, unknown>;
		expect(archive.signature).toMatchObject({ key_id: KEY_ID });
	});
});

describe("given 给了签名身份 When 重建索引", () => {
	it("then 两份索引各产出可复核的 .sig", async () => {
		const { root, cdn } = newProject();
		const staging = mkdtempSync(join(tmpdir(), "ojm-stage-"));
		await putPackage(cdn, staging, "demo-solution", "0.1.0");

		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		for (const kind of ["bundles", "manifests"] as const) {
			const sigPath = join(cdn, `${kind}.yaml.sig`);
			expect(existsSync(sigPath)).toBe(true);
			const sig = JSON.parse(readFileSync(sigPath, "utf-8")) as { public_key: string, value: string, key_id: string, seq: number };
			expect(sig.key_id).toBe(KEY_ID);
			// REG-CS1：签名覆盖 (kind, seq)；两份索引同代
			expect(sig.seq).toBe(1);
			const text = readFileSync(join(cdn, `${kind}.yaml`), "utf-8");
			expect(verifyCanonical(sig.public_key, indexCanonical(kind, sig.seq, text), sig.value)).toBe(true);
			// 换代即失效——同内容换 seq 签不出来
			expect(verifyCanonical(sig.public_key, indexCanonical(kind, sig.seq + 1, text), sig.value)).toBe(false);
		}
	});
});
