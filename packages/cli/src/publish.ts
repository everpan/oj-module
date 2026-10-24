import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
// ojm publish（P3-5/6/7，作者工具链）：对发布目录的 bundles.yaml + manifests.yaml 索引
// 重算（P3-6：parse→确定性 stringify，消弭格式漂移、使 sha256 稳定可签）→ 签名（P3-7：detached
// 侧车 .sig，与 archive .sig 同构）→ 写回目录（本地文件目标；CDN 推送走 resolveCdn 同形）。
// 复用 sign.ts 签名原语 + 发布方 key（~/.ojm/keys，与 ojm sign 同身份体系）。
import { isValidKeyId } from "./keygen";
import { readPrivateKeyPem } from "./lifecycle/keygen";
import { CANON, exportRawPublicKeyHex, fingerprintOfPublicKey, SIG_ALG, signCanonical, verifyCanonical } from "./lifecycle/sign";

export interface PublishOptions {
	/** 发布方 key_id（C2-37；.sig 的发布方标识） */
	id?: string
	/** 私钥 PEM 文件（缺省 ~/.ojm/keys/<id>/private.pem） */
	key?: string
	/** 写完离线自检（verifyCanonical 复核两份签名） */
	check?: boolean
	/** 测试注入；缺省 process.cwd() */
	cwd?: string
}

export interface PublishResult {
	bundlesPath: string
	manifestsPath: string
	bundlesSigPath: string
	manifestsSigPath: string
	keyId: string
	publicKeyHex: string
	fingerprint: string
	/** --check 的自检结果（未传 --check = undefined） */
	checkPassed?: boolean
}

/** 索引文件的种类（REG-CS1 同代校验：签名覆盖 (kind, seq)，换 kind 或换代签名即失效） */
export type IndexKind = "bundles" | "manifests";

/**
 * 索引有效期（REG-CS2，秒）。全仓只此一处——生成器盖章与读方判过期共用同一个数。
 * 7 天的理由：索引是内容分发不是安全裁决，窗口要够「源方休假回来重建」；真出事靠
 * `seq` 回退即拒与吊销通道兜底，不靠把 TTL 压到小时级。
 */
export const INDEX_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 索引元字段（代次 + 时效），盖进 bundles.yaml 顶层并由签名锁定 */
export interface IndexMeta {
	seq: number
	/** 签发时刻（epoch 秒） */
	issued_at: number
	/** 失效时刻（epoch 秒；读方 now > 此值即拒，REG-CS2） */
	expires_at: number
}

/**
 * 索引规范串（REG-CS1/CS2）：`index:<kind>:<seq>:<sha256hex>`，与验签侧（market/api.ts）逐字一致。
 *
 * **seq 为什么进串**：只签文本哈希时，「今年的总目录」与「去年的分册」各自都能验过，
 * 读者能把两代拼起来用（红队 F2）。进串之后签名即锁定「第几代」，不同代拼不起来。
 */
export function indexCanonical(kind: IndexKind, seq: number, text: string): string {
	const sha256 = createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
	return `index:${kind}:${seq}:${sha256}`;
}

/** 对单个索引文本签名，产出 detached .sig 六字段（与 archive .sig 同构，契约 §2.11 / C2-35 + seq） */
export function signIndex(kind: IndexKind, seq: number, text: string, privateKeyPem: string, keyId: string): { alg: string, key_id: string, public_key: string, value: string, canon: string, seq: number } {
	const value = signCanonical(privateKeyPem, indexCanonical(kind, seq, text));
	return { alg: SIG_ALG, key_id: keyId, public_key: exportRawPublicKeyHex(privateKeyPem), value, canon: CANON, seq };
}

/** 索引代次（REG-CS2）：顶层 `seq` 字段；数组形态的索引（如聚合清单）没有顶层键 → null */
export function indexSeqOf(text: string): number | null {
	let doc: unknown;
	try {
		doc = yamlParse(text);
	}
	catch {
		return null;
	}
	if (doc === null || typeof doc !== "object" || Array.isArray(doc))
		return null;
	const seq = (doc as Record<string, unknown>).seq;
	return typeof seq === "number" && Number.isInteger(seq) && seq >= 1 ? seq : null;
}

/**
 * 重建索引的代次（REG-CS2 单调，且保持「重建幂等」）：
 * 盘上既有索引的正文字段 == 本次重建出的正文 → 沿用旧代次（重复跑不产生代次漂移，
 * 否则每次重建都 +1 会让「索引只取决于目录内容」这条性质失效）；内容有变 → +1（只增不减）。
 * 比对只认**正文**（剥掉 seq/issued_at/expires_at 三个元字段）：时间戳每次重建都刷新，
 * 若一并比对则「无变化的重建」永远判成有变化。
 * 单调计数由盘上既有索引承载，不另设状态文件。
 */
export function resolveRebuildSeq(existing: string | null, fresh: string): number {
	const prev = existing === null ? null : indexSeqOf(existing);
	if (prev === null)
		return 1;
	return indexBodyOf(existing) === recomputeIndex(fresh) ? prev : prev + 1;
}

/**
 * 一次「重签」的代次：两份索引都无 seq → 首代 1；只有一份有 / 两份不等 → 拒
 * （`index_generation_mismatch`：不替「新总目录 + 旧分册」签字）。
 */
export function resolveIndexSeq(bundlesText: string, manifestsText: string): number {
	const bundlesSeq = indexSeqOf(bundlesText);
	const manifestsSeq = indexSeqOf(manifestsText);
	if (bundlesSeq === null && manifestsSeq === null)
		return 1;
	if (bundlesSeq === null || manifestsSeq === null || bundlesSeq !== manifestsSeq)
		throw new Error(`[ojm] 两份索引代次不一致（index_generation_mismatch）：bundles=${bundlesSeq ?? "无"} manifests=${manifestsSeq ?? "无"}——先跑 ojm market build-index 重建同一代索引再签`);
	return bundlesSeq;
}

/** 把代次与时效盖进索引文本（parse → 置 seq/issued_at/expires_at → 确定性 stringify），使哈希覆盖代次 */
export function stampIndexMeta(text: string, meta: IndexMeta): string {
	const doc = yamlParse(text);
	if (doc === null || typeof doc !== "object" || Array.isArray(doc))
		throw new Error("[ojm] 索引不是键值文档，无法盖章代次（数组形态的索引由 .sig 携带代次）");
	const out = doc as Record<string, unknown>;
	out.seq = meta.seq;
	out.issued_at = meta.issued_at;
	out.expires_at = meta.expires_at;
	return yamlStringify(sortKeysDeep(out), { lineWidth: 0 });
}

/**
 * 按当前时刻算一份时效（`issued_at` = now，`expires_at` = now + TTL）。
 * `now` 可注入，使重建结果在用例里可断言。
 */
export function indexMetaOf(seq: number, now: number): IndexMeta {
	return { seq, issued_at: now, expires_at: now + INDEX_TTL_SECONDS };
}

/** 索引时效（读方据此判过期；缺任一字段或不是数 → null，按 REG-CS2 fail-closed 拒） */
export function indexTimesOf(text: string): { issued_at: number, expires_at: number } | null {
	let doc: unknown;
	try {
		doc = yamlParse(text);
	}
	catch {
		return null;
	}
	if (doc === null || typeof doc !== "object" || Array.isArray(doc))
		return null;
	const issuedAt = (doc as Record<string, unknown>).issued_at;
	const expiresAt = (doc as Record<string, unknown>).expires_at;
	if (typeof issuedAt !== "number" || typeof expiresAt !== "number")
		return null;
	return { issued_at: issuedAt, expires_at: expiresAt };
}

/**
 * 索引正文（剥掉 seq / issued_at / expires_at 后的确定性文本）。
 * 重建幂等判定用：时间戳每次重建都刷新，只有正文相同才算「内容没变」。
 */
export function indexBodyOf(text: string): string | null {
	let doc: unknown;
	try {
		doc = yamlParse(text);
	}
	catch {
		return null;
	}
	if (doc === null || typeof doc !== "object" || Array.isArray(doc))
		return null;
	const out = { ...(doc as Record<string, unknown>) };
	delete out.seq;
	delete out.issued_at;
	delete out.expires_at;
	return yamlStringify(sortKeysDeep(out), { lineWidth: 0 });
}

/**
 * 深度按 key 字典序重排（YAML v2 此构建无 sortKeys 原语，故手动对纯对象键序归一化）。
 * YAML map 顺序无关语义，故重排不改变含义，仅使字节确定化（P3-6：sha256 稳定可签可验）。
 */
function sortKeysDeep(v: unknown): unknown {
	if (Array.isArray(v))
		return v.map(sortKeysDeep);
	if (v !== null && typeof v === "object" && !Array.isArray(v)) {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(v as Record<string, unknown>).sort())
			out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
		return out;
	}
	return v;
}

/** 索引重算（P3-6）：parse → 键序归一化 → 确定性 stringify，使字节稳定、sha256 可签可验 */
export function recomputeIndex(text: string): string {
	return yamlStringify(sortKeysDeep(yamlParse(text)), { lineWidth: 0 });
}

export function publishCommand(dir: string, opts: PublishOptions = {}): PublishResult {
	const cwd = opts.cwd ?? process.cwd();
	const base = dir ? path.resolve(cwd, dir) : cwd;
	// key 解析（同 ojm sign）
	let keyFile: string;
	let keyId: string;
	if (opts.key !== undefined) {
		keyFile = path.resolve(cwd, opts.key);
		keyId = opts.id ?? "";
		if (keyId === "")
			throw new Error("[ojm] --key 指向自定义位置时须同时给 --id <publisher.id>（.sig 的发布方标识；C2-37 命名空间）");
	}
	else {
		keyId = opts.id ?? "";
		if (keyId === "")
			throw new Error("[ojm] 缺少签名身份：--id <publisher.id>（从 ~/.ojm/keys/<id>/ 取私钥）或 --key <pem> --id <publisher.id>。先生成：ojm keygen --id <publisher.id>");
		keyFile = path.join(os.homedir(), ".ojm", "keys", keyId, "private.pem");
	}
	if (!isValidKeyId(keyId))
		throw new Error(`[ojm] key_id 命名空间非法（C2-37）：「${keyId}」`);
	if (!fs.existsSync(keyFile))
		throw new Error(`[ojm] 私钥文件不存在：${keyFile}（用 ojm keygen --id ${keyId} 生成，或 --key 指定）`);

	const bundlesPath = path.join(base, "bundles.yaml");
	const manifestsPath = path.join(base, "manifests.yaml");
	if (!fs.existsSync(bundlesPath) || !fs.existsSync(manifestsPath))
		throw new Error(`[ojm] 发布目录须含 bundles.yaml 与 manifests.yaml：${base}`);

	// P3-6 重算索引（deterministic stringify 后写回，publish 即生效，无需额外缓存层）
	const bundlesRaw = recomputeIndex(fs.readFileSync(bundlesPath, "utf8"));
	const manifestsText = recomputeIndex(fs.readFileSync(manifestsPath, "utf8"));
	// REG-CS1/CS2：代次与时效进 bundles 正文（数组形态的 manifests 由 .sig 携带同一 seq）。
	// 补签既有索引时沿用其时效（重签不改时效语义），仅在缺失/非法时按当前时刻补盖。
	const seq = resolveIndexSeq(bundlesRaw, manifestsText);
	const now = Math.floor(Date.now() / 1000);
	const times = indexTimesOf(bundlesRaw);
	const meta = times === null ? indexMetaOf(seq, now) : { seq, issued_at: times.issued_at, expires_at: times.expires_at };
	const bundlesText = stampIndexMeta(bundlesRaw, meta);
	fs.writeFileSync(bundlesPath, bundlesText);
	fs.writeFileSync(manifestsPath, manifestsText);

	// P3-7 签名（detached .sig 侧车，与 archive .sig 同构）
	const privateKeyPem = readPrivateKeyPem(keyFile);
	const publicKeyHex = exportRawPublicKeyHex(privateKeyPem);
	const bundlesSig = signIndex("bundles", seq, bundlesText, privateKeyPem, keyId);
	const manifestsSig = signIndex("manifests", seq, manifestsText, privateKeyPem, keyId);
	const bundlesSigPath = `${bundlesPath}.sig`;
	const manifestsSigPath = `${manifestsPath}.sig`;
	fs.writeFileSync(bundlesSigPath, `${JSON.stringify(bundlesSig, null, 2)}\n`);
	fs.writeFileSync(manifestsSigPath, `${JSON.stringify(manifestsSig, null, 2)}\n`);
	console.log(`[ojm] 索引已重算并签名 → ${path.relative(cwd, bundlesSigPath)} / ${path.relative(cwd, manifestsSigPath)}`);
	console.log(`[ojm] 发布方 ${keyId}；指纹 ${fingerprintOfPublicKey(publicKeyHex)}`);

	let checkPassed: boolean | undefined;
	if (opts.check === true) {
		const bundlesOk = verifyCanonical(publicKeyHex, indexCanonical("bundles", seq, bundlesText), bundlesSig.value);
		const manifestsOk = verifyCanonical(publicKeyHex, indexCanonical("manifests", seq, manifestsText), manifestsSig.value);
		checkPassed = bundlesOk && manifestsOk;
		console.log(checkPassed ? "[ojm] 自检通过：索引签名与内容匹配" : "[ojm] 自检失败：索引签名与内容不匹配——请检查私钥与索引后重签");
		if (!checkPassed)
			process.exitCode = 1;
	}
	return { bundlesPath, manifestsPath, bundlesSigPath, manifestsSigPath, keyId, publicKeyHex, fingerprint: fingerprintOfPublicKey(publicKeyHex), checkPassed };
}
