// 签名链夹具 CLI 面断言（P2-0，契约 v1.3 §2.11/§2.12 + 附录 A.2）。
// 锚点语义：夹具是双端唯一共同真源——本 spec 钉「规范串逐字 + 指纹值 + 验签结果」，
// 与 P2-1 sign.ts（Node 对拍）、P2-3 steps/verify.ts（isolate 面 verifyEd25519）三方同语义。
// 六码（sig_missing/sig_alg/sig_key/tampered/unknown_key/sig_format）的 isolate 实现与
// TOFU 全链属 P2-3 验收；此处只钉夹具本身与 Node 面计算。
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	CANON,
	canonicalString,
	fingerprintOf,
	FIXTURE_NAME,
	FIXTURE_VERSION,
	generate,
	TRUSTED_KEY,
	UNKNOWN_KEY,
	verifyCanonicalB64,
} from "./fixtures/sig/gen-signed-fixtures.mjs";

const SIG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sig");
const tgzPath = path.join(SIG_DIR, `${FIXTURE_NAME}-${FIXTURE_VERSION}.tgz`);

interface Sig {
	alg: string
	key_id: string
	public_key: string
	value: string
	canon: string
}

const readSig = (suffix: string): Sig => JSON.parse(readFileSync(`${tgzPath}${suffix}`, "utf8")) as Sig;

const HEX64 = /^[0-9a-f]{64}$/;
const STD_B64 = /^[A-Z0-9+/]+={0,2}$/i;
// 契约 §2.11 key_id 命名空间：<publisher>.<id> 全小写，禁裸通用名单段
const KEY_ID = /^[a-z][a-z0-9-]*\.[a-z0-9-]+$/;

describe("签名链夹具（P2-0）", () => {
	const tgz = readFileSync(tgzPath);
	const sha256 = createHash("sha256").update(tgz).digest("hex");
	const canonical = canonicalString(FIXTURE_NAME, FIXTURE_VERSION, sha256);
	const good = readSig(".sig");
	const bad = readSig(".bad.sig");
	const unknownSig = readSig(".unknown.sig");

	it("规范串逐字 = <name>@<version>:<sha256>（契约 §2.11 格式表）", () => {
		expect(canonical).toBe(`${FIXTURE_NAME}@${FIXTURE_VERSION}:${sha256}`);
		expect(canonical).toMatch(/^demo-solution@0\.2\.0:[0-9a-f]{64}$/);
	});

	it(".sig 五字段齐备且形态合法（alg 恒 Ed25519 / canon 恒 v1）", () => {
		for (const sig of [good, bad, unknownSig]) {
			expect(sig.alg).toBe("Ed25519");
			expect(sig.canon).toBe(CANON);
			expect(sig.public_key).toMatch(HEX64);
			expect(sig.value).toMatch(STD_B64);
			expect(sig.value).not.toMatch(/[-_]/); // 禁 base64url（§2.11 编码约束）
			expect(sig.key_id).toMatch(KEY_ID);
		}
	});

	it("指纹 = sha256Hex(publicKey) 全 64 hex", () => {
		expect(fingerprintOf(good.public_key)).toMatch(HEX64);
		expect(fingerprintOf(unknownSig.public_key)).toMatch(HEX64);
		expect(fingerprintOf(good.public_key)).not.toBe(fingerprintOf(unknownSig.public_key));
	});

	it("已签夹具验签通过；篡改 value / 错 key / 篡改包体均拒", () => {
		expect(verifyCanonicalB64(good.public_key, canonical, good.value)).toBe(true);
		expect(verifyCanonicalB64(bad.public_key, canonical, bad.value)).toBe(false); // tampered
		expect(verifyCanonicalB64(good.public_key, canonical, unknownSig.value)).toBe(false); // 错 key
		const tampered = Buffer.from(tgz);
		tampered[100] ^= 0xFF;
		const sha2 = createHash("sha256").update(tampered).digest("hex");
		expect(verifyCanonicalB64(good.public_key, canonicalString(FIXTURE_NAME, FIXTURE_VERSION, sha2), good.value)).toBe(false);
	});

	it("未知 key 夹具是真实签名但 key_id 不在信任库（TOFU 场景锚点）", () => {
		expect(unknownSig.key_id).toBe(UNKNOWN_KEY.key_id);
		expect(unknownSig.public_key).toBe(UNKNOWN_KEY.public_key_hex);
		expect(verifyCanonicalB64(unknownSig.public_key, canonical, unknownSig.value)).toBe(true);
		expect(unknownSig.key_id).not.toBe(TRUSTED_KEY.key_id);
	});

	it("生成器确定性：再生到 tmp 与提交产物字节一致", () => {
		const out = path.join(os.tmpdir(), `ojm-sig-fixtures-${process.pid}`);
		const r = generate(out);
		expect(r.sha256).toBe(sha256);
		expect(r.canonical).toBe(canonical);
		expect(readFileSync(r.paths.tgz).equals(tgz)).toBe(true);
		expect(readFileSync(r.paths.good, "utf8")).toBe(readFileSync(`${tgzPath}.sig`, "utf8"));
		expect(readFileSync(r.paths.bad, "utf8")).toBe(readFileSync(`${tgzPath}.bad.sig`, "utf8"));
		expect(readFileSync(r.paths.unknown, "utf8")).toBe(readFileSync(`${tgzPath}.unknown.sig`, "utf8"));
	});
});
