// cdn 域共享非入口件（文件名白名单解析 / .sig 旁车五字段 / 入库钳制）：
// api.ts 与 cdn/api.ts 都是路由入口（oj S 规则不可被模块内 import），回填（backfill.ts）
// 与两端共用本文件，勿各写一遍（与 manifestOfUpload 同一管线纪律）。
//
// 为什么在这里而非 _platform：文件名/旁车/钳制的消费方全在 oj-market 模块内
// （_platform 内核不经手发布文件名），归模块私有。

import { isValidKeyId } from "#/_platform/_lifecycle/trust";

// ── 文件名白名单（fail-closed：正则不匹配即 400/跳过，路径逃逸/绝对路径/反斜杠无处通过）──
// name：C2-01（^[a-z][a-z0-9-]{0,63}$，全小写锚）；version：数字开头（semver 生态实况，
// 左起首个「name 合法且版本段数字开头」的分割点为确定性解析）。
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_RE = /^\d[0-9A-Z.+-]{0,63}$/i;

export interface ParsedUploadFile {
	name: string
	version: string
	/** .sig 旁车 or .tgz 包体 */
	sig: boolean
}

/** 文件名 → {name,version,sig}；不属于「<name>-<version>.tgz[.sig]」形态 → null */
export function parseUploadFile(raw: string): ParsedUploadFile | null {
	if (raw === "" || raw.length > 128 || raw.includes("/") || raw.includes("\\"))
		return null;
	const sig = raw.endsWith(".sig");
	const base = sig ? raw.slice(0, -".sig".length) : raw;
	if (!base.endsWith(".tgz"))
		return null;
	const stem = base.slice(0, -".tgz".length);
	for (let i = stem.indexOf("-"); i !== -1; i = stem.indexOf("-", i + 1)) {
		const name = stem.slice(0, i);
		const version = stem.slice(i + 1);
		if (NAME_RE.test(name) && VERSION_RE.test(version))
			return { name, version, sig };
	}
	return null;
}

// ── .sig 旁车五字段（契约 §2.11 / C2-35，canon 恒 "v2"）───────────────────────────────────
const PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/;
const SIG_B64 = /^[A-Z0-9+/]+={0,2}$/i;

export interface SidecarSig {
	alg: string
	key_id: string
	public_key: string
	value: string
	canon: string
	/** 包级 canonical 首段（REG-CS3 签发方 registry 身份；install verify 重构规范串用，A5 增补落列） */
	registry_id: string
}

function isObj(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 五字段结构校验（400 人话分流；加密学校验在 install verify 段——此处不重复） */
export function parseSidecarSig(text: string): SidecarSig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	}
	catch (e) {
		return fail(400, `.sig 旁车不是合法 JSON（${String(e)}）——应为 {alg,key_id,public_key,value,canon} 对象`);
	}
	if (!isObj(parsed))
		fail(400, ".sig 旁车必须是 JSON 对象（{alg,key_id,public_key,value,canon}）");
	const { alg, key_id: keyId, public_key: publicKey, value, canon, registry_id: registryId } = parsed;
	if (alg !== "Ed25519")
		fail(400, `.sig alg 须为 "Ed25519"，实为「${String(alg)}」`);
	if (typeof keyId !== "string" || !isValidKeyId(keyId))
		fail(400, `.sig key_id 非法（C2-37 <publisher>.<id>）：「${String(keyId)}」`);
	if (typeof publicKey !== "string" || !PUBLIC_KEY_HEX.test(publicKey))
		fail(400, `.sig public_key 须为 64 hex（Ed25519 32B raw）：「${typeof publicKey === "string" ? `${publicKey.slice(0, 16)}…` : String(publicKey)}」`);
	if (typeof value !== "string" || value === "" || !SIG_B64.test(value))
		fail(400, ".sig value 须为非空标准 base64 签名");
	if (canon !== "v2")
		fail(400, `.sig canon 须为 "v2"（canon_stale 一律拒），实为「${String(canon)}」`);
	if (typeof registryId !== "string" || registryId === "")
		fail(400, `.sig registry_id 须为非空字符串（REG-CS3 签发方身份）：「${String(registryId)}」`);
	return { alg, key_id: keyId, public_key: publicKey, value, canon, registry_id: registryId };
}

/** 包级 canonical（REG-CS3 v2；与 packages/cli/src/lifecycle/sign.ts canonicalString 逐字一致——双端不可漂移） */
export function packageCanonicalOf(registryId: string, name: string, version: string, sha256: string): string {
	return `${registryId}:${name}@${version}:${sha256}`;
}

/** 入库钳制（catalog 展示字段）：summary ≤200 / description ≤2000 截断——全量 manifest 仍在包内 */
export function clampManifest(m: Record<string, unknown>): Record<string, unknown> {
	const out = { ...m };
	if (typeof out.summary === "string" && out.summary.length > 200)
		out.summary = out.summary.slice(0, 200);
	if (typeof out.description === "string" && out.description.length > 2000)
		out.description = out.description.slice(0, 2000);
	return out;
}

/** 带 status 的可读失败（respond 收口成 json.fail，D14/B5 同通道） */
export function fail(status: number, msg: string): never {
	throw Object.assign(new Error(msg), { status });
}

/**
 * 公钥指纹工厂（64hex → 32B raw → sha256）：POST /market/trust 混淆代理防线与离线包上传
 * 响应共用——TOFU「指纹逐字核对」不变式的单源实现，勿在调用点各抄一遍 parseInt 循环。
 * sha256 面由调用方注入（env.sha256Hex 回落运行时全局，与 verify 段同口径）。
 */
export function fingerprintOf(sha256Hex: (data: Uint8Array) => string): (publicKeyHex: string) => string {
	return publicKeyHex => sha256Hex(hexToBytes32(publicKeyHex));
}

/** 64hex → 32B raw（Ed25519 公钥；输入非 64hex 时越界字节为 NaN——调用方已过结构校验） */
function hexToBytes32(hex: string): Uint8Array {
	const raw = new Uint8Array(32);
	for (let i = 0; i < 32; i++)
		raw[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return raw;
}
