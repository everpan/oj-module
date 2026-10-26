import type { VerifyCheck } from "../verify";
// ojm market verify spec（T7 + REG-CS5 三级化）：离线验包——不起站点、不装、不要凭据。
//
// 钉死两条：① 四类校验分列（完整性 / 包级签 / 索引签 / 结构），篡改任一项都必须在对应项上打叉；
// ② 结论恒带边界声明——验签过 ≠ 代码无恶意，这一点写错比校验写错更危险。
//
// 三级化后的索引面：catalog.yaml（代次真源）+ shards/<n>.yaml（版本明细与 archive.sha256）。
// 索引验签按文件分列（catalog 一项、每片一项），同代校验单独一项——红队 F2 的中间态
// （新 catalog 钉旧片）必须在同代项上打叉，且按「运维事故」而不是「被篡改」提示。
import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { createDeterministicTgz } from "../../deterministic-tar";
import { recomputeIndex, signIndex } from "../../publish";
import { signCommand } from "../../sign";
import { buildIndex } from "../build-index";
import { publishPackage } from "../publish";
import { readTgz } from "../scan";
import { verifyMarket } from "../verify";

const MOUNTS = "  - prefix: /api\n    api: src\n  - prefix: /cdn\n    web: ../cdn\n";
const CONFIG = `mounts:\n${MOUNTS}server:\n  host: 127.0.0.1\n  port: 9778\n`;
const KEY_ID = "demo.publisher";
const REGISTRY_ID = "test.registry";

function testPem(): string {
	return generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function newProject(): string {
	const root = mkdtempSync(join(tmpdir(), "ojm-market-verify-"));
	mkdirSync(join(root, "api"), { recursive: true });
	writeFileSync(join(root, "api", "config.yaml"), CONFIG, "utf-8");
	mkdirSync(join(root, "cdn"), { recursive: true });
	return root;
}

/** 落一个包并重建索引，返回工程根 */
async function seed(): Promise<string> {
	const root = newProject();
	await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });
	await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });
	return root;
}

function itemOf(result: Awaited<ReturnType<typeof verifyMarket>>, name: string): VerifyCheck | undefined {
	return result.checks.find(c => c.item === name);
}

/** 全部「索引签名」项（三级化后按文件分列：catalog 一项 + 每片一项） */
function sigItems(result: Awaited<ReturnType<typeof verifyMarket>>): VerifyCheck[] {
	return result.checks.filter(c => c.item === "索引签名");
}

describe("given 一个正常落地的包 When 离线验包", () => {
	it("then 四类校验全绿且结论带边界声明", async () => {
		const root = await seed();

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(true);
		expect(itemOf(result, "完整性")?.ok).toBe(true);
		expect(itemOf(result, "包级签名")?.ok).toBe(true);
		// 三级索引：catalog 与 1 号片各签各的，两项都在且全绿
		const sigs = sigItems(result);
		expect(sigs.length).toBeGreaterThanOrEqual(2);
		expect(sigs.every(c => c.ok)).toBe(true);
		expect(itemOf(result, "manifest 结构")?.ok).toBe(true);
		expect(result.conclusion).toContain("不构成内容安全性背书");
	});
});

describe("given 真实工程包（manifest 按 C2-29 整体省略 archive 占位）When 离线验包", () => {
	it("then manifest 结构不因此打叉（REG-CS8 回归：ojm build --bundle 不落 archive ≠ 缺必填）", async () => {
		const root = await seed();
		const tgz = join(root, "cdn", "demo-solution-0.1.0.tgz");
		// 解包 → 摘掉根 manifest 的 archive（fixture 有、真实方案无的字段差）→ 确定性重打包 → 重签 → 重建索引
		const staging = mkdtempSync(join(tmpdir(), "ojm-verify-noarchive-"));
		for (const e of readTgz(new Uint8Array(readFileSync(tgz)))) {
			if (e.name.endsWith("/"))
				continue;
			const abs = join(staging, e.name);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, e.content);
		}
		const rootManifestPath = join(staging, "manifest.yaml");
		const manifest = parse(readFileSync(rootManifestPath, "utf-8")) as Record<string, unknown>;
		delete manifest.archive;
		writeFileSync(rootManifestPath, stringify(manifest));
		await createDeterministicTgz(staging, tgz);
		signCommand(tgz, { id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "manifest 结构")?.ok).toBe(true);
		rmSync(staging, { recursive: true, force: true });
	});
});

describe("given 预发布版本（文件名含连字符）包体被篡改 When 离线验包", () => {
	it("then 完整性仍能检出（不再因文件名解析错配而静默放过，REG-CS1 边界）", async () => {
		const root = newProject();
		await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0-rc.1", id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });
		const tgz = join(root, "cdn", "demo-solution-0.1.0-rc.1.tgz");
		const buf = readFileSync(tgz);
		buf[buf.length - 1] ^= 0xFF; // 篡改末字节
		writeFileSync(tgz, buf);
		const result = await verifyMarket({ projectRoot: root });
		expect(itemOf(result, "完整性")?.ok).toBe(false);
	});
});

describe("given 包体被改了一个字节 When 离线验包", () => {
	it("then 完整性与包级签名双双打叉（sha256 不符 + 验签不过）", async () => {
		const root = await seed();
		const tgz = join(root, "cdn", "demo-solution-0.1.0.tgz");
		const bytes = Buffer.from(readFileSync(tgz));
		bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xFF;
		writeFileSync(tgz, bytes);

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		expect(itemOf(result, "完整性")?.ok).toBe(false);
		expect(itemOf(result, "包级签名")?.ok).toBe(false);
	});
});

describe("given 包级签名被删掉 When 离线验包", () => {
	it("then 包级签名打叉并给出 sig_missing 口径的指引", async () => {
		const root = await seed();
		rmSync(join(root, "cdn", "demo-solution-0.1.0.tgz.sig"));

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "包级签名")?.ok).toBe(false);
		expect(itemOf(result, "包级签名")?.detail).toMatch(/sig|签名/);
	});
});

describe("given catalog.yaml 被手改过 When 离线验包", () => {
	it("then 索引签名打叉 index_sig_mismatch（索引签名是完整性层，篡改必须可见）", async () => {
		const root = await seed();
		const catalog = join(root, "cdn", "catalog.yaml");
		writeFileSync(catalog, `${readFileSync(catalog, "utf-8")}\n# tampered\n`);

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		expect(sigItems(result).some(c => !c.ok && c.detail.includes("catalog.yaml"))).toBe(true);
		// REG-CS1：篡改与缺失必须可分（前者是安全事件，后者是发布流程漏了）
		expect(sigItems(result).find(c => c.detail.includes("catalog.yaml"))?.code).toBe("index_sig_mismatch");
	});
});

describe("given 分片正文被手改过 When 离线验包", () => {
	it("then 该片索引签名打叉 index_sig_mismatch，且完整性同步打叉（sha256 声明已不可信）", async () => {
		const root = await seed();
		const shard = join(root, "cdn", "shards", "1.yaml");
		// 把声明里的 sha256 改掉：片签名失配 + 索引声明的摘要与包体不符，两层都须看见。
		// 篡改值取带字母的十六进制（f…f）——纯数字串会被 YAML 解析成 number，那是另一种形态的坏索引
		const before = readFileSync(shard, "utf-8");
		const text = before.replace(/sha256: [0-9a-f]{64}/, `sha256: ${"f".repeat(64)}`);
		expect(text).not.toEqual(before); // 确认替换命中（夹具确有该字段）
		writeFileSync(shard, text);

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		expect(sigItems(result).find(c => c.detail.includes("shards/1.yaml"))?.code).toBe("index_sig_mismatch");
		expect(itemOf(result, "完整性")?.ok).toBe(false);
	});
});

describe("given 索引缺 .sig When 离线验包", () => {
	it("then 索引签名打叉 index_sig_missing 并给两步补签提示（不再「运行期容忍」）", async () => {
		const root = await seed();
		rmSync(join(root, "cdn", "catalog.yaml.sig"));
		rmSync(join(root, "cdn", "shards", "1.yaml.sig"));

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		const bad = sigItems(result).filter(c => !c.ok);
		expect(bad.length).toBeGreaterThanOrEqual(2);
		expect(bad.every(c => c.code === "index_sig_missing")).toBe(true);
		expect(bad[0]?.detail).toContain("ojm market build-index");
		expect(bad[0]?.detail).toContain("ojm publish");
	});
});

describe("given 只缺 catalog 的 .sig When 离线验包", () => {
	it("then catalog 项打叉 index_sig_missing、分片项不受牵连（按文件分列的意义）", async () => {
		const root = await seed();
		rmSync(join(root, "cdn", "catalog.yaml.sig"));

		const result = await verifyMarket({ projectRoot: root });

		const sigs = sigItems(result);
		expect(sigs.find(c => c.detail.includes("catalog.yaml"))?.code).toBe("index_sig_missing");
		expect(sigs.find(c => c.detail.includes("shards/1.yaml"))?.ok).toBe(true);
	});
});

describe("given catalog 正文代次与签名代次不一致 When 离线验包", () => {
	it("then 同代校验打叉报 index_generation_mismatch 并提示「源正在重建索引」（不是「索引被篡改」）", async () => {
		const root = await seed();
		// 改了正文没换签名：正文自称第 7 代、签名还是第 1 代
		const catalog = join(root, "cdn", "catalog.yaml");
		writeFileSync(catalog, readFileSync(catalog, "utf-8").replace(/^seq: \d+$/m, "seq: 7"), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		const item = itemOf(result, "索引同代");
		expect(item?.ok).toBe(false);
		expect(item?.code).toBe("index_generation_mismatch");
		expect(item?.detail).toContain("源正在重建索引，请稍后重试");
		expect(item?.detail).not.toContain("被篡改");
	});
});

describe("given catalog 钉的片代次与分片签名不符 When 离线验包（红队 F2 新形态：新目录钉旧片）", () => {
	it("then 同代校验打叉 index_generation_mismatch（拼不进，按运维事故提示重试）", async () => {
		const root = await seed();
		const cdn = join(root, "cdn");
		// 分片签名重签成第 2 代（签名本身有效），catalog 仍钉第 1 代——「写到一半」的中间态
		const shardText = recomputeIndex(readFileSync(join(cdn, "shards", "1.yaml"), "utf-8"));
		writeFileSync(
			join(cdn, "shards", "1.yaml.sig"),
			`${JSON.stringify(signIndex("shard", 2, shardText, testPem(), KEY_ID), null, 2)}\n`,
			"utf-8",
		);

		const result = await verifyMarket({ projectRoot: root });

		const item = itemOf(result, "索引同代");
		expect(item?.ok).toBe(false);
		expect(item?.code).toBe("index_generation_mismatch");
		expect(item?.detail).toContain("源正在重建索引，请稍后重试");
	});
});

describe("given 分片正文没了但 catalog 还钉着它 When 离线验包", () => {
	it("then 同代校验打叉 index_generation_mismatch（代次不可判定即拒，fail-closed）", async () => {
		const root = await seed();
		rmSync(join(root, "cdn", "shards", "1.yaml"));
		rmSync(join(root, "cdn", "shards", "1.yaml.sig"));

		const result = await verifyMarket({ projectRoot: root });

		const item = itemOf(result, "索引同代");
		expect(item?.ok).toBe(false);
		expect(item?.code).toBe("index_generation_mismatch");
		expect(item?.detail).toContain("正文缺失");
	});
});

describe("given 索引的 .sig 是旧格式（不带 seq）When 离线验包", () => {
	it("then 索引签名打叉并报 index_sig_mismatch（签名未覆盖代次 = 挡不住新旧拼接）", async () => {
		const root = await seed();
		const sigPath = join(root, "cdn", "catalog.yaml.sig");
		const sig = JSON.parse(readFileSync(sigPath, "utf-8")) as Record<string, unknown>;
		delete sig.seq;
		writeFileSync(sigPath, JSON.stringify(sig), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		expect(sigItems(result).find(c => c.detail.includes("catalog.yaml"))?.code).toBe("index_sig_mismatch");
	});
});

describe("given 索引已过自声明的失效时刻 When 离线验包", () => {
	it("then 索引时效打叉报 index_expired（REG-CS2：与站点安装同一判定，CLI/API 一致）", async () => {
		const root = await seed();
		const catalogPath = join(root, "cdn", "catalog.yaml");
		const doc = parse(readFileSync(catalogPath, "utf-8")) as Record<string, unknown>;
		doc.issued_at = 1;
		doc.expires_at = 2;
		writeFileSync(catalogPath, stringify(doc), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "索引时效")?.ok).toBe(false);
		expect(itemOf(result, "索引时效")?.code).toBe("index_expired");
	});
});

describe("given 索引不带时效字段（旧 ojm 产物）When 离线验包", () => {
	it("then 索引时效打叉（不可判定即按过期处理，不默认当新鲜）", async () => {
		const root = await seed();
		const catalogPath = join(root, "cdn", "catalog.yaml");
		const doc = parse(readFileSync(catalogPath, "utf-8")) as Record<string, unknown>;
		delete doc.issued_at;
		delete doc.expires_at;
		writeFileSync(catalogPath, stringify(doc), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "索引时效")?.ok).toBe(false);
		expect(itemOf(result, "索引时效")?.code).toBe("index_expired");
	});
});

describe("given 落了 tgz 但没重建索引 When 带 --rebuild-check 验包", () => {
	it("then 报漂移：索引缺该包条目", async () => {
		const root = newProject();
		await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });
		await publishPackage({ projectRoot: root, fixture: "other-solution@0.1.0", id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });

		const result = await verifyMarket({ projectRoot: root, rebuildCheck: true });

		expect(result.drift?.length ?? 0).toBeGreaterThan(0);
		expect(result.drift?.join(" ")).toMatch(/other-solution/);
	});
});

describe("given 索引声明了某个版本但盘上包没了 When 带 --rebuild-check 验包", () => {
	it("then 报反向漂移：索引多条目（只查正向会让「答应有、实际没有」漏过去）", async () => {
		const root = await seed();
		rmSync(join(root, "cdn", "demo-solution-0.1.0.tgz"));

		const result = await verifyMarket({ projectRoot: root, rebuildCheck: true });

		expect(result.drift?.join(" ")).toMatch(/索引多条目：demo-solution@0\.1\.0/);
	});
});
