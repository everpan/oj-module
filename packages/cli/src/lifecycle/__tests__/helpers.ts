import type { KeyPair } from "../keygen";
// 签名链测试 helper（P2-1）：测试运行时算摘要与签名，替代硬编码常量。
// 消费方：P2-3 起全部安装路径用例（G4 下未签名夹具必被打红，P2-16 全量改造的替换件）。
import { Buffer } from "node:buffer";
import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";
import { generateKeyPair } from "../keygen";
import { CANON, canonicalString, fingerprintOfPublicKey, SIG_ALG, signCanonical } from "../sign";

/** Ed25519 SPKI DER 前缀（12B）+ 32B raw 公钥 */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Node 侧验签面（上游 crypto.verifyEd25519 的测试替身；同签名同语义：
 * hex 32B 公钥 + UTF-8 msg + 标准 base64 签名；形状非法返回 false 而非抛错——
 * 抛错/返 false 的分码由 verify 段自己负责，替身只当「原语在场」用）。
 */
export function nodeVerifyEd25519(publicKeyHex: string, msg: string, sigB64: string): boolean {
	if (!/^[0-9a-f]{64}$/.test(publicKeyHex) || !/^[A-Z0-9+/]+={0,2}$/i.test(sigB64))
		return false;
	try {
		const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
		return nodeVerify(null, Buffer.from(msg, "utf8"), key, Buffer.from(sigB64, "base64"));
	}
	catch {
		return false;
	}
}

/** detached 侧车 / Form B archive.signature 的字段形状（契约 §2.11 / C2-35，REG-CS3 增 registry_id） */
export interface SigFile {
	alg: string
	key_id: string
	public_key: string
	value: string
	canon: string
	/** 签发方 registry 身份（REG-CS3 v2 规范串首段；跨仓重放判定真源） */
	registry_id: string
}

export interface SignedArchive {
	/** 与包体匹配的 .sig 对象（上传/写盘即此 JSON） */
	sig: SigFile
	keyId: string
	publicKeyHex: string
	fingerprint: string
	/** 生成用的密钥对（测试自行加入信任库或用于未知 key 场景） */
	keyPair: KeyPair
}

let defaultKey: KeyPair | null = null;

/** 进程内稳定的默认测试 key（每测试文件首次用时生成；跨文件不共享——无共享秘密） */
export function defaultTestKey(): KeyPair {
	defaultKey ??= generateKeyPair();
	return defaultKey;
}

/**
 * 对 tgz 字节签名：sha256(bytes) → 规范串（REG-CS3 v2：`<registry_id>:<slug>@<version>:<sha256>`）
 * → Ed25519 → .sig 五字段 + registry_id。
 * `keyPair` 缺省 = defaultTestKey()；传第二个 keyPair 即「未知发布方」场景；`registryId` 缺省 = "test.registry"。
 */
export function signedArchiveFor(tgz: Uint8Array, name: string, version: string, opts?: { keyPair?: KeyPair, keyId?: string, registryId?: string }): SignedArchive {
	const keyPair = opts?.keyPair ?? defaultTestKey();
	const registryId = opts?.registryId ?? "test.registry";
	const sha256 = createHash("sha256").update(tgz).digest("hex");
	const value = signCanonical(keyPair.privateKeyPem, canonicalString(registryId, name, version, sha256));
	return {
		sig: { alg: SIG_ALG, key_id: opts?.keyId ?? "test.publisher", public_key: keyPair.publicKeyHex, value, canon: CANON, registry_id: registryId },
		keyId: opts?.keyId ?? "test.publisher",
		publicKeyHex: keyPair.publicKeyHex,
		fingerprint: fingerprintOfPublicKey(keyPair.publicKeyHex),
		keyPair,
	};
}

/** 便捷重载：直接给 Buffer（node fs 读出的常见形态） */
export function signedArchiveForBuffer(tgz: Buffer, name: string, version: string, opts?: { keyPair?: KeyPair, keyId?: string }): SignedArchive {
	return signedArchiveFor(new Uint8Array(tgz), name, version, opts);
}

export { Buffer };
