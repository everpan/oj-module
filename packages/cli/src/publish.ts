import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
// ojm publish（P3-5/6/7，作者工具链）：对发布目录的 REG-CS5 三级索引（catalog.yaml + shards/<n>.yaml）
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
	/** 写完离线自检（verifyCanonical 复核 catalog 与各分片签名） */
	check?: boolean
	/** 测试注入；缺省 process.cwd() */
	cwd?: string
}

export interface PublishResult {
	catalogPath: string
	catalogSigPath: string
	/** 本次补签覆盖的分片正文（按片号升序） */
	shardPaths: string[]
	/** 本次补签覆盖的分片签名（与 shardPaths 同序） */
	shardSigPaths: string[]
	keyId: string
	publicKeyHex: string
	fingerprint: string
	/** --check 的自检结果（未传 --check = undefined） */
	checkPassed?: boolean
}

/** 索引文件的种类（REG-CS1 同代校验：签名覆盖 (kind, seq)，换 kind 或换代签名即失效） */
export type IndexKind = "catalog" | "shard";

/**
 * 索引有效期（REG-CS2，秒）。全仓只此一处——生成器盖章与读方判过期共用同一个数。
 * 7 天的理由：索引是内容分发不是安全裁决，窗口要够「源方休假回来重建」；真出事靠
 * `seq` 回退即拒与吊销通道兜底，不靠把 TTL 压到小时级。
 */
export const INDEX_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 索引元字段（代次 + 时效），盖进 catalog.yaml 顶层并由签名锁定 */
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

/** 索引代次（REG-CS2）：顶层 `seq` 字段；纯内容形态的索引（如分片正文）没有顶层键 → null，代次只由 .sig 携带 */
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
 * 一次「补签」的代次（REG-CS5 三级化后只剩 catalog 一个代次真源）：
 * catalog 无顶层 seq → 首代 1；各分片的代次不归这里裁决——分片代次由 catalog 的
 * `shards` 钉值承载（`shards: {<片号>: <代次>}`），逐片在 publishCommand 里与盘上 .sig 交叉核对。
 */
export function resolveIndexSeq(catalogText: string): number {
	const seq = indexSeqOf(catalogText);
	if (seq === null)
		return 1;
	return seq;
}

/** 把代次与时效盖进索引文本（parse → 置 seq/issued_at/expires_at → 确定性 stringify），使哈希覆盖代次 */
export function stampIndexMeta(text: string, meta: IndexMeta): string {
	const doc = yamlParse(text);
	if (doc === null || typeof doc !== "object" || Array.isArray(doc))
		throw new Error("[ojm] 索引不是键值文档，无法盖章代次（纯内容形态的索引代次由 .sig 携带，不盖正文）");
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

/**
 * 索引文件唯一写入口（REG-CS5 原子落盘，红队 F2）：先落 `<路径>.tmp.<pid>.<rand>` 再 `rename`
 * 覆盖。全仓（build-index / publish）只此一条写索引的路径——`grep writeFileSync` 可证没有直写。
 * 临时文件后缀非 `.yaml`，读取器永不把它当索引；进程被杀最多残留一个 tmp，由下次重建扫掉。
 */
export function writeIndexFile(file: string, text: string): void {
	const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
	fs.writeFileSync(tmp, text);
	fs.renameSync(tmp, file);
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

	const catalogPath = path.join(base, "catalog.yaml");
	if (!fs.existsSync(catalogPath))
		throw new Error(`[ojm] 发布目录须含 catalog.yaml（三级索引：catalog.yaml + shards/<n>.yaml）：${base}`);
	const catalogRaw = recomputeIndex(fs.readFileSync(catalogPath, "utf8"));
	const seq = resolveIndexSeq(catalogRaw);

	// REG-CS5：分片代次由 catalog 的 `shards` 钉值承载；逐片与盘上 .sig 交叉核对——
	// 对不上即是中间态（源正在重建 / 索引被手改），不替它签字（index_generation_mismatch）
	const shardsDir = path.join(base, "shards");
	const pins = shardPinsOf(catalogRaw);
	const shardNos = [...pins.keys()].sort((a, b) => a - b);
	const shardTexts = new Map<number, string>();
	for (const no of shardNos) {
		const shardPath = path.join(shardsDir, `${no}.yaml`);
		if (!fs.existsSync(shardPath))
			throw new Error(`[ojm] catalog 钉了 shards/${no}.yaml 但文件不存在：${base}——先跑 ojm market build-index 重建同一代索引再签`);
		const text = recomputeIndex(fs.readFileSync(shardPath, "utf8"));
		const sigPath = `${shardPath}.sig`;
		if (fs.existsSync(sigPath)) {
			let sig: { seq?: unknown };
			try {
				sig = JSON.parse(fs.readFileSync(sigPath, "utf-8")) as { seq?: unknown };
			}
			catch {
				throw new Error(`[ojm] shards/${no}.yaml.sig 不可解析，无法核对代次——先跑 ojm market build-index 重建同一代索引再签`);
			}
			if (sig?.seq !== pins.get(no))
				throw new Error(`[ojm] shards/${no}.yaml 签名是第 ${String(sig?.seq ?? "无")} 代，catalog 钉的是第 ${pins.get(no)} 代（index_generation_mismatch）——先跑 ojm market build-index 重建同一代索引再签`);
		}
		shardTexts.set(no, text);
	}

	// REG-CS1/CS2：代次与时效进 catalog 正文（分片正文是纯内容，代次只由 .sig + catalog 钉值携带）。
	// 补签既有索引时沿用其时效（重签不改时效语义），仅在缺失/非法时按当前时刻补盖。
	const now = Math.floor(Date.now() / 1000);
	const times = indexTimesOf(catalogRaw);
	const meta = times === null ? indexMetaOf(seq, now) : { seq, issued_at: times.issued_at, expires_at: times.expires_at };
	const catalogText = stampIndexMeta(catalogRaw, meta);

	// P3-7 签名（detached .sig 侧车，与 archive .sig 同构）
	const privateKeyPem = readPrivateKeyPem(keyFile);
	const publicKeyHex = exportRawPublicKeyHex(privateKeyPem);
	const catalogSig = signIndex("catalog", seq, catalogText, privateKeyPem, keyId);
	const shardSigs = new Map<number, ReturnType<typeof signIndex>>();
	for (const no of shardNos)
		shardSigs.set(no, signIndex("shard", pins.get(no)!, shardTexts.get(no)!, privateKeyPem, keyId));

	// 原子落盘，顺序固定「先分片 → 再 catalog」（catalog 是提交点；与 build-index 同一纪律）
	for (const no of shardNos) {
		const shardPath = path.join(shardsDir, `${no}.yaml`);
		writeIndexFile(shardPath, shardTexts.get(no)!);
		writeIndexFile(`${shardPath}.sig`, `${JSON.stringify(shardSigs.get(no)!, null, 2)}\n`);
	}
	const catalogSigPath = `${catalogPath}.sig`;
	writeIndexFile(catalogPath, catalogText);
	writeIndexFile(catalogSigPath, `${JSON.stringify(catalogSig, null, 2)}\n`);
	console.log(`[ojm] 索引已重算并签名 → ${path.relative(cwd, catalogSigPath)}${shardNos.length > 0 ? ` + ${shardNos.length} 片` : ""}`);
	console.log(`[ojm] 发布方 ${keyId}；指纹 ${fingerprintOfPublicKey(publicKeyHex)}`);

	let checkPassed: boolean | undefined;
	if (opts.check === true) {
		const shardsOk = shardNos.every(no => verifyCanonical(publicKeyHex, indexCanonical("shard", pins.get(no)!, shardTexts.get(no)!), shardSigs.get(no)!.value));
		const catalogOk = verifyCanonical(publicKeyHex, indexCanonical("catalog", seq, catalogText), catalogSig.value);
		checkPassed = catalogOk && shardsOk;
		console.log(checkPassed ? "[ojm] 自检通过：索引签名与内容匹配" : "[ojm] 自检失败：索引签名与内容不匹配——请检查私钥与索引后重签");
		if (!checkPassed)
			process.exitCode = 1;
	}
	return {
		catalogPath,
		catalogSigPath,
		shardPaths: shardNos.map(no => path.join(shardsDir, `${no}.yaml`)),
		shardSigPaths: shardNos.map(no => path.join(shardsDir, `${no}.yaml.sig`)),
		keyId,
		publicKeyHex,
		fingerprint: fingerprintOfPublicKey(publicKeyHex),
		checkPassed,
	};
}

/** catalog 正文的片钉（`shards: {<片号>: <代次>}`；缺失/畸形 → 空表，由调用方按「无片可签」处理） */
export function shardPinsOf(catalogText: string): Map<number, number> {
	const out = new Map<number, number>();
	let doc: unknown;
	try {
		doc = yamlParse(catalogText);
	}
	catch {
		return out;
	}
	const shards = (doc !== null && typeof doc === "object" && !Array.isArray(doc))
		? (doc as Record<string, unknown>).shards
		: undefined;
	if (shards === null || typeof shards !== "object" || Array.isArray(shards))
		return out;
	for (const [k, v] of Object.entries(shards as Record<string, unknown>)) {
		const no = Number.parseInt(k, 10);
		if (Number.isInteger(no) && no >= 1 && typeof v === "number" && Number.isInteger(v) && v >= 1)
			out.set(no, v);
	}
	return out;
}
