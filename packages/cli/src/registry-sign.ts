// ojm registry sign（REG-R7 外置签名）：把 registry 导出的未签索引签成**可直接回传**的请求体。
//
// 为什么这条命令必须存在：签名私钥**不在服务端**（S4-3 的结构性约束——registry 的运行时
// 只有 verifyEd25519）。所以「渲染」与「签名」被切成两半：服务端渲染并导出（POST /index/unsigned），
// CI/运维在离线侧签名（本命令），再回传（POST /index/signature）。
//
// 输入就是导出响应体（`gen` + `pending[]` + `keys[]`），输出就是回传请求体（`gen` + `signatures[]`）：
// 两端形状由命令本身守住，CI 里不必再写胶水去拼六字段，也不会把 `seq` 拼错（拼错 = 服务端
// `index_generation_mismatch`，一代索引白签）。
//
// 三条 fail-closed（都在**上传之前**把错误挡住）：
//   ① 导出里没有这把公钥（key_id 缺席或指纹不符）→ `index_key_mismatch`：
//      私钥与登记的公钥不是一对，回传必被拒，早报比晚报省一次流水线；
//   ② 正文与导出声明的 sha256 不符 → `index_export_tampered`：导出文件被改过（或版本错配），
//      签出来的东西验不过；
//   ③ 签完立刻本地验一遍 → `index_sig_mismatch`：私钥/公钥推导口径漂移（比如 PEM 不是 Ed25519）
//      当场暴露，而不是等到回传被服务端打回。
//
// 指纹口径：sha256(公钥 **32 字节**)，与 `ojm keygen`、站点信任库、registry 的 reg_key.fingerprint
// 同源。按 hex 文本算会让同一把钥匙在三处显示三个值。
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { UsageError } from "./exit-codes";
import { isValidKeyId } from "./keygen";
import { readPrivateKeyPem } from "./lifecycle/keygen";
import { exportRawPublicKeyHex, fingerprintOfPublicKey, verifyCanonical } from "./lifecycle/sign";
import { indexCanonical, signIndex } from "./publish";

export type RegistryIndexKind = "catalog" | "shard";

/** 回传体里的一条索引签名（服务端 `POST /index/signature` 的 signatures[] 元素） */
export interface RegistryIndexSignature {
	kind: RegistryIndexKind
	/** 片号（catalog = 0） */
	no: number
	/** 这条签名覆盖的代次；服务端要求与本文件应签代次逐字相等 */
	seq: number
	alg: string
	key_id: string
	public_key: string
	value: string
	canon: string
}

export interface RegistrySignOptions {
	/** 导出 JSON 路径；`-` = stdin */
	file: string
	/** 索引签名 key_id（导出里只有一把 active key 时可省略） */
	id?: string
	/** 私钥 PEM（缺省 ~/.ojm/keys/<id>/private.pem） */
	key?: string
	/** 回传请求体落盘路径（与 --json 至少给一个，否则签名结果无处可去） */
	out?: string
	/** `--json`：签名结果走 stdout 信封（与 --out 二选一即可） */
	json?: boolean
	/** 测试注入；缺省 process.cwd() */
	cwd?: string
	/** 测试注入 stdin（file === "-" 时） */
	stdin?: () => string
}

export interface RegistrySignResult {
	gen: number
	keyId: string | null
	fingerprint: string | null
	signatures: RegistryIndexSignature[]
	/** 回传体落盘位置（未给 --out = null） */
	outPath: string | null
	/** 本代待签文件数（= signatures.length；0 表示这一代已经签全，命令是幂等的） */
	signed: number
}

/**
 * 业务失败（退出码 1）且带稳定机器码：CI 靠 `code` 分支，不解析人话。
 * 与 `UsageError`（参数写错 = 2）分开，因为「公钥不对」补参数解决不了。
 */
export class RegistrySignError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "RegistrySignError";
	}
}

const KIND_SET = new Set<string>(["catalog", "shard"]);
const HEX64 = /^[0-9a-f]{64}$/;

interface PendingFile {
	kind: RegistryIndexKind
	no: number
	seq: number
	text: string
	sha256: string
}

interface DeclaredKey {
	keyId: string
	fingerprint: string
}

function sha256Hex(text: string): string {
	return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function asRecord(v: unknown, what: string): Record<string, unknown> {
	if (v === null || typeof v !== "object" || Array.isArray(v))
		throw new UsageError(`[ojm] ${what} 必须是对象`);
	return v as Record<string, unknown>;
}

/** 读入并校验导出体。形状错 = 用法问题（2）；内容与声明不符 = 业务失败（1，带码）。 */
function readExport(opts: RegistrySignOptions, cwd: string): { gen: number, pending: PendingFile[], keys: DeclaredKey[] } {
	const raw = opts.file === "-"
		? (opts.stdin?.() ?? fs.readFileSync(0, "utf8"))
		: fs.readFileSync(path.resolve(cwd, opts.file), "utf8");
	let doc: Record<string, unknown>;
	try {
		doc = asRecord(JSON.parse(raw), `导出文件 ${opts.file}`);
	}
	catch (error) {
		if (error instanceof UsageError)
			throw error;
		throw new UsageError(`[ojm] 输入不是合法 JSON：${opts.file}（取自 POST /api/oj-registry/index/unsigned 的响应体）`);
	}

	const gen = Number(doc.gen);
	if (!Number.isInteger(gen) || gen < 1)
		throw new UsageError(`[ojm] 导出里的 gen 不合法：${String(doc.gen)}（应为正整数，取自导出响应）`);
	if (!Array.isArray(doc.pending))
		throw new UsageError(`[ojm] 导出里缺 pending 数组：${opts.file}（是不是把 /index/signature 的响应体喂进来了？）`);
	const keys: DeclaredKey[] = Array.isArray(doc.keys)
		? doc.keys.map((raw, i) => {
			const k = asRecord(raw, `keys[${i}]`);
			return { keyId: String(k.keyId ?? ""), fingerprint: String(k.fingerprint ?? "") };
		})
		: [];

	const pending = doc.pending.map((raw, i) => {
		const file = asRecord(raw, `pending[${i}]`);
		const kind = String(file.kind);
		if (!KIND_SET.has(kind))
			throw new UsageError(`[ojm] pending[${i}].kind 只能是 catalog | shard（收到「${kind}」）`);
		const no = Number(file.no);
		const seq = Number(file.seq);
		if (!Number.isInteger(no) || no < 0)
			throw new UsageError(`[ojm] pending[${i}].no 不合法：${String(file.no)}`);
		if (!Number.isInteger(seq) || seq < 1)
			throw new UsageError(`[ojm] pending[${i}].seq 不合法：${String(file.seq)}（应签代次必须由导出给出）`);
		if (typeof file.text !== "string")
			throw new UsageError(`[ojm] pending[${i}].text 必须是字符串（索引正文原样，不做归一）`);
		if (typeof file.sha256 !== "string" || !HEX64.test(file.sha256))
			throw new UsageError(`[ojm] pending[${i}].sha256 不是 64 位 hex：${String(file.sha256)}`);
		return { kind: kind as RegistryIndexKind, no, seq, text: file.text, sha256: file.sha256 };
	});

	return { gen, pending, keys };
}

/**
 * 签名命令体。返回结果（测试/CI 断言用）；不打印、不 exit——输出与退出码归 cli.ts。
 * `--out` 只写回传请求体这一个文件（`{ gen, signatures }`，可直接 `-d @` 回传）。
 */
export function registrySignCommand(opts: RegistrySignOptions): RegistrySignResult {
	const cwd = opts.cwd ?? process.cwd();
	if (!opts.file)
		throw new UsageError("[ojm] 用法：ojm registry sign <export.json> --id <publisher.id> [--key <pem>] [--out <file>] [--json]\n  输入 = POST /api/oj-registry/index/unsigned 的响应体（`-` 表示从 stdin 读）");
	if (opts.out === undefined && opts.json !== true)
		throw new UsageError("[ojm] 签名结果必须有去处：--out <file>（回传请求体落盘）或 --json（打到 stdout）——两者都没有等于白签一场");

	const { gen, pending, keys } = readExport(opts, cwd);

	if (pending.length === 0) {
		// 幂等：这一代没有待签文件（要么已经签全上读面，要么全部沿用旧片）。
		// 连私钥都不必碰——CI 重跑时不该因为机器上没 key 就变红。
		return writeOut({ gen, keyId: null, fingerprint: null, signatures: [], signed: 0 }, opts, cwd);
	}

	const keyId = opts.id ?? (keys.length === 1 ? keys[0]!.keyId : undefined);
	if (keyId === undefined)
		throw new UsageError(`[ojm] 导出里有 ${keys.length} 把 active 索引 key，请用 --id 指定签名者（可选：${keys.map(k => k.keyId).join(", ") || "无"}）`);
	if (!isValidKeyId(keyId))
		throw new UsageError(`[ojm] key_id 命名空间非法（C2-37：<publisher>.<id> 全小写）：「${keyId}」`);

	const pem = readPrivateKeyPem(opts.key === undefined
		? path.join(os.homedir(), ".ojm", "keys", keyId, "private.pem")
		: path.resolve(cwd, opts.key));
	const publicHex = exportRawPublicKeyHex(pem);
	const fingerprint = fingerprintOfPublicKey(publicHex);

	const declared = keys.find(k => k.keyId === keyId) ?? null;
	if (declared === null)
		throw new RegistrySignError("index_key_mismatch", `registry 没有登记 key_id「${keyId}」的 active 索引公钥（导出里现有：${keys.map(k => k.keyId).join(", ") || "无"}）——先 POST /api/oj-registry/index/keys 登记公钥，再签`);
	if (declared.fingerprint !== fingerprint)
		throw new RegistrySignError("index_key_mismatch", `私钥与登记的公钥不是一对：导出里 key_id「${keyId}」指纹 ${declared.fingerprint.slice(0, 16)}… ≠ 本地 ${fingerprint.slice(0, 16)}…`);

	const signatures = pending.map((file) => {
		const actual = sha256Hex(file.text);
		if (actual !== file.sha256)
			throw new RegistrySignError("index_export_tampered", `${file.kind}:${file.no} 的正文与导出声明的 sha256 不符（声明 ${file.sha256.slice(0, 16)}… / 实际 ${actual.slice(0, 16)}…）——导出文件被改过或版本错配，签了也验不过`);
		const sig = signIndex(file.kind, file.seq, file.text, pem, keyId);
		if (!verifyCanonical(publicHex, indexCanonical(file.kind, file.seq, file.text), sig.value))
			throw new RegistrySignError("index_sig_mismatch", `${file.kind}:${file.no} 签完自检不过——私钥导出的公钥与登记口径不一致（检查 PEM 是不是 Ed25519）`);
		return { kind: file.kind, no: file.no, ...sig };
	});

	return writeOut({ gen, keyId, fingerprint, signatures, signed: signatures.length }, opts, cwd);
}

function writeOut(result: Omit<RegistrySignResult, "outPath">, opts: RegistrySignOptions, cwd: string): RegistrySignResult {
	if (opts.out === undefined)
		return { ...result, outPath: null };
	const outPath = path.resolve(cwd, opts.out);
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, `${JSON.stringify({ gen: result.gen, signatures: result.signatures }, null, 2)}\n`);
	return { ...result, outPath };
}
