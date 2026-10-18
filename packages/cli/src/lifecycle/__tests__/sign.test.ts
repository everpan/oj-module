// 签名纯函数 spec（P2-1，契约 v1.3 §2.11 / C2-34~36）。BDD 五场景 + 夹具对拍锚点。
import { Buffer } from "node:buffer";
import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../keygen";
import { CANON, canonicalString, exportRawPublicKeyHex, fingerprintOfPublicKey, SIG_ALG, signCanonical, verifyCanonical } from "../sign";
import { FIXTURE_NAME, FIXTURE_VERSION, TRUSTED_KEY, UNKNOWN_KEY } from "./fixtures/sig/gen-signed-fixtures.mjs";
import { defaultTestKey, signedArchiveFor } from "./helpers";

const SHA_A = "a".repeat(64);

describe("规范串（C2-34）", () => {
	it("拼接式逐字 <name>@<version>:<sha256>（契约 §2.11 格式表）", () => {
		expect(canonicalString("demo-solution", "0.2.0", SHA_A)).toBe(`demo-solution@0.2.0:${SHA_A}`);
	});

	it("sha256 形态非法不拦截（规范化属调用方结构校验序，P2-3）", () => {
		// 纯函数只负责拼接；sha256 合法性由 verify 段比对时保证（C2-29 fail-closed）
		expect(canonicalString("a", "1", "short")).toBe("a@1:short");
	});
});

describe("签验往返与对拍", () => {
	const key = generateKeyPair();
	const canonical = canonicalString("demo-solution", "0.1.0", SHA_A);

	it("sign → verifyCanonical 往返 true；篡改 canonical 一字符 → false", () => {
		const sig = signCanonical(key.privateKeyPem, canonical);
		expect(verifyCanonical(key.publicKeyHex, canonical, sig)).toBe(true);
		const tampered = `${canonical.slice(0, -1)}${canonical.at(-1) === "a" ? "b" : "a"}`;
		expect(verifyCanonical(key.publicKeyHex, tampered, sig)).toBe(false);
	});

	it("node crypto.verify 对拍：同 key 同 canonical 同 value，结果一致", () => {
		const sig = signCanonical(key.privateKeyPem, canonical);
		const pub = createPublicKey({
			key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(key.publicKeyHex, "hex")]),
			format: "der",
			type: "spki",
		});
		expect(nodeVerify(null, Buffer.from(canonical, "utf8"), pub, Buffer.from(sig, "base64"))).toBe(
			verifyCanonical(key.publicKeyHex, canonical, sig),
		);
		expect(nodeVerify(null, Buffer.from(canonical, "utf8"), pub, Buffer.from(sig, "base64"))).toBe(true);
	});

	it("确定性：Ed25519 同 key 同 canonical 两次签名相同", () => {
		expect(signCanonical(key.privateKeyPem, canonical)).toBe(signCanonical(key.privateKeyPem, canonical));
	});

	it("公钥导出与指纹：exportRawPublicKeyHex === generateKeyPair.publicKeyHex，指纹 64hex", () => {
		expect(exportRawPublicKeyHex(key.privateKeyPem)).toBe(key.publicKeyHex);
		expect(fingerprintOfPublicKey(key.publicKeyHex)).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("编码面严格拒（C2-36，禁归一）", () => {
	const key = generateKeyPair();
	const canonical = canonicalString("demo-solution", "0.1.0", SHA_A);
	const good = signCanonical(key.privateKeyPem, canonical);

	it("value 含 -/_（base64url 变体）→ false", () => {
		// 必须挑一把 base64 表示里**确实含 +/** 的签名再转 base64url：64 字节签名的
		// base64 有 ~7% 概率不含 +/（88 字符各 2/64），此时 base64url 与原值只差被
		// 抹掉的 padding，而 Node 的 base64 解码对缺 padding 宽容，会还原出同一串
		// 字节使校验返回 true——用例以 ~7% 概率偶发失败（实测 2000 次 7.2%），
		// 且那时「禁归一」的本意根本没被测到。换 key 直到形态真的不同。
		let key = generateKeyPair();
		let sig = signCanonical(key.privateKeyPem, canonical);
		for (let i = 0; !/[+/]/.test(Buffer.from(sig, "base64").toString("base64")) && i < 64; i++) {
			key = generateKeyPair();
			sig = signCanonical(key.privateKeyPem, canonical);
		}
		const b64url = Buffer.from(sig, "base64").toString("base64url");
		expect(b64url).toMatch(/[-_]/); // 形态确实是 base64url（-/_ 替换已发生）
		expect(b64url).not.toBe(sig);
		expect(verifyCanonical(key.publicKeyHex, canonical, b64url)).toBe(false);
	});

	it("public_key 非 64hex（63/65/PEM 串）→ false", () => {
		expect(verifyCanonical(key.publicKeyHex.slice(1), canonical, good)).toBe(false);
		expect(verifyCanonical(`${key.publicKeyHex}0`, canonical, good)).toBe(false);
		expect(verifyCanonical("-----BEGIN PUBLIC KEY-----", canonical, good)).toBe(false);
	});

	it("value 非标准 base64（空串/含 !）→ false", () => {
		expect(verifyCanonical(key.publicKeyHex, canonical, "")).toBe(false);
		expect(verifyCanonical(key.publicKeyHex, canonical, `${good}!`)).toBe(false);
	});

	it("错 key 签名 → false", () => {
		const other = generateKeyPair();
		expect(verifyCanonical(other.publicKeyHex, canonical, good)).toBe(false);
	});
});

describe("p2-0 夹具对拍（双端三同一锚点）", () => {
	const SIG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "sig");
	const tgz = readFileSync(path.join(SIG_DIR, `${FIXTURE_NAME}-${FIXTURE_VERSION}.tgz`));
	const sha256 = createHash("sha256").update(tgz).digest("hex");
	const canonical = canonicalString(FIXTURE_NAME, FIXTURE_VERSION, sha256);
	const readSig = (suffix: string) => JSON.parse(readFileSync(path.join(SIG_DIR, `${FIXTURE_NAME}-${FIXTURE_VERSION}.tgz${suffix}`), "utf8")) as { key_id: string, public_key: string, value: string, canon: string, alg: string };

	it("已签/篡改/未知 key 三态经 sign.ts 验签结果与生成器一致", () => {
		const good = readSig(".sig");
		const bad = readSig(".bad.sig");
		const unknownSig = readSig(".unknown.sig");
		expect([good.alg, good.canon]).toEqual([SIG_ALG, CANON]);
		expect([good.key_id, good.public_key]).toEqual([TRUSTED_KEY.key_id, TRUSTED_KEY.public_key_hex]);
		expect(verifyCanonical(good.public_key, canonical, good.value)).toBe(true);
		expect(verifyCanonical(bad.public_key, canonical, bad.value)).toBe(false);
		expect([unknownSig.key_id, unknownSig.public_key]).toEqual([UNKNOWN_KEY.key_id, UNKNOWN_KEY.public_key_hex]);
		expect(verifyCanonical(unknownSig.public_key, canonical, unknownSig.value)).toBe(true);
	});

	it("signedArchiveFor 对夹具包体重签：验签过且指纹与公钥对应", () => {
		const signed = signedArchiveFor(new Uint8Array(tgz), FIXTURE_NAME, FIXTURE_VERSION);
		expect(signed.sig.canon).toBe(CANON);
		expect(signed.sig.alg).toBe(SIG_ALG);
		expect(signed.sig.public_key).toMatch(/^[0-9a-f]{64}$/);
		expect(verifyCanonical(signed.publicKeyHex, canonical, signed.sig.value)).toBe(true);
		expect(signed.fingerprint).toBe(fingerprintOfPublicKey(signed.publicKeyHex));
	});

	it("defaultTestKey 进程内稳定（同文件多次调用同 key）", () => {
		expect(defaultTestKey().publicKeyHex).toBe(defaultTestKey().publicKeyHex);
	});
});
