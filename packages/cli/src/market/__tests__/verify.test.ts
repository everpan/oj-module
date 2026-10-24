import type { VerifyCheck } from "../verify";
// ojm market verify spec（T7）：离线验包——不起站点、不装、不要凭据。
//
// 钉死两条：① 四类校验分列（完整性 / 包级签 / 索引签 / 结构），篡改任一项都必须在对应项上打叉；
// ② 结论恒带边界声明——验签过 ≠ 代码无恶意，这一点写错比校验写错更危险。
import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { signIndex } from "../../publish";
import { buildIndex } from "../build-index";
import { publishPackage } from "../publish";
import { verifyMarket } from "../verify";

const MOUNTS = "  - prefix: /api\n    api: src\n  - prefix: /cdn\n    web: ../cdn\n";
const CONFIG = `mounts:\n${MOUNTS}server:\n  host: 127.0.0.1\n  port: 9778\n`;
const KEY_ID = "demo.publisher";

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
	await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: testPem() });
	await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });
	return root;
}

function itemOf(result: Awaited<ReturnType<typeof verifyMarket>>, name: string): VerifyCheck | undefined {
	return result.checks.find(c => c.item === name);
}

describe("given 一个正常落地的包 When 离线验包", () => {
	it("then 四类校验全绿且结论带边界声明", async () => {
		const root = await seed();

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(true);
		expect(itemOf(result, "完整性")?.ok).toBe(true);
		expect(itemOf(result, "包级签名")?.ok).toBe(true);
		expect(itemOf(result, "索引签名")?.ok).toBe(true);
		expect(itemOf(result, "manifest 结构")?.ok).toBe(true);
		expect(result.conclusion).toContain("不构成内容安全性背书");
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

describe("given 索引被手改过 When 离线验包", () => {
	it("then 索引签名打叉（索引签名是完整性层，篡改必须可见）", async () => {
		const root = await seed();
		const bundles = join(root, "cdn", "bundles.yaml");
		writeFileSync(bundles, `${readFileSync(bundles, "utf-8")}\n# tampered\n`);

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "索引签名")?.ok).toBe(false);
		// REG-CS1：篡改与缺失必须可分（前者是安全事件，后者是发布流程漏了）
		expect(itemOf(result, "索引签名")?.code).toBe("index_sig_mismatch");
	});
});

describe("given 索引缺 .sig When 离线验包", () => {
	it("then 索引签名打叉 index_sig_missing 并给两步补签提示（不再「运行期容忍」）", async () => {
		const root = await seed();
		rmSync(join(root, "cdn", "bundles.yaml.sig"));
		rmSync(join(root, "cdn", "manifests.yaml.sig"));

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		const item = itemOf(result, "索引签名");
		expect(item?.ok).toBe(false);
		expect(item?.code).toBe("index_sig_missing");
		expect(item?.detail).toContain("ojm market build-index");
		expect(item?.detail).toContain("ojm publish");
	});
});

describe("given 总目录与聚合清单不是同一代 When 离线验包", () => {
	it("then 报 index_generation_mismatch 并提示「源正在重建索引」（不是「索引被篡改」）", async () => {
		const root = await seed();
		// 模拟「总目录已是第 7 代、聚合清单还停在第 1 代」（写索引写到一半的中间态）
		const bundles = join(root, "cdn", "bundles.yaml");
		writeFileSync(bundles, readFileSync(bundles, "utf-8").replace(/^seq: \d+$/m, "seq: 7"), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		const item = itemOf(result, "索引同代");
		expect(item?.ok).toBe(false);
		expect(item?.code).toBe("index_generation_mismatch");
		expect(item?.detail).toContain("源正在重建索引，请稍后重试");
		expect(item?.detail).not.toContain("被篡改");
	});
});

describe("given 索引正文被换了代 When 离线验包", () => {
	it("then 报 index_generation_mismatch（改了正文没换签名也不放过）", async () => {
		const root = await seed();
		const bundles = join(root, "cdn", "bundles.yaml");
		writeFileSync(bundles, readFileSync(bundles, "utf-8").replace(/^seq: \d+$/m, "seq: 99"), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		const item = itemOf(result, "索引同代");
		expect(item?.ok).toBe(false);
		expect(item?.code).toBe("index_generation_mismatch");
	});
});

describe("given 索引的 .sig 被删掉 When 离线验包", () => {
	it("then 索引签名打叉并报 index_sig_missing（REG-CS1①：缺签即拒，不再运行期容忍）", async () => {
		const root = await seed();
		rmSync(join(root, "cdn", "bundles.yaml.sig"));

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		expect(itemOf(result, "索引签名")?.ok).toBe(false);
		expect(itemOf(result, "索引签名")?.code).toBe("index_sig_missing");
	});
});

describe("given 索引签名是旧格式（不带 seq）When 离线验包", () => {
	it("then 索引签名打叉并报 index_sig_mismatch（签名未覆盖代次 = 挡不住新旧拼接）", async () => {
		const root = await seed();
		const sigPath = join(root, "cdn", "bundles.yaml.sig");
		const sig = JSON.parse(readFileSync(sigPath, "utf-8")) as Record<string, unknown>;
		delete sig.seq;
		writeFileSync(sigPath, JSON.stringify(sig), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "索引签名")?.code).toBe("index_sig_mismatch");
	});
});

describe("given 索引写到一半留下中间态（新总目录 + 旧分册）When 离线验包", () => {
	it("then 同代校验打叉报 index_generation_mismatch（红队 F2：拼不进，且按运维事故提示重试）", async () => {
		const root = await seed();
		const manifestsPath = join(root, "cdn", "manifests.yaml");
		const manifestsText = readFileSync(manifestsPath, "utf-8");
		// 分册用第 2 代重签（签名本身有效），总目录仍是第 1 代
		writeFileSync(
			join(root, "cdn", "manifests.yaml.sig"),
			JSON.stringify(signIndex("manifests", 2, manifestsText, testPem(), KEY_ID)),
			"utf-8",
		);

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "索引同代")?.ok).toBe(false);
		expect(itemOf(result, "索引同代")?.code).toBe("index_generation_mismatch");
		expect(itemOf(result, "索引同代")?.detail).toContain("源正在重建索引，请稍后重试");
	});
});

describe("given 索引已过自声明的失效时刻 When 离线验包", () => {
	it("then 索引时效打叉报 index_expired（REG-CS2：与站点安装同一判定，CLI/API 一致）", async () => {
		const root = await seed();
		const bundlesPath = join(root, "cdn", "bundles.yaml");
		const doc = parse(readFileSync(bundlesPath, "utf-8")) as Record<string, unknown>;
		doc.issued_at = 1;
		doc.expires_at = 2;
		writeFileSync(bundlesPath, stringify(doc), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "索引时效")?.ok).toBe(false);
		expect(itemOf(result, "索引时效")?.code).toBe("index_expired");
	});
});

describe("given 索引不带时效字段（旧 ojm 产物）When 离线验包", () => {
	it("then 索引时效打叉（不可判定即按过期处理，不默认当新鲜）", async () => {
		const root = await seed();
		const bundlesPath = join(root, "cdn", "bundles.yaml");
		const doc = parse(readFileSync(bundlesPath, "utf-8")) as Record<string, unknown>;
		delete doc.issued_at;
		delete doc.expires_at;
		writeFileSync(bundlesPath, stringify(doc), "utf-8");

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "索引时效")?.ok).toBe(false);
		expect(itemOf(result, "索引时效")?.code).toBe("index_expired");
	});
});

describe("given 落了 tgz 但没重建索引 When 带 --rebuild-check 验包", () => {
	it("then 报漂移：索引缺该包条目", async () => {
		const root = newProject();
		await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: testPem() });
		await buildIndex({ projectRoot: root, id: KEY_ID, privateKeyPem: testPem() });
		await publishPackage({ projectRoot: root, fixture: "other-solution@0.1.0", id: KEY_ID, privateKeyPem: testPem() });

		const result = await verifyMarket({ projectRoot: root, rebuildCheck: true });

		expect(result.drift?.length ?? 0).toBeGreaterThan(0);
		expect(result.drift?.join(" ")).toMatch(/other-solution/);
	});
});
