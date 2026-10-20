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

function itemOf(result: Awaited<ReturnType<typeof verifyMarket>>, name: string): { ok: boolean, detail: string } | undefined {
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
