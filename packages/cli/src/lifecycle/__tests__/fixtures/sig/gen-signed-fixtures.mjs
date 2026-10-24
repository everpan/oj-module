#!/usr/bin/env node
import { Buffer } from "node:buffer";
/**
 * 签名链测试夹具生成器（P2-0，契约 v1.3 §2.11/§2.12 + 附录 A.2）。
 *
 * 为什么自包含（仅 node: 内建、不 import 仓库 TS）：夹具要被两个 vitest 项目消费
 * （packages/cli 与 packages/cli/templates/api 各自 root 锚定），.mjs 是两端都能直接
 * import/spawn 的唯一形态；签名逻辑（规范串/sign）与 P2-1 的 sign.ts 同语义，
 * 由 P2-1 spec「Node 对拍 + 夹具验签」钉住逐字一致（DRY 锚点在测试而非本文件重复实现）。
 *
 * 确定性（提交为产物后可重复再生）：
 * - 测试 key 由公开 seed 常量经 SHA-256 派生 32B → PKCS#8 DER 包裹 → Ed25519
 *   （seed 公开 = 测试 key 无保密性，私钥永不入仓——P2-12「模板/夹具不得含私钥」的前提）；
 * - ustar 手写（mtime=0、成员字典序、0644/0755、uid/gid=0、无 owner 名）+
 *   Node zlib gzip（头内 MTIME/FNAME 恒 0，同 deterministic-tar.ts 口径）。
 *
 * 产物（outDir，缺省 = 本文件所在目录）：
 * - demo-solution-0.2.0.tgz                  共用包体（Form A，禁带 sha256/signature）
 * - demo-solution-0.2.0.tz.sig               已签（TRUSTED_KEY）
 * - demo-solution-0.2.0.tgz.bad.sig          篡改（value 首字符翻转，仍是合法标准 base64 → tampered 而非 sig_format）
 * - demo-solution-0.2.0.tgz.unknown.sig      未知 key 签名（UNKNOWN_KEY，key_id 不在任何信任库）
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_NAME = "demo-solution";
export const FIXTURE_VERSION = "0.2.0";
/** 规范串版本标记（REG-CS3 v2：canon 字段恒 "v2"） */
export const CANON = "v2";
/** 夹具签发方 registry 身份（REG-CS3 v2 规范串首段，跨仓重放判定真源） */
export const FIXTURE_REGISTRY_ID = "test.registry";
const SEED_PREFIX = "ojm-lifecycle-fixture-v1:";

/** REG-CS3 v2 规范串格式（逐字：`<registry_id>:<slug>@<version>:<sha256>`） */
export function canonicalString(registryId, slug, version, sha256) {
	return `${registryId}:${slug}@${version}:${sha256}`;
}

/** 指纹 = sha256Hex(publicKey) 全 64 hex（契约 §2.11，UI 分组展示用） */
export function fingerprintOf(publicKeyHex) {
	return createHash("sha256").update(Buffer.from(publicKeyHex, "hex")).digest("hex");
}

/** 标准 base64 编码的 Ed25519 签名（契约 §2.11：value 仅标准 base64，禁 base64url） */
export function signCanonicalB64(privateKey, canonical) {
	return sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
}

/** Node 侧验签（与 P2-1 verifyCanonical / P2-3 crypto.verifyEd25519 三方同语义） */
export function verifyCanonicalB64(publicKeyHex, canonical, valueB64) {
	const publicKey = createPublicKey({
		key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]),
		format: "der",
		type: "spki",
	});
	return verify(null, Buffer.from(canonical, "utf8"), publicKey, Buffer.from(valueB64, "base64"));
}

function deriveKeyPair(label) {
	const seed = createHash("sha256").update(SEED_PREFIX + label).digest(); // 32B raw seed
	const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
	const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
	const jwk = createPublicKey(privateKey).export({ format: "jwk" });
	return { privateKey, publicKeyHex: Buffer.from(jwk.x, "base64url").toString("hex") };
}

const trusted = deriveKeyPair("trusted");
const unknown = deriveKeyPair("unknown");

/** 已信任测试 key（key_id 满足 §2.11 命名空间 <publisher>.<id>） */
export const TRUSTED_KEY = { key_id: "ojm.test", public_key_hex: trusted.publicKeyHex };
/** 未知发布方测试 key（签名合法但 key_id 不在信任库 → unknown_key/needs_trust 场景） */
export const UNKNOWN_KEY = { key_id: "stranger.unknown", public_key_hex: unknown.publicKeyHex };

// ── 确定性 ustar tgz（最小形态：目录成员在子成员之前、字典序）──────────────────

const BLOCK = 512;
const RECORD = 20 * BLOCK;

function octal(n, width) {
	return `${n.toString(8).padStart(width - 1, "0")}\0`;
}

function header(relPath, size, typeflag) {
	const h = Buffer.alloc(BLOCK);
	h.write(relPath, 0, 100, "utf8");
	h.write(typeflag === "5" ? "0000755\0" : "0000644\0", 100, 8, "utf8");
	h.write("0000000\0", 108, 8, "utf8"); // uid
	h.write("0000000\0", 116, 8, "utf8"); // gid
	h.write(octal(size, 12), 124, 12, "utf8");
	h.write("00000000000\0", 136, 12, "utf8"); // mtime=0
	h.write("        ", 148, 8, "utf8"); // chksum 占位（空格）
	h.write(typeflag, 156, 1, "utf8");
	h.write("ustar\0", 257, 6, "utf8");
	h.write("00", 263, 2, "utf8");
	let sum = 0;
	for (const b of h) sum += b;
	h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
	return h;
}

function buildTgz(members) {
	const body = [];
	for (const m of members) {
		body.push(header(m.path, m.content ? m.content.length : 0, m.content ? "0" : "5"));
		if (m.content) {
			body.push(m.content);
			const pad = (BLOCK - (m.content.length % BLOCK)) % BLOCK;
			if (pad > 0)
				body.push(Buffer.alloc(pad));
		}
	}
	body.push(Buffer.alloc(RECORD)); // 双零块 EOF + 补齐整记录
	return gzipSync(Buffer.concat(body));
}

const BUNDLE_MANIFEST = `# 签名链测试夹具（P2-0，契约 v1.3）——Form A：禁带 sha256/size/signature（B-2 自引用悖论）
name: ${FIXTURE_NAME}
version: ${FIXTURE_VERSION}
title: 签名链夹具
summary: detached .sig 验签/TOFU/吊销场景共用包体
changelog:
  - ${FIXTURE_VERSION} 签名链夹具版本
`;

const MODULE_MANIFEST = `name: ${FIXTURE_NAME}
desc: detached .sig 验签/TOFU/吊销场景共用包体
version: ${FIXTURE_VERSION}
`;

function fixtureMembers() {
	const root = `${FIXTURE_NAME}-${FIXTURE_VERSION}`;
	const members = [
		{ path: `${root}/` },
		{ path: `${root}/manifest.yaml`, content: Buffer.from(BUNDLE_MANIFEST, "utf8") },
		{ path: `${root}/api/` },
		{ path: `${root}/api/${root}/` },
		{ path: `${root}/api/${root}/manifest.yaml`, content: Buffer.from(MODULE_MANIFEST, "utf8") },
	];
	members.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return members;
}

function tamperFirstChar(valueB64) {
	return (valueB64[0] === "A" ? "B" : "A") + valueB64.slice(1);
}

/**
 * 生成全部夹具到 outDir，返回摘要（sha256/canonical/各 .sig 路径）。
 * 幂等且确定：同版本生成器对同 outDir 重复运行字节一致。
 */
export function generate(outDir = FIXTURE_DIR) {
	const tgz = buildTgz(fixtureMembers());
	const sha256 = createHash("sha256").update(tgz).digest("hex");
	const canonical = canonicalString(FIXTURE_REGISTRY_ID, FIXTURE_NAME, FIXTURE_VERSION, sha256);

	const sigOf = (keyId, publicKeyHex, privateKey) => ({
		alg: "Ed25519",
		key_id: keyId,
		public_key: publicKeyHex,
		value: signCanonicalB64(privateKey, canonical),
		canon: CANON,
		registry_id: FIXTURE_REGISTRY_ID,
	});

	const good = sigOf(TRUSTED_KEY.key_id, TRUSTED_KEY.public_key_hex, trusted.privateKey);
	const bad = { ...good, value: tamperFirstChar(good.value) };
	const unknownSig = sigOf(UNKNOWN_KEY.key_id, UNKNOWN_KEY.public_key_hex, unknown.privateKey);

	fs.mkdirSync(outDir, { recursive: true });
	const tgzPath = path.join(outDir, `${FIXTURE_NAME}-${FIXTURE_VERSION}.tgz`);
	const writeSig = (suffix, obj) => {
		const p = `${tgzPath}${suffix}`;
		fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
		return p;
	};
	fs.writeFileSync(tgzPath, tgz);
	const paths = {
		tgz: tgzPath,
		good: writeSig(".sig", good),
		bad: writeSig(".bad.sig", bad),
		unknown: writeSig(".unknown.sig", unknownSig),
	};
	return { sha256, canonical, tgzPath, paths, sig: { good, bad, unknown: unknownSig } };
}

// 直接运行 = 再生成本目录产物（CI/人工复核用）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const r = generate();
	console.log(`[gen-signed-fixtures] ${FIXTURE_NAME}-${FIXTURE_VERSION}.tgz sha256=${r.sha256}`);
	console.log(`[gen-signed-fixtures] canonical=${r.canonical}`);
	console.log(`[gen-signed-fixtures] trusted=${TRUSTED_KEY.key_id} fp=${fingerprintOf(TRUSTED_KEY.public_key_hex)}`);
	console.log(`[gen-signed-fixtures] unknown=${UNKNOWN_KEY.key_id} fp=${fingerprintOf(UNKNOWN_KEY.public_key_hex)}`);
}
