import type { VerifyCheck } from "../verify";
// ojm market verify spec（A6 瘦身）：离线验包——不起站点、不装、不要凭据。
//
// v4 DB 目录化后只剩**包级面**（计划退役清单点名）：包级 detached 验签（信任锚）+
// manifest 结构（必填字段 / 原生清单 desc / 0001 迁移跨版本一致）。索引面（索引验签 /
// 同代 / 时效 / 漂移 / 对索引声明的完整性比对）随索引机制整建制退役——目录真源已移交
// 站点 market_release 表，字节-声明一致性由上传端点服务端重算 sha256 在写通道守住。
// 结论恒带边界声明——验签过 ≠ 代码无恶意，这一点写错比校验写错更危险。
import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { createDeterministicTgz } from "../../deterministic-tar";
import { signCommand } from "../../sign";
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

/** 落一个已签名包（本地落盘内部通道——索引重建随 DB 目录化退役），返回工程根 */
async function seed(): Promise<string> {
	const root = newProject();
	await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0", id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });
	return root;
}

function itemOf(result: Awaited<ReturnType<typeof verifyMarket>>, name: string): VerifyCheck | undefined {
	return result.checks.find(c => c.item === name);
}

describe("given 一个正常落地的包 When 离线验包", () => {
	it("then 包级面校验全绿（包级签名 + manifest 结构）且结论带边界声明", async () => {
		const root = await seed();

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(true);
		expect(itemOf(result, "包级签名")?.ok).toBe(true);
		expect(itemOf(result, "manifest 结构")?.ok).toBe(true);
		expect(result.conclusion).toContain("不构成内容安全性背书");
	});
});

describe("given 真实工程包（manifest 按 C2-29 整体省略 archive 占位）When 离线验包", () => {
	it("then manifest 结构不因此打叉（REG-CS8 回归：ojm build --bundle 不落 archive ≠ 缺必填）", async () => {
		const root = await seed();
		const tgz = join(root, "cdn", "demo-solution-0.1.0.tgz");
		// 解包 → 摘掉根 manifest 的 archive（fixture 有、真实方案无的字段差）→ 确定性重打包 → 重签
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

		const result = await verifyMarket({ projectRoot: root });

		expect(itemOf(result, "manifest 结构")?.ok).toBe(true);
		rmSync(staging, { recursive: true, force: true });
	});
});

describe("given 预发布版本（文件名含连字符）包体被篡改 When 离线验包", () => {
	it("then 包级签名仍检出篡改（重算 sha256 重构规范串，验签不过——内容寻址不以文件名解析为前提）", async () => {
		const root = newProject();
		await publishPackage({ projectRoot: root, fixture: "demo-solution@0.1.0-rc.1", id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });
		const tgz = join(root, "cdn", "demo-solution-0.1.0-rc.1.tgz");
		const buf = readFileSync(tgz);
		buf[buf.length - 1] ^= 0xFF; // 篡改末字节
		writeFileSync(tgz, buf);
		const result = await verifyMarket({ projectRoot: root });
		expect(itemOf(result, "包级签名")?.ok).toBe(false);
	});
});

describe("given 包体被改了一个字节 When 离线验包", () => {
	it("then 包级签名打叉（signature_mismatch：sha256 重算后与签名覆盖值不符）", async () => {
		const root = await seed();
		const tgz = join(root, "cdn", "demo-solution-0.1.0.tgz");
		const bytes = Buffer.from(readFileSync(tgz));
		bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xFF;
		writeFileSync(tgz, bytes);

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(false);
		expect(itemOf(result, "包级签名")?.ok).toBe(false);
	});
});

describe("given 包级签名被删掉 When 离线验包", () => {
	it("then 包级签名打叉并给出 sig_missing 口径的指引", async () => {
		const root = await seed();
		const tgz = join(root, "cdn", "demo-solution-0.1.0.tgz");
		rmSync(`${tgz}.sig`);

		const result = await verifyMarket({ projectRoot: root });

		const check = itemOf(result, "包级签名");
		expect(check?.ok).toBe(false);
		expect(check?.code).toBe("sig_missing");
		expect(check?.detail).toContain("ojm market publish");
	});
});

describe("given 索引文件被手改/删除 When 离线验包（A6：索引面已退役）", () => {
	it("then 校验结果不受影响——目录真源在站点 DB，盘上索引文件已非消费面", async () => {
		const root = await seed();
		// 即便盘上残留旧索引文件（升级未清理），verify 也绝不再消费它们
		writeFileSync(join(root, "cdn", "catalog.yaml"), "tampered: true\n");

		const result = await verifyMarket({ projectRoot: root });

		expect(result.passed).toBe(true);
		expect(result.checks.some(c => c.item === "索引签名")).toBe(false);
		expect(result.checks.some(c => c.item === "索引同代")).toBe(false);
		expect(result.checks.some(c => c.item === "索引时效")).toBe(false);
	});
});

describe("given 同方案两个版本的 0001 迁移不一致 When 离线验包", () => {
	it("then manifest 结构项打叉（升级链会报迁移缺失，须只增不改）", async () => {
		const root = await seed();
		await publishPackage({ projectRoot: root, fixture: "demo-solution@0.2.0", id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });
		// 篡改 0.2.0 包的 0001 迁移字节（解包重打 + 重签，保持包可解）
		const tgz = join(root, "cdn", "demo-solution-0.2.0.tgz");
		const staging = mkdtempSync(join(tmpdir(), "ojm-verify-mig-"));
		for (const e of readTgz(new Uint8Array(readFileSync(tgz)))) {
			if (e.name.endsWith("/"))
				continue;
			const abs = join(staging, e.name);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, /\/migrations\/0001[^/]*\.sql$/.test(e.name) ? `${e.content}-- tampered\n` : e.content);
		}
		await createDeterministicTgz(staging, tgz);
		signCommand(tgz, { id: KEY_ID, privateKeyPem: testPem(), registryId: REGISTRY_ID });
		rmSync(staging, { recursive: true, force: true });

		const result = await verifyMarket({ projectRoot: root });

		const mig = result.checks.find(c => c.item === "manifest 结构" && c.detail.includes("0001 迁移在版本"));
		expect(mig?.ok).toBe(false);
		expect(mig?.detail).toContain("0.2.0");
	});
});
