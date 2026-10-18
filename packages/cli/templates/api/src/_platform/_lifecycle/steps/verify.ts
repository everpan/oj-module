// 校验步骤（P1-6 sha256 fail-closed C2-29 + P2-3 Ed25519 验签，十阶段 stage 3 verifying）。
// 签名载体两形态同源（契约 v1.3 §2.9/§2.11）：CDN 源 = Form B manifest.archive.signature；
// file 源 = detached 侧车 .sig（market install 端点上传时点注入同一结构）。
// 验签硬边界（G4）：缺签名/验签不过/格式错一律拒装零落盘，无 solution_allow_unsigned 类开关。
// 结构校验序（全部前置，逐条短路）：alg → key_id 命名空间 → public_key 64hex → value 标准 base64
// → 规范串 → 信任库比对 → verifyEd25519。未知 key_id → needsTrust（第五终态，staging 不清场）。
// 注入面（DIP）：sha256Hex / verifyEd25519 / trustPath——原语不可得即拒装，同 sha256Hex 既有口径
// （oj 运行时私有 crypto 面；Node 测试侧 WebCrypto 无此面，两面皆缺 fail-closed 不静默跳过）。

import type { SigCode } from "../types";
import type { InstallContext } from "./preflight";
import { fsFace } from "../atomic";
import { createTrustStore, isValidKeyId } from "../trust";
import { archiveFileOf } from "./download";

export type Sha256Face = (data: Uint8Array) => string;
/** Ed25519 验签面（上游 crypto.verifyEd25519 同签名：hex/base64 32B 公钥 + UTF-8 msg + 标准 base64 签名） */
export type VerifyEd25519Face = (publicKey: string, msg: string, sigBase64: string) => boolean;

export interface VerifyContext extends InstallContext {
	/** 暂存目录（与 download 同目录接力） */
	staging: string
	/** 注入式摘要面；缺省回落 globalThis.crypto.sha256Hex */
	sha256Hex?: Sha256Face
	/** 宿主信任库路径（.solutions/trusted-keys.yaml；缺省 = 验签能力未配置，fail-closed 拒装） */
	trustPath?: string
	/** Ed25519 验签面；缺省回落 globalThis.crypto.verifyEd25519 */
	verifyEd25519?: VerifyEd25519Face
}

export interface StageResult {
	stage: "verifying"
	ok: boolean
	message: string
	retryable?: boolean
	code?: SigCode
	needsTrust?: boolean
	trust?: { key_id: string, public_key: string, fingerprint: string }
}

const HEX64 = /^[0-9a-f]{64}$/;
/** 标准 base64（含 -/_ 即 base64url，一律 sig_format，禁归一） */
const STD_B64 = /^[A-Z0-9+/]+={0,2}$/i;
/** 规范串版本标记（契约 §2.11；不认识即 sig_format） */
const CANON = "v1";

interface Signature {
	alg: unknown
	key_id: unknown
	public_key: unknown
	value: unknown
	canon?: unknown
}

/** 签名失败结果统一出口（六码：retryable 恒 false、零解压零落盘；unknown_key 附 needsTrust） */
function sigFail(code: SigCode, message: string, trust?: StageResult["trust"]): StageResult {
	return { stage: "verifying", ok: false, retryable: false, code, message, ...(trust !== undefined ? { needsTrust: true, trust } : {}) };
}

function sha256HexFaceOf(ctx: VerifyContext): Sha256Face | undefined {
	return ctx.sha256Hex ?? (globalThis as { crypto?: { sha256Hex?: Sha256Face } }).crypto?.sha256Hex;
}

function verifyEd25519FaceOf(ctx: VerifyContext): VerifyEd25519Face | undefined {
	return ctx.verifyEd25519 ?? (globalThis as { crypto?: { verifyEd25519?: VerifyEd25519Face } }).crypto?.verifyEd25519;
}

/** 指纹 = sha256Hex(publicKey)（契约 §2.11；复用注入摘要面，面不可得 → null 仅展示降级） */
function fingerprintOf(shaFace: Sha256Face, publicKeyHex: string): string | null {
	try {
		const raw = new Uint8Array(32);
		for (let i = 0; i < 32; i++)
			raw[i] = Number.parseInt(publicKeyHex.slice(i * 2, i * 2 + 2), 16);
		return shaFace(raw);
	}
	catch {
		return null;
	}
}

export async function verify(ctx: VerifyContext): Promise<StageResult> {
	const arch = archiveFileOf(ctx.manifest);
	if (!arch.ok) {
		return { stage: "verifying", ok: false, retryable: false, message: `校验失败：${arch.message}` };
	}
	const expected = arch.archive.sha256;
	if (typeof expected !== "string" || expected === "") {
		return {
			stage: "verifying",
			ok: false,
			retryable: false,
			message: "校验失败：archive.sha256 缺失（C2-29 fail-closed：Form A 占位无摘要，安装清单须为 Form B CDN 聚合真源）",
		};
	}
	const dest = `${ctx.staging}/${arch.file}`;
	const shaFace = sha256HexFaceOf(ctx);
	if (typeof shaFace !== "function") {
		return {
			stage: "verifying",
			ok: false,
			retryable: false,
			message: "校验失败：摘要能力不可用（sha256Hex 面未注入且运行时全局缺失）——C2-29 fail-closed 拒装，不静默跳过",
		};
	}
	let bytes: Uint8Array;
	try {
		bytes = await fsFace().readFile(dest);
	}
	catch (e) {
		return { stage: "verifying", ok: false, retryable: true, message: `校验失败：无法读取 ${dest}（${String(e)}）——附录 A verifying：请重试下载` };
	}
	const actual = shaFace(bytes);
	if (actual !== expected) {
		return {
			stage: "verifying",
			ok: false,
			retryable: true,
			message: `校验失败：${arch.file} 摘要与索引不符（C2-29 fail-closed；附录 A verifying：分发包可能损坏，请重试下载）期望 ${expected}，实得 ${actual}`,
		};
	}
	// ── P2-3 验签（sha256 通过后；规范串基于已验字节，R10 语义）────────────────────────
	return verifySignature(ctx, bytes, actual, shaFace);
}

/** 验签主体（sha256 已过）：结构校验序 → 信任库 → verifyEd25519；全拒装路径零解压零落盘 */
async function verifySignature(ctx: VerifyContext, bytes: Uint8Array, sha256: string, shaFace: Sha256Face): Promise<StageResult> {
	const raw = (ctx.manifest as { archive?: { signature?: unknown } } | null)?.archive?.signature;
	if (raw === undefined || raw === null) {
		return sigFail("sig_missing", "校验失败：分发包未签名（sig_missing；G4 硬 fail-closed——Form B 缺 signature 或 file 源缺同目录 .sig 侧车，无逃生门）。指引：请向发布方索取签名包，或见 devkit「签名与信任」");
	}
	if (typeof raw !== "object" || Array.isArray(raw)) {
		return sigFail("sig_format", `校验失败：signature 结构非法（sig_format；应为 {alg,key_id,public_key,value,canon} 对象），实为 ${Array.isArray(raw) ? "array" : typeof raw}`);
	}
	const sig = raw as Signature;
	// ① alg 恒 "Ed25519"（大小写敏感）
	if (sig.alg !== "Ed25519") {
		return sigFail("sig_alg", `校验失败：签名算法只支持 Ed25519（sig_alg），实为「${String(sig.alg)}」`);
	}
	// ② key_id 命名空间 <publisher>.<id>（C2-37：禁裸通用名，防抢注/碰撞）
	if (typeof sig.key_id !== "string" || !isValidKeyId(sig.key_id)) {
		return sigFail("sig_key", `校验失败：key_id 命名空间非法（sig_key；C2-37：<publisher>.<id> 全小写、禁裸通用名单段），实为「${String(sig.key_id)}」`);
	}
	// ③ public_key 严格 64hex（32B raw；禁 PEM/SPKI——上游 decode_key 不认）
	if (typeof sig.public_key !== "string" || !HEX64.test(sig.public_key)) {
		return sigFail("sig_format", `校验失败：public_key 必须是 64 hex（Ed25519 32B raw，sig_format；禁 PEM/SPKI），实为「${String(sig.public_key).slice(0, 24)}」`);
	}
	// ④ value 严格标准 base64（含 -/_ 即 base64url → sig_format，禁归一）
	if (typeof sig.value !== "string" || !STD_B64.test(sig.value)) {
		return sigFail("sig_format", "校验失败：签名 value 必须是标准 base64（sig_format；base64url 含 -/_ 不受理，不做归一）");
	}
	// ⑤ canon 版本标记
	if (sig.canon !== undefined && sig.canon !== CANON) {
		return sigFail("sig_format", `校验失败：规范串版本标记不认识（sig_format；本机支持 ${CANON}），实为「${String(sig.canon)}」`);
	}
	// ⑥ 验签原语可得性（与 sha256Hex 同口径：不可得 = 拒装，不静默跳过）
	const face = verifyEd25519FaceOf(ctx);
	if (typeof face !== "function") {
		return sigFail("sig_format", "校验失败：验签能力不可用（verifyEd25519 面未注入且运行时全局缺失）——G4 fail-closed 拒装，不静默跳过");
	}
	// ⑦ 信任库比对（TOFU 三态）
	if (ctx.trustPath === undefined || ctx.trustPath === "") {
		return sigFail("sig_missing", "校验失败：宿主未配置信任库路径（trustPath 缺失）——验签能力未就绪，fail-closed 拒装");
	}
	const trustedKey = await createTrustStore(ctx.trustPath).get(sig.key_id);
	const fingerprint = fingerprintOf(shaFace, sig.public_key);
	if (trustedKey === null) {
		// 未知 key_id：停 needs_trust（staging 不清场，确认后重试）
		return sigFail(
			"unknown_key",
			`待信任确认：发布方「${sig.key_id}」不在宿主信任库（unknown_key）。请核对指纹后执行 ojm trust confirm --task <task_id>（或市场页确认），确认入库即可重试安装`,
			{ key_id: sig.key_id, public_key: sig.public_key, fingerprint: fingerprint ?? "" },
		);
	}
	if (trustedKey !== sig.public_key) {
		return sigFail("sig_key", `校验失败：key_id「${sig.key_id}」的包内公钥与信任库绑定不一致（sig_key；首次绑定不可改——疑抢注/换钥，请发布方轮换为新 key_id）`);
	}
	// ⑧ 规范串 + 验签（双层语义：抛错 = sig_format，false = tampered，同拒装但分码）
	const canonical = `${ctx.name}@${ctx.version}:${sha256}`;
	let verified: boolean;
	try {
		verified = face(sig.public_key, canonical, sig.value);
	}
	catch (e) {
		// 上游格式错（verifyEd25519: 起头）在 isolate 内转 sig_format——抛错不得逃逸成阶段异常
		return sigFail("sig_format", `校验失败：验签输入格式错（sig_format）：${String(e)}`);
	}
	if (!verified) {
		return sigFail("tampered", "校验失败：签名与包体不符（tampered；签名不符不落盘——请重新从可信源获取分发包与签名）");
	}
	return {
		stage: "verifying",
		ok: true,
		message: `校验通过：sha256 与索引一致（C2-29）+ Ed25519 验签通过（发布方 ${sig.key_id}，指纹 ${fingerprint ?? "n/a"}，G4 已启用）`,
	};
}
