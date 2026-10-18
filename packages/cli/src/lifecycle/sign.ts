// 签名纯函数（P2-1，契约 v1.3 §2.11 / C2-34~36）。
// 与 oj isolate 侧（P2-3 steps/verify.ts + CryptoFace.verifyEd25519）三方同语义：
// 规范串逐字、编码严格拒（不做归一）、确定性签名。isolate 面无 node:crypto，
// 其实现由上游原语承担；本文件是 Node 侧（ojm sign/深检/夹具）唯一实现，
// 与 isolate 面的一致性由 P2-0 夹具 + 本 spec 的夹具对拍钉住。
import { Buffer } from "node:buffer";
import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";

/** 规范串版本标记（契约 §2.11：canon 字段恒 "v1"） */
export const CANON = "v1";
/** 签名算法标识（大小写敏感，契约 §2.11 / C2-35） */
export const SIG_ALG = "Ed25519";

const HEX64 = /^[0-9a-f]{64}$/;
/** 标准 base64（契约 C2-36：含 -/_ 即 base64url，一律拒，禁归一） */
const STD_B64 = /^[A-Z0-9+/]+={0,2}$/i;
/** Ed25519 SPKI DER 前缀（12B）+ 32B raw 公钥；从 PEM 导出 raw hex 用 */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * 规范串（C2-34，拼接式逐字）：`<name>@<version>:<sha256>`。
 * name/version 取 bundle manifest 值，sha256 = tgz 字节 sha256（hex 小写）；
 * 禁止自造分隔符/归一化/大小写变换——两端与夹具三方逐字一致的前提。
 */
export function canonicalString(name: string, version: string, sha256: string): string {
	return `${name}@${version}:${sha256}`;
}

/** 指纹 = sha256Hex(publicKey) 全 64 hex（契约 §2.11，TOFU 展示用） */
export function fingerprintOfPublicKey(publicKeyHex: string): string {
	if (!HEX64.test(publicKeyHex))
		throw new Error(`[ojm] 公钥不是 64 hex：${publicKeyHex.slice(0, 8)}…`);
	return createHashSha256(Buffer.from(publicKeyHex, "hex"));
}

/** 用私钥 PEM 签规范串，返回标准 base64（C2-35 value 字段口径） */
export function signCanonical(privateKeyPem: string, canonical: string): string {
	const key = createPrivateKey(privateKeyPem);
	return nodeSign(null, Buffer.from(canonical, "utf8"), key).toString("base64");
}

/** 从私钥 PEM 导出 32B raw 公钥 hex（C2-35 public_key 字段口径） */
export function exportRawPublicKeyHex(privateKeyPem: string): string {
	const spki = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: "der", type: "spki" }) as Buffer;
	if (spki.length !== SPKI_PREFIX.length + 32 || !spki.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX))
		throw new Error("[ojm] 私钥不是 Ed25519（SPKI 形状不符）");
	return spki.subarray(SPKI_PREFIX.length).toString("hex");
}

/**
 * 验签（与上游 crypto.verifyEd25519 / Node crypto.verify 同语义）。
 * **严格拒不做归一**：public_key 非 64hex、value 非标准 base64（含 -/_）→ false；
 * 形状合法但验不过 → false。分码（sig_format vs tampered）由调用方结构校验序负责（P2-3）。
 */
export function verifyCanonical(publicKeyHex: string, canonical: string, sigB64: string): boolean {
	if (!HEX64.test(publicKeyHex) || !STD_B64.test(sigB64))
		return false;
	try {
		const key = createPublicKey({
			key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
			format: "der",
			type: "spki",
		});
		return nodeVerify(null, Buffer.from(canonical, "utf8"), key, Buffer.from(sigB64, "base64"));
	}
	catch {
		return false; // 形状逃逸检测的极端输入（如非 base64 解码残留）同样拒
	}
}

// node:crypto 的 sha256 仅指纹一处使用——独立小封装，避免把 hash 面扩散成第二契约
function createHashSha256(data: Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}
