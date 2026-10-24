// 签名链夹具 templates 面断言（P2-0，契约 v1.3 §2.11/§2.12 + 附录 A.2）。
// 与 CLI 面（packages/cli/src/lifecycle/__tests__/sig-fixtures.test.ts）共用同一组提交产物：
// 本 spec 证明夹具从 templates 测试 root 可达、可再生且字节一致（双端三同一的夹具侧锚点）。
// isolate 生产面（steps/verify.ts + CryptoFace.verifyEd25519）对同组夹具的六码/TOFU 断言属 P2-3。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIG_DIR = path.resolve(HERE, "../../../src/lifecycle/__tests__/fixtures/sig");
const GEN = path.join(SIG_DIR, "gen-signed-fixtures.mjs");

const HEX64 = /^[0-9a-f]{64}$/;
const STD_B64 = /^[A-Z0-9+/]+={0,2}$/i;
const KEY_ID = /^[a-z][a-z0-9-]*\.[a-z0-9-]+$/;

const gen = (await import(GEN)) as {
	FIXTURE_NAME: string
	FIXTURE_VERSION: string
	FIXTURE_REGISTRY_ID: string
	CANON: string
	canonicalString: (registryId: string, name: string, version: string, sha256: string) => string
	fingerprintOf: (publicKeyHex: string) => string
	generate: (outDir: string) => { sha256: string, canonical: string, paths: Record<string, string> }
};

describe("签名链夹具 · templates 面可达性与再生一致性（P2-0）", () => {
	const name = gen.FIXTURE_NAME;
	const version = gen.FIXTURE_VERSION;
	const registryId = gen.FIXTURE_REGISTRY_ID;
	const tgzPath = path.join(SIG_DIR, `${name}-${version}.tgz`);
	const tgz = readFileSync(tgzPath);
	const sha256 = createHash("sha256").update(tgz).digest("hex");

	it("三枚 .sig 从 templates 测试 root 可达且字段形态合法", () => {
		for (const suffix of [".sig", ".bad.sig", ".unknown.sig"]) {
			const sig = JSON.parse(readFileSync(`${tgzPath}${suffix}`, "utf8")) as Record<string, string>;
			expect(sig.alg).toBe("Ed25519");
			expect(sig.canon).toBe(gen.CANON);
			expect(sig.registry_id).toBe(registryId);
			expect(sig.public_key).toMatch(HEX64);
			expect(sig.value).toMatch(STD_B64);
			expect(sig.value).not.toMatch(/[-_]/);
			expect(sig.key_id).toMatch(KEY_ID);
		}
	});

	it("规范串与指纹从 templates 面计算与提交产物一致（三同一的夹具侧）", () => {
		const canonical = gen.canonicalString(registryId, name, version, sha256);
		expect(canonical).toBe(`${registryId}:${name}@${version}:${sha256}`);
		const sig = JSON.parse(readFileSync(`${tgzPath}.sig`, "utf8")) as { public_key: string };
		expect(gen.fingerprintOf(sig.public_key)).toMatch(HEX64);
	});

	it("生成器跨 root 再生到 tmp 与提交产物字节一致（双端共用同一生成逻辑）", () => {
		const out = path.join(os.tmpdir(), `ojm-sig-fixtures-tpl-${process.pid}`);
		const r = gen.generate(out);
		expect(r.sha256).toBe(sha256);
		expect(r.canonical).toBe(`${registryId}:${name}@${version}:${sha256}`);
		expect(readFileSync(r.paths.tgz).equals(tgz)).toBe(true);
		expect(readFileSync(r.paths.good, "utf8")).toBe(readFileSync(`${tgzPath}.sig`, "utf8"));
		expect(readFileSync(r.paths.bad, "utf8")).toBe(readFileSync(`${tgzPath}.bad.sig`, "utf8"));
		expect(readFileSync(r.paths.unknown, "utf8")).toBe(readFileSync(`${tgzPath}.unknown.sig`, "utf8"));
	});
});
