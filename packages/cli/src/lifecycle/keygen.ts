// 密钥工具（P2-1）：Ed25519 密钥对生成与 PEM 读写。
// 与 sign.ts 的分界（SRP）：sign.ts 管「签/验/规范串」语义，本文件管「key 生命周期」。
// CLI 命令接线（ojm keygen 的 --out 警告/0600 落盘）属 P2-4；此处只交付纯函数面。
// 站点既有 RSA cert 对 / X25519 secrets 对不可复用（算法不符、per-site、已暴露）——
// bootstrap key 与本工具一律新生成 Ed25519（执行计划 §0 bootstrap key 定性）。
import type { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";

export interface KeyPair {
	/** 32B raw 公钥 hex（契约 C2-35 public_key 字段口径） */
	publicKeyHex: string
	/** PKCS#8 PEM 私钥（写盘 0600；永不入日志/任务记录——P2-5 redact 钉面） */
	privateKeyPem: string
}

/** 生成 Ed25519 密钥对（Node 侧唯一入口；确定性由 Ed25519 算法本身保证同 key 同签） */
export function generateKeyPair(): KeyPair {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
		publicKeyEncoding: { format: "der", type: "spki" },
		privateKeyEncoding: { format: "pem", type: "pkcs8" },
	});
	const spki = publicKey as Buffer;
	const raw = spki.subarray(spki.length - 32);
	return { publicKeyHex: raw.toString("hex"), privateKeyPem: privateKey as string };
}

/** 从 PEM 文件加载私钥（不存在/形状错抛可读错误——fail-closed 不做静默回落） */
export function readPrivateKeyPem(file: string): string {
	let pem: string;
	try {
		pem = readFileSync(file, "utf8");
	}
	catch (e) {
		throw new Error(`[ojm] 私钥文件读取失败：${file}（${String(e)}）`);
	}
	if (!pem.includes("PRIVATE KEY"))
		throw new Error(`[ojm] 不是合法 PEM 私钥文件：${file}`);
	return pem;
}
