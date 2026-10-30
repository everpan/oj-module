// 企微回调加解密原语（手写 SHA-1 / AES-256-CBC）——以 Node/WebCrypto 为唯一对照物：
// 这里不验证「我的实现与我的实现一致」，而是逐字节比对标准实装，避免自洽的错。
// 加密侧走 `crypto.webcrypto.subtle`（AES-CBC 自带 PKCS#7，与企微协议同语义）；
// 不用 `createCipheriv`：本机 Node 22.21 的它对着整块明文 `final()` 仍吐一块（实测 48B→64B），
// 会把「多一块」的差异误记到解密实现账上。
import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import {
	aes256CbcDecrypt,
	b64ToBytes,
	bytesToB64,
	pkcs7Unpad,
	sha1Hex,
	unwrapWecomMessage,
	utf8Bytes,
	wecomSignature,
} from "../src/auth/api/_shared/wecom/crypt";

const req = createRequire(import.meta.url);
const nodeCrypto = req("node:crypto") as typeof import("node:crypto");

const AES_KEY = webcrypto.getRandomValues(new Uint8Array(32));
const IV = webcrypto.getRandomValues(new Uint8Array(16));

/** 标准 AES-256-CBC 加密（WebCrypto 自动加 PKCS#7，与企微一致） */
async function encryptCbc(plain: Uint8Array, key: Uint8Array = AES_KEY, iv: Uint8Array = IV): Promise<Uint8Array> {
	const k = await webcrypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
	return new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-CBC", iv }, k, plain));
}

describe("sha1Hex 对 OpenSSL", () => {
	it("空串与 ASCII", () => {
		expect(sha1Hex("")).toBe(nodeCrypto.createHash("sha1").update("").digest("hex"));
		expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
		expect(sha1Hex("The quick brown fox jumps over the lazy dog")).toBe("2fd4e1c67a2d28fced849ee1bb76e7391b93eb12");
	});

	it("uTF-8 多字节（走 TextEncoder 分流）", () => {
		const s = "企业微信 wecom 中文 🙂";
		expect(sha1Hex(s)).toBe(nodeCrypto.createHash("sha1").update(s, "utf8").digest("hex"));
	});

	it("块边界与跨块长度（1/55/56/63/64/65/119/120/200 字节）", () => {
		for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 200]) {
			const buf = nodeCrypto.randomBytes(n);
			expect(sha1Hex(new Uint8Array(buf))).toBe(nodeCrypto.createHash("sha1").update(buf).digest("hex"));
		}
	});
});

describe("aes256CbcDecrypt 对 WebCrypto", () => {
	it("多种明文长度逐一比对（含整块时补整块填充的边界）", async () => {
		for (const n of [0, 1, 15, 16, 17, 32, 38, 100, 255]) {
			const plain = webcrypto.getRandomValues(new Uint8Array(n));
			const cipher = await encryptCbc(plain);
			const got = aes256CbcDecrypt(cipher, AES_KEY, IV);
			expect(got.length).toBe(cipher.length);
			expect(Buffer.from(pkcs7Unpad(got)).equals(Buffer.from(plain))).toBe(true);
		}
	});

	it("密钥/IV 错则明文不同（防实现自洽：不同钥必须解出不同结果）", async () => {
		const plain = webcrypto.getRandomValues(new Uint8Array(32));
		const cipher = await encryptCbc(plain);
		const wrongKey = webcrypto.getRandomValues(new Uint8Array(32));
		const wrongIv = webcrypto.getRandomValues(new Uint8Array(16));
		expect(Buffer.from(aes256CbcDecrypt(cipher, wrongKey, IV)).equals(Buffer.from(plain))).toBe(false);
		expect(Buffer.from(aes256CbcDecrypt(cipher, AES_KEY, wrongIv)).equals(Buffer.from(plain))).toBe(false);
	});

	it("非法输入硬失败：长度非 16 倍数、空串、IV 长度错、密钥长度错", () => {
		expect(() => aes256CbcDecrypt(new Uint8Array(15), AES_KEY, IV)).toThrow(/multiple of 16/);
		expect(() => aes256CbcDecrypt(new Uint8Array(0), AES_KEY, IV)).toThrow(/multiple of 16/);
		expect(() => aes256CbcDecrypt(new Uint8Array(16), AES_KEY, new Uint8Array(15))).toThrow(/iv must be 16/);
		expect(() => aes256CbcDecrypt(new Uint8Array(16), new Uint8Array(16), IV)).toThrow(/key must be 32/);
	});

	it("pKCS#7 非法填充硬失败（不返回半截明文）", () => {
		expect(() => pkcs7Unpad(new Uint8Array(16))).toThrow(/bad padding/); // 全 0 填充
		const tooBig = new Uint8Array(16).fill(0);
		tooBig[15] = 17;
		expect(() => pkcs7Unpad(tooBig)).toThrow(/bad padding/);
		const inconsistent = new Uint8Array(16).fill(0);
		inconsistent[14] = 3;
		inconsistent[15] = 3;
		expect(() => pkcs7Unpad(inconsistent)).toThrow(/bad padding/);
	});
});

describe("wecomSignature：字典序排序后 sha1", () => {
	it("与手算 OpenSSL 一致（乱序入参同结果）", () => {
		const token = "QDG6eK";
		const ts = "1409659813";
		const nonce = "1372623149";
		const enc = "RypEvHKD8QQKFhvQ6QleEB4J58tiPdvo+rtK1I9qca6aM/wvqnLSV5zE";
		const sig = wecomSignature(token, ts, nonce, enc);
		const manual = nodeCrypto.createHash("sha1")
			.update([token, ts, nonce, enc].sort().join(""), "utf8")
			.digest("hex");
		expect(sig).toBe(manual);
		expect(wecomSignature(enc, nonce, ts, token)).toBe(sig);
		expect(wecomSignature(token, ts, nonce)).not.toBe(sig); // 少一项必须不同
	});
});

describe("unwrapWecomMessage：random(16) | len(4) | msg | receiveid 结构", () => {
	const key = webcrypto.getRandomValues(new Uint8Array(32));
	const encodingAesKey = Buffer.from(key).toString("base64").slice(0, 43);

	/** 按企微明文结构造包并加密（与解密侧严格互逆） */
	async function buildEnvelope(msg: string, receiver: string): Promise<string> {
		const msgBytes = utf8Bytes(msg);
		const recv = utf8Bytes(receiver);
		const body = new Uint8Array(20 + msgBytes.length + recv.length);
		body.set(webcrypto.getRandomValues(new Uint8Array(16)), 0);
		new DataView(body.buffer).setUint32(16, msgBytes.length);
		body.set(msgBytes, 20);
		body.set(recv, 20 + msgBytes.length);
		return bytesToB64(await encryptCbc(body, key, key.subarray(0, 16)));
	}

	it("解出 <xml> 明文，receiver 命中 suite_id", async () => {
		const xml = "<xml><SuiteId>ww123</SuiteId><InfoType>suite_ticket</InfoType><SuiteTicket>abc</SuiteTicket></xml>";
		expect(unwrapWecomMessage(await buildEnvelope(xml, "ww123"), encodingAesKey, "ww123")).toBe(xml);
	});

	it("空 msg 也能解出空串（不把长度 0 当错）", async () => {
		expect(unwrapWecomMessage(await buildEnvelope("", "ww123"), encodingAesKey, "ww123")).toBe("");
	});

	it("uTF-8 明文（中文企业名）不被截坏——长度按字节而非字符", async () => {
		const xml = "<xml><CorpName>示例科技（上海）有限公司</CorpName></xml>";
		expect(unwrapWecomMessage(await buildEnvelope(xml, "ww123"), encodingAesKey, "ww123")).toBe(xml);
	});

	it("receiver 不匹配必须拒（错套件/错钥混用 fail-closed）", async () => {
		const enc = await buildEnvelope("<xml/>", "ww-other");
		expect(() => unwrapWecomMessage(enc, encodingAesKey, "ww123")).toThrow(/receiver mismatch/);
	});

	it("encodingAESKey 非法（长度/字符）必须硬失败", async () => {
		const enc = await buildEnvelope("x", "ww123");
		expect(() => unwrapWecomMessage(enc, `${encodingAesKey.slice(0, 40)}=`, "ww123")).toThrow();
		expect(() => unwrapWecomMessage(enc, "@".repeat(43), "ww123")).toThrow();
	});

	it("密文损坏 → 填充校验硬失败（不返回半截明文）", async () => {
		const bytes = b64ToBytes(await buildEnvelope("hello", "ww123"));
		bytes[bytes.length - 1] ^= 0xFF;
		expect(() => unwrapWecomMessage(bytesToB64(bytes), encodingAesKey, "ww123")).toThrow();
	});
});
