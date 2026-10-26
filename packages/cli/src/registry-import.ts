// ojm registry import（REG-R11 离线导入）：把离线包目录恢复到站点本地，全程不触网。
//
// 为什么是「纯本地文件系统」：R11 的主场景是「源挂了还能救」——内容源（CDN/registry 读面）大概率已离线，
// 但站点 admin 可直登这台机器跑命令。所以 import 不调任何网络：读 `<dir>/registry/`、验签、落盘，
// 把站点从本地副本救回来（与线上 fail-closed 同口径，只是动作发生在运维侧）。
//
// 三步（与线上 REG-CS1 / REG-R10 同语义，draft §3）：
//   ① 验签：catalog / 各分片 / revocations 的正文 + detached `.sig` 侧车，复用 `verifyCanonical`
//      （alg 必须 Ed25519、pubkey 在**已登记的 active 索引 key** 集合里、Ed25519 验签通过）。
//      active key 集合离线时来自本地信任库（--keys 或 ~/.ojm/registry/<origin>/index-keys.json）；
//      取不到活跃 key 即 fail-closed（没法离线判定「这把 key 是不是 registry 的」）。
//   ② 吊销 seq 护栏：读 revocations.yaml 的 seq，与本地产的本地账本（~/.ojm/registry/<origin>/
//      revocation-seq.json）比对——低于已知值 / 同代内容被替换 → 拒（revocations_not_monotonic），
//      等价于线上 `guardAndRecordRevocationSeq`，防「把已收紧的清单回退成旧的」。
//   ③ 落盘：把 `registry/` 内容拷进站点本地 `<cdn>/registry/`（public）或 `--out` 指定的本地索引目录，
//      **不重新渲染**，用包内原始正文保证字节一致（与 `exportStaticIndex` 同纪律）。`--dry-run` 全程零写入。
//
// 判别码与线上 S5-3 同词汇（便于排障一眼归并）：index_sig_missing / index_sig_mismatch /
// index_key_mismatch / index_generation_mismatch / revocations_sig_missing / revocations_sig_mismatch /
// revocations_not_monotonic / revocation_state_corrupt / offline_format / static_mount_missing。
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { UsageError } from "./exit-codes";
import { indexCanonical, revocationCanonical, shardPinsOf } from "./publish";
import { inspectSidecar } from "./registry-sidecar";

/** registry 静态载体在站点 /cdn 下的子目录（与 oj-registry 的 REGISTRY_SUBDIR 逐字一致） */
export const REGISTRY_SUBDIR = "registry";
/** 站点既有静态目录挂载前缀（config.yaml mounts[].prefix），registry 不新增 mounts */
export const STATIC_MOUNT_PREFIX = "/cdn";

export class RegistryImportError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "RegistryImportError";
	}
}

/** 已登记的 active 索引 key（离线信任库条目） */
export interface IndexKeyEntry {
	key_id: string
	public_key: string
	status?: string
}

export interface RegistryImportOptions {
	/** 离线包根目录（含 `registry/` 子目录） */
	dir: string
	/** 站点数据根：读 config.yaml 的 /cdn 挂载，落到 `<web>/registry/`（public 载体） */
	site?: string
	/** 显式目标目录（覆盖 --site 的发现；private 站点把本地索引目录直接传这里） */
	out?: string
	/** active 索引 key 集合 JSON 路径（数组：{key_id, public_key, status}）；缺省从本地信任库取 */
	keys?: string
	/** 本地 seq 账本源标识（多源导入各记各的）；缺省取 <dir>/source.json 的 origin，再退 offline:<绝对目录> */
	registry?: string
	/** 全程零写入，只验证 + 列出本应写入的文件 */
	dryRun?: boolean
	/** 机器可读输出 */
	json?: boolean
	/** 测试注入；缺省 process.cwd() */
	cwd?: string
	/** 测试注入 home；缺省 os.homedir() */
	home?: string
}

export interface ImportedFile {
	/** 包内相对 registry/ 的路径 */
	rel: string
	/** 落盘目标绝对路径（dry-run 下是本应写入的路径） */
	dest: string
}

export interface RegistryImportResult {
	/** 通过全部校验（含 seq 护栏） */
	ok: boolean
	code?: string
	message: string
	/** 吊销清单 seq（通关后） */
	revocationSeq: number | null
	/** 本应/已落盘的文件（按写入顺序） */
	written: ImportedFile[]
	/** 验签扫过的文件数（catalog + 分片 + revocations） */
	verified: number
}

function sha256Hex(text: string): string {
	return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function asRecord(v: unknown, what: string): Record<string, unknown> {
	if (v === null || typeof v !== "object" || Array.isArray(v))
		throw new UsageError(`[ojm] ${what} 必须是对象`);
	return v as Record<string, unknown>;
}

function readText(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	}
	catch {
		return null;
	}
}

/** 读本地 active 索引 key 集合：--keys > ~/.ojm/registry/<origin>/index-keys.json */
function loadActiveKeys(opts: RegistryImportOptions, origin: string, home: string): Set<string> {
	let raw: string | null = null;
	const tried: string[] = [];
	if (opts.keys !== undefined) {
		raw = readText(path.resolve(opts.cwd ?? process.cwd(), opts.keys));
		tried.push(opts.keys);
	}
	else {
		const store = path.join(home, ".ojm", "registry", origin, "index-keys.json");
		raw = readText(store);
		tried.push(store);
	}
	if (raw === null)
		throw new RegistryImportError("index_key_mismatch", `离线验签需要 active 索引 key 集合，但取不到（试过：${tried.join("、")}）。用 --keys 指定，或先把站点已登记的 active 索引 key 落到本地信任库。`);
	let doc: unknown;
	try {
		doc = JSON.parse(raw);
	}
	catch {
		throw new UsageError(`[ojm] key 集合不是合法 JSON：${tried[tried.length - 1]}`);
	}
	if (!Array.isArray(doc))
		throw new UsageError("[ojm] key 集合顶层须为数组：[{key_id, public_key, status}]");
	const set = new Set<string>();
	for (const e of doc) {
		const entry = asRecord(e, "key 集合元素");
		const pk = String(entry.public_key ?? "");
		const status = entry.status === undefined ? "active" : String(entry.status);
		if (/^[0-9a-f]+$/i.test(pk) && status === "active")
			set.add(pk.toLowerCase());
	}
	if (set.size === 0)
		throw new RegistryImportError("index_key_mismatch", "key 集合里没有任何 active 索引 key（status 必须为 \"active\"）——无法离线判定签名公钥归属。");
	return set;
}

type VerifyOutcome = { ok: true, seq: number } | { ok: false, code: string, message: string };

/**
 * 验一条索引/吊销正文：alg 必须 Ed25519、pubkey 在 active 集合、Ed25519 验签通过。
 * `canonFn` 按种类拼规范串（index:<kind>:<seq>:<sha> 或 revocations:<seq>:<sha>）。
 * 判定逻辑在 `registry-sidecar`（与 `ojm registry export` 共用，避免「导出的包自己导不进去」）。
 */
function verifyOne(activeKeys: Set<string>, rel: string, body: string, sigText: string, canonFn: (seq: number, text: string) => string): VerifyOutcome {
	if (sigText.trim() === "")
		return { ok: false, code: "index_sig_missing", message: `${rel} 缺签名侧车（${rel}.sig）——完整性无保障，已拒载` };
	const verdict = inspectSidecar({ rel, body, sigText, canon: canonFn, isTrusted: pk => activeKeys.has(pk) });
	return verdict.ok && verdict.seq !== null
		? { ok: true, seq: verdict.seq }
		: { ok: false, code: verdict.code ?? "index_sig_mismatch", message: verdict.message ?? `${rel} 验签不过` };
}

/** 本地吊销 seq 账本（~/.ojm/registry/<origin>/revocation-seq.json） */
interface SeqLedger { max_seq: number, content_sha: string }

function ledgerPath(origin: string, home: string): string {
	return path.join(home, ".ojm", "registry", origin, "revocation-seq.json");
}

/** 账本状态：缺失（首次导入）/ 合法 / 损坏（存在但解析或字段非法） */
type LedgerState = SeqLedger | null | "corrupt";

function readLedger(origin: string, home: string): LedgerState {
	const raw = readText(ledgerPath(origin, home));
	if (raw === null)
		return null;
	let doc: unknown;
	try {
		doc = JSON.parse(raw);
	}
	catch {
		return "corrupt"; // 损坏账本必须 fail-closed，不能当成「无记录」放行
	}
	const r = asRecord(doc, "revocation 账本");
	const maxSeq = Number(r.max_seq);
	const contentSha = String(r.content_sha ?? "");
	if (!Number.isInteger(maxSeq) || maxSeq < 0)
		return "corrupt";
	return { max_seq: maxSeq, content_sha: contentSha };
}

function writeLedger(origin: string, home: string, ledger: SeqLedger): void {
	const file = ledgerPath(origin, home);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(ledger)}\n`);
}

/** 解析 <dir>/source.json 的 origin（多源导入用，区分 seq 账本） */
function resolveOrigin(opts: RegistryImportOptions, pkgDir: string, cwd: string): string {
	if (opts.registry !== undefined && opts.registry.trim() !== "")
		return opts.registry.trim();
	const src = readText(path.join(pkgDir, "source.json"));
	if (src !== null) {
		try {
			const doc = JSON.parse(src) as Record<string, unknown>;
			const o = doc.origin;
			if (typeof o === "string" && o.trim() !== "")
				return o.trim();
		}
		catch { /* 坏 source.json 退默认 */ }
	}
	return `offline:${path.resolve(cwd, opts.dir)}`;
}

/** 发现落盘目标：--out > --site 的 /cdn 挂载；private 站点（无挂载）必须给 --out */
function resolveTarget(opts: RegistryImportOptions): string {
	if (opts.out !== undefined)
		return path.resolve(opts.cwd ?? process.cwd(), opts.out);
	if (opts.site === undefined)
		throw new UsageError("[ojm] 用法：ojm registry import <dir> --site <站点数据根> [--out <目标目录>] [--keys <active索引key.json>] [--dry-run] [--json]\n  public 站点用 --site（自动落到 <cdn>/registry）；private 站点没有 /cdn 挂载，请用 --out 直接指定本地索引目录。");
	const cfgPath = path.join(opts.site, "config.yaml");
	const cfgText = readText(cfgPath);
	if (cfgText === null)
		throw new UsageError(`[ojm] 站点数据根没有 config.yaml：${cfgPath}`);
	// 同步解析 config.yaml（轻量：只取 mounts，不引入 yaml 依赖）
	const mounts = extractMounts(cfgText);
	const webDir = mounts.find(m => m.prefix === STATIC_MOUNT_PREFIX && typeof m.web === "string")?.web;
	if (webDir === undefined)
		throw new RegistryImportError("static_mount_missing", `站点 ${opts.site} 没有 ${STATIC_MOUNT_PREFIX} 静态挂载，离线包无法落静态目录（private 站点请用 --out 指定本地索引目录，registry 不新增 mounts）`);
	return path.join(webDir.replace(/\/+$/, ""), REGISTRY_SUBDIR);
}

/** 极简 YAML 提取 mounts[].{prefix, web}（只吃我们关心的两个键，不引入 yaml 依赖） */
function extractMounts(text: string): Array<{ prefix?: string, web?: string }> {
	const mounts: Array<{ prefix?: string, web?: string }> = [];
	// mounts: 之后的缩进块；逐行匹配 prefix:/ web:
	const lines = text.split("\n");
	let inMounts = false;
	let current: { prefix?: string, web?: string } | null = null;
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^mounts\s*:/.test(trimmed)) {
			inMounts = true;
			continue;
		}
		if (inMounts) {
			if (/^\s*-\s+/.test(line) && current !== null) {
				mounts.push(current);
				current = {};
			}
			const pre = line.match(/prefix\s*:\s*(\S+)/);
			const web = line.match(/web\s*:\s*(\S+)/);
			if (pre || web) {
				current = current ?? {};
				if (pre)
					current.prefix = pre[1];
				if (web)
					current.web = web[1].replace(/['"]/g, "");
			}
			// 退出 mounts 块（遇到非缩进的顶层键）
			if (/^\S/.test(line) && !trimmed.startsWith("mounts")) {
				if (current !== null)
					mounts.push(current);
				current = null;
				inMounts = false;
			}
		}
	}
	if (current !== null)
		mounts.push(current);
	return mounts;
}

/**
 * 业务命令体。返回结果（测试/CI 断言用）；不打印、不 exit——输出与退出码归 cli.ts。
 * `--dry-run` 只验证 + 列出本应写入的文件，零落盘。
 */
export function registryImportCommand(opts: RegistryImportOptions): RegistryImportResult {
	const cwd = opts.cwd ?? process.cwd();
	const home = opts.home ?? os.homedir();
	if (!opts.dir)
		throw new UsageError("ojm registry import <dir> [--site <站点数据根>] [--out <目标目录>] [--keys <active索引key.json>] [--dry-run] [--json]");

	const pkgDir = path.resolve(cwd, opts.dir);
	const regDir = path.join(pkgDir, REGISTRY_SUBDIR);
	if (!fs.existsSync(regDir))
		throw new RegistryImportError("offline_format", `离线包缺 ${REGISTRY_SUBDIR}/ 子目录：${regDir}（离线包结构见 REG-R11 草案：<dir>/registry/{catalog.yaml(+.sig), shards/<n>.yaml(+.sig), revocations.yaml(+.sig)}）`);

	const origin = resolveOrigin(opts, pkgDir, cwd);
	const activeKeys = loadActiveKeys(opts, origin, home);

	const written: ImportedFile[] = [];
	let verified = 0;

	// ① catalog
	const catalogBody = readText(path.join(regDir, "catalog.yaml"));
	if (catalogBody === null)
		throw new RegistryImportError("offline_format", `离线包缺总目录 ${REGISTRY_SUBDIR}/catalog.yaml`);
	const catalogSig = readText(path.join(regDir, "catalog.yaml.sig"));
	if (catalogSig === null)
		throw new RegistryImportError("index_sig_missing", "离线包总目录缺签名侧车 catalog.yaml.sig");
	const catalogVerify = verifyOne(activeKeys, "catalog.yaml", catalogBody, catalogSig, (seq, t) => indexCanonical("catalog", seq, t));
	if (!catalogVerify.ok)
		throw new RegistryImportError(catalogVerify.code!, catalogVerify.message!);
	verified++;

	// ① 各分片（按 catalog 钉值）
	let pins: Map<number, number>;
	try {
		pins = shardPinsOf(catalogBody);
	}
	catch {
		throw new RegistryImportError("offline_format", "离线包总目录不是合法索引 YAML（无法解析分片钉值）");
	}
	if (pins.size === 0)
		throw new RegistryImportError("index_sig_mismatch", "离线包总目录的分片钉值为空——结构破损，已拒载");
	for (const no of [...pins.keys()].sort((a, b) => a - b)) {
		const shardBody = readText(path.join(regDir, "shards", `${no}.yaml`));
		if (shardBody === null)
			throw new RegistryImportError("index_sig_missing", `离线包缺分片 shards/${no}.yaml（钉值声明了却找不到）——结构破损，已拒载`);
		const shardSig = readText(path.join(regDir, "shards", `${no}.yaml.sig`));
		if (shardSig === null)
			throw new RegistryImportError("index_sig_missing", `离线包分片 shards/${no}.yaml 缺签名侧车——完整性无保障，已拒载`);
		const shardVerify = verifyOne(activeKeys, `shards/${no}.yaml`, shardBody, shardSig, (seq, t) => indexCanonical("shard", seq, t));
		if (!shardVerify.ok)
			throw new RegistryImportError(shardVerify.code!, shardVerify.message!);
		const sigSeq = shardVerify.seq;
		if (sigSeq !== pins.get(no))
			throw new RegistryImportError("index_generation_mismatch", `离线包分片 shards/${no}.yaml 签名是第 ${sigSeq} 代，总目录钉的是第 ${pins.get(no)} 代——源正在重建索引，已拒载`);
		verified++;
	}

	// ①+② revocations
	let revocationSeq: number | null = null;
	const revBody = readText(path.join(regDir, "revocations.yaml"));
	const contentSha = revBody === null ? "" : sha256Hex(revBody);
	if (revBody !== null) {
		const revSig = readText(path.join(regDir, "revocations.yaml.sig"));
		if (revSig === null)
			throw new RegistryImportError("revocations_sig_missing", "离线包吊销清单缺签名侧车 revocations.yaml.sig——空清单也必须签，已拒载");
		const revVerify = verifyOne(activeKeys, "revocations.yaml", revBody, revSig, (seq, t) => revocationCanonical(seq, t));
		if (!revVerify.ok)
			throw new RegistryImportError(revVerify.code!, revVerify.message!);
		revocationSeq = revVerify.seq;
		verified++;
		// ② seq 护栏（本地账本）
		const ledger = readLedger(origin, home);
		if (ledger === "corrupt")
			throw new RegistryImportError("revocations_not_monotonic", `本源吊销账本损坏（无法读取已记录代次）——为防黑名单被回退，已拒载；请人工检查 ${ledgerPath(origin, home)}`);
		if (ledger !== null && revocationSeq < ledger.max_seq)
			throw new RegistryImportError("revocations_not_monotonic", `离线包吊销清单是第 ${revocationSeq} 代，本源已见过第 ${ledger.max_seq} 代或同代内容被替换/缩水（revocations_not_monotonic）——清单被回退，已拒载`);
		if (ledger !== null && revocationSeq === ledger.max_seq && contentSha !== ledger.content_sha)
			throw new RegistryImportError("revocations_not_monotonic", `离线包吊销清单仍是第 ${revocationSeq} 代但正文指纹变了（content_sha 不符）——同代清空黑名单被拦截，已拒载`);
	}
	else {
		// 无 revocations.yaml：记录一次「无清单」导入（seq=0），确保后续更高代不被静默当成首次。
		const ledger = readLedger(origin, home);
		if (ledger === "corrupt")
			throw new RegistryImportError("revocations_not_monotonic", `本源吊销账本损坏——离线包无吊销清单时无法确认未清空黑名单，已拒载；请人工检查 ${ledgerPath(origin, home)}`);
		if (ledger !== null && ledger.max_seq > 0)
			throw new RegistryImportError("revocations_not_monotonic", `本源已记录过吊销清单（第 ${ledger.max_seq} 代），离线包却不含清单（等于把黑名单清空），已拒载`);
	}

	// ③ 落盘（public 静态 dir 或 --out；不重渲染，原样拷贝）
	const target = resolveTarget(opts);
	const f = (rel: string): ImportedFile => ({ rel, dest: path.join(target, rel) });
	const plan: ImportedFile[] = [];
	plan.push(f("catalog.yaml"));
	plan.push(f("catalog.yaml.sig"));
	if (revBody !== null) {
		plan.push(f("revocations.yaml"));
		const revSig = readText(path.join(regDir, "revocations.yaml.sig"));
		if (revSig !== null)
			plan.push(f("revocations.yaml.sig"));
	}
	// 分片：只拷贝 catalog 钉值且已验签的分片，杜绝包内夹带的未验签分片落到服役目录
	for (const no of [...pins.keys()].sort((a, b) => a - b)) {
		plan.push(f(`shards/${no}.yaml`));
		const sig = readText(path.join(regDir, "shards", `${no}.yaml.sig`));
		if (sig !== null)
			plan.push(f(`shards/${no}.yaml.sig`));
	}
	// 包体（平铺）：<slug>-<version>.tgz[+.sig]
	for (const name of fs.readdirSync(regDir).filter(n => n.endsWith(".tgz"))) {
		plan.push(f(name));
		const sig = readText(path.join(regDir, `${name}.sig`));
		if (sig !== null)
			plan.push(f(`${name}.sig`));
	}

	if (opts.dryRun === true) {
		return { ok: true, message: `[ojm] dry-run：校验通过（${verified} 个文件已验签${revocationSeq !== null ? `，吊销清单第 ${revocationSeq} 代` : "，无吊销清单"}），本应写入 ${plan.length} 个文件到 ${target}`, revocationSeq, written: plan, verified };
	}

	fs.mkdirSync(target, { recursive: true });
	// 先清旧的 registry/ 残留，保证「落盘 = 包内原始正文」而非增量混入
	for (const old of fs.existsSync(target) ? fs.readdirSync(target) : []) {
		fs.rmSync(path.join(target, old), { recursive: true, force: true });
	}
	for (const item of plan) {
		fs.mkdirSync(path.dirname(item.dest), { recursive: true });
		fs.copyFileSync(path.join(regDir, item.rel), item.dest);
		written.push(item);
	}
	// 落盘成功后推进本地 seq 账本（guard 已判过，这里只记）
	writeLedger(origin, home, { max_seq: revocationSeq ?? 0, content_sha: contentSha });

	return { ok: true, message: `[ojm] 离线包已导入：${written.length} 个文件写入 ${target}${revocationSeq !== null ? `，吊销清单第 ${revocationSeq} 代` : "，无吊销清单"}`, revocationSeq, written, verified };
}
