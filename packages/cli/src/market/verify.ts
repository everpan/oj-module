/**
 * `ojm market verify`（T7 + REG-CS5 三级化）：离线验包——不起站点、不装、不要凭据、不要 DB。
 *
 * 分四类列结果（包级与索引级**分开**，因为语义不同）：
 * - 完整性：tgz 实际 sha256 与索引声明的 archive.sha256 是否一致（三级化后声明住在分片正文里）；
 * - 包级签名：`<tgz>.sig` 能否用包内公钥复核规范串 `<name>@<version>:<sha256>`——**这是信任锚**；
 * - 索引签名：索引字节与其 `.sig`——只是完整性层（防目录/索引被改），不是信任锚；
 * - manifest 结构：必填字段、内嵌原生清单 desc 是否非空（oj 装配面必填）、同方案各版本 0001 迁移是否逐字节一致。
 *
 * 复用既有原语，一行密码学都不重写：`lifecycle/sign.ts` 的 canonicalString/verifyCanonical、
 * `publish.ts` 的 indexCanonical/shardPinsOf、`node:crypto` 的 sha256。
 */

import type { IndexKind } from "../publish";
import type { IndexedPackage } from "./index-builder";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import process from "node:process";
import { parse as yamlParse } from "yaml";
import { CANON, canonicalString, verifyCanonical } from "../lifecycle/sign";
import { indexCanonical, indexSeqOf, indexTimesOf, shardPinsOf } from "../publish";
import { resolveCdnLayout } from "./cdn-layout";
import { readTgz } from "./scan";

export interface VerifyCheck {
	item: string
	ok: boolean
	detail: string
	/**
	 * 失败码（REG-CS1）：可区分的三种拒因，供安装侧与报告侧共用同一套判定。
	 * `index_sig_missing` 缺 `.sig` / `index_sig_mismatch` 签名不符 /
	 * `index_generation_mismatch` 跨文件不同代（运维事故，与安全事件分开报）。
	 */
	code?: string
}

export interface VerifyOptions {
	projectRoot?: string
	/** 验指定的 tgz（缺省扫 cdn/ 下全部包） */
	file?: string
	/** 比对扫描重建出的索引与盘上索引，检出漂移 */
	rebuildCheck?: boolean
}

export interface VerifyResult {
	checks: VerifyCheck[]
	passed: boolean
	conclusion: string
	/** `--rebuild-check` 的漂移描述；未传该开关时为 undefined */
	drift?: string[]
}

const BOUNDARY = "完整性 / 来源校验通过——不构成内容安全性背书";

/** 三级索引的读面快照：catalog 正文 + 各分片正文（REG-CS5：catalog.yaml + shards/<n>.yaml） */
interface IndexSnapshot {
	catalogPath: string
	catalogText: string | null
	shardsDir: string
	/** 片号 → 正文（盘上现存、可解析的片；缺文件/不可解析 → null） */
	shardTexts: Map<number, string | null>
}

export function verifyMarket(opts: VerifyOptions = {}): VerifyResult {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const layout = resolveCdnLayout(projectRoot);
	const checks: VerifyCheck[] = [];
	const drift: string[] = [];

	const index = readIndexSnapshot(layout.dir);
	const declared = declaredHashes(index);

	const tgzFiles = opts.file !== undefined
		? [opts.file]
		: fs.existsSync(layout.dir) ? fs.readdirSync(layout.dir).filter(f => f.endsWith(".tgz")).sort() : [];

	for (const file of tgzFiles) {
		const tgzPath = path.isAbsolute(file) ? file : path.join(layout.dir, file);
		if (!fs.existsSync(tgzPath)) {
			checks.push({ item: "完整性", ok: false, detail: `${file}：文件不存在` });
			continue;
		}
		const bytes = new Uint8Array(fs.readFileSync(tgzPath));
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const name = nameOf(file);
		const version = versionOf(file);

		const want = declared.get(`${name}@${version}`);
		checks.push({
			item: "完整性",
			ok: want === undefined || want === sha256,
			detail: want === undefined
				? `${file}：索引未声明该版本，只做了摘要计算（${sha256.slice(0, 12)}…）`
				: `${file}：${want === sha256 ? `sha256 与索引一致（${sha256.slice(0, 12)}…）` : `sha256 不一致（索引 ${want.slice(0, 12)}… vs 实际 ${sha256.slice(0, 12)}…）`}`,
		});

		checks.push(signatureCheck(tgzPath, name, version, sha256));
		checks.push(...structureCheck(bytes, file));
	}

	checks.push(indexSigCheck(path.join(layout.dir, "catalog.yaml.sig"), "catalog.yaml", "catalog", index.catalogText));
	for (const [no, text] of index.shardTexts)
		checks.push(indexSigCheck(path.join(index.shardsDir, `${no}.yaml.sig`), `shards/${no}.yaml`, "shard", text));
	checks.push(generationCheck(index));
	checks.push(expiryCheck(index.catalogText));
	checks.push(...migrationConsistencyCheck(layout.dir, tgzFiles));

	if (opts.rebuildCheck === true)
		drift.push(...driftOf(layout.dir, index));

	const passed = checks.every(c => c.ok) && drift.length === 0;
	return {
		checks,
		passed,
		conclusion: passed
			? `全部校验通过（${checks.length} 项）。${BOUNDARY}——验签过只说明来源与完整性，不说明代码无害。`
			: `存在未通过项。${BOUNDARY}：未通过项须逐条排查后再发布。`,
		drift: opts.rebuildCheck === true ? drift : undefined,
	};
}

/** 读三级索引快照：catalog + 盘上 `shards/<n>.yaml` 全集（不含 .sig——签名在各 check 里按路径读） */
function readIndexSnapshot(cdnDir: string): IndexSnapshot {
	const shardsDir = path.join(cdnDir, "shards");
	const shardTexts = new Map<number, string | null>();
	if (fs.existsSync(shardsDir)) {
		for (const f of fs.readdirSync(shardsDir).filter(f => /^\d+\.yaml$/.test(f)).sort()) {
			const no = Number.parseInt(f, 10);
			if (Number.isInteger(no) && no >= 1)
				shardTexts.set(no, readOptional(path.join(shardsDir, f)));
		}
	}
	const catalogPath = path.join(cdnDir, "catalog.yaml");
	return { catalogPath, catalogText: readOptional(catalogPath), shardsDir, shardTexts };
}

/**
 * `.sig` 里验签只用到 public_key / value 两字段；缺任一即不可复核。
 * 抽成类型守卫：包级与索引级两处验签共用（DRY），也顺带让调用点的布尔式保持单行
 * （本仓 indent-binary-ops 与 no-mixed-spaces-and-tabs 对续行缩进的要求互相打架）。
 */
function hasSigFields(sig: { public_key?: string, value?: string, canon?: string, registry_id?: string }): sig is { public_key: string, value: string, canon?: string, registry_id?: string } {
	return typeof sig.public_key === "string" && typeof sig.value === "string";
}

/** 包级 detached 验签：`<tgz>.sig` 的公钥复核规范串（REG-CS3 v2：`<registry_id>:<slug>@<version>:<sha256>`） */
function signatureCheck(tgzPath: string, name: string, version: string, sha256: string): VerifyCheck {
	const sigPath = `${tgzPath}.sig`;
	if (!fs.existsSync(sigPath))
		return { item: "包级签名", ok: false, code: "sig_missing", detail: `${path.basename(tgzPath)}：缺 .tgz.sig（sig_missing）——用 ojm market publish 重发，或向发布方索取签名包` };
	try {
		const sig = JSON.parse(fs.readFileSync(sigPath, "utf-8")) as { public_key?: string, value?: string, canon?: string, registry_id?: string };
		// REG-CS3：规范串版本标记必须 v2（旧 ojm 签的 v1 .sig 一律拒，不兼容，逼重签）
		if (sig.canon !== CANON)
			return { item: "包级签名", ok: false, code: "canon_stale", detail: `${path.basename(sigPath)}：规范串版本过旧（${sig.canon ?? "缺失"}，本机要求 ${CANON}）——请用当前 ojm 重签` };
		const canonical = canonicalString(sig.registry_id ?? "", name, version, sha256);
		const ok = hasSigFields(sig) && verifyCanonical(sig.public_key, canonical, sig.value);
		return {
			item: "包级签名",
			ok,
			code: ok ? undefined : "signature_mismatch",
			detail: ok
				? `${path.basename(tgzPath)}：Ed25519 验签通过（registry_id ${sig.registry_id ?? "∅"}，规范串 ${sig.registry_id ?? "∅"}:${name}@${version}:${sha256.slice(0, 12)}…）`
				: `${path.basename(tgzPath)}：验签失败（signature_mismatch）——包体被改或签名不匹配，请用当前 ojm 重签`,
		};
	}
	catch (error) {
		return { item: "包级签名", ok: false, detail: `${path.basename(sigPath)} 不可解析：${(error as Error).message}` };
	}
}

/**
 * 索引级验签（REG-CS1①：fail-closed，缺签名即拒，不再「运行期容忍」）。
 *
 * 为什么不能容忍：容忍等于把「索引完整性」交给发布方的自觉——谁改了 catalog.yaml 都能装。
 * 规范串带 seq（`index:<kind>:<seq>:<sha256>`），故 `.sig` 必须带 seq 才可能验过。
 * 分片（kind=shard）的 seq 不取自正文（纯内容无元字段），由 catalog 的 `shards` 钉值在
 * 同代校验里核对；此处只验「签名本身与字节匹配且覆盖代次」。
 */
function indexSigCheck(sigPath: string, label: string, kind: IndexKind, text: string | null): VerifyCheck {
	if (text === null)
		return { item: "索引签名", ok: true, detail: `${label} 不存在，跳过` };
	if (!fs.existsSync(sigPath)) {
		return {
			item: "索引签名",
			ok: false,
			code: "index_sig_missing",
			detail: `${label}.sig 缺失（index_sig_missing）——完整性无保障，安装侧会拒装。下一步：① ojm market build-index --id <publisher.id> 重建并签名；② 或对既有索引补签 ojm publish <目录> --id <publisher.id>`,
		};
	}
	try {
		const sig = JSON.parse(fs.readFileSync(sigPath, "utf-8")) as { public_key?: string, value?: string, seq?: unknown };
		const seq = sigSeqOf(sig);
		if (seq === null)
			return { item: "索引签名", ok: false, code: "index_sig_mismatch", detail: `${label}.sig 缺 seq 字段——签名未覆盖代次，请用当前 ojm 重签` };
		const ok = hasSigFields(sig) && verifyCanonical(sig.public_key, indexCanonical(kind, seq, text), sig.value);
		return {
			item: "索引签名",
			ok,
			code: ok ? undefined : "index_sig_mismatch",
			detail: ok
				? `${label} 验签通过（第 ${seq} 代）`
				: `${label} 验签失败（index_sig_mismatch）——索引被改或签名不符`,
		};
	}
	catch (error) {
		return { item: "索引签名", ok: false, code: "index_sig_mismatch", detail: `${label}.sig 不可解析：${(error as Error).message}` };
	}
}

/** `.sig` 的 seq 字段（非正整数即 null——代次必须是可比较的整数） */
function sigSeqOf(sig: { seq?: unknown }): number | null {
	const seq = sig.seq;
	return typeof seq === "number" && Number.isInteger(seq) && seq >= 1 ? seq : null;
}

/**
 * REG-CS1② 同代校验（三级化）：代次真源 = **catalog**（顶层 `seq` + `shards` 钉值表）。
 *
 * 每片被 catalog 钉住一个代次，其 `.sig.seq` 必须等于钉值——不允许把「新总目录」和
 * 「对不上代的分册」拼起来用（红队 F2：写索引写到一半进程被杀就会留下这种中间态）。
 * 未变的片沿用旧代次是**设计允许**的（内容逐字节未动，拼起来永远同代同内容），
 * 判定口径因此是「签名代次 == catalog 钉值」而非「== catalog 代次」。
 * 这是**运维事故**不是安全事件，所以错误码与「签名不符」分开，提示也指向「稍后重试」。
 */
export function generationCheck(index: IndexSnapshot): VerifyCheck {
	const present = index.catalogText !== null;
	if (!present && index.shardTexts.size === 0)
		return { item: "索引同代", ok: true, detail: "索引文件缺失，跳过同代校验" };
	if (!present) {
		return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `catalog.yaml 缺失但 shards/ 里有 ${index.shardTexts.size} 片——源正在重建索引或索引被手改，请稍后重试（index_generation_mismatch）` };
	}
	const catalogSeq = indexSeqOf(index.catalogText!);
	if (catalogSeq === null)
		return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: "catalog.yaml 缺顶层 seq 字段——用 ojm market build-index 重建索引" };
	// catalog 正文代次与签名代次必须一致（防「改了正文没换签名」的半个写入）
	const catalogSigSeq = sigSeqOf(readSigJson(`${index.catalogPath}.sig`));
	if (catalogSigSeq !== catalogSeq)
		return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `catalog.yaml 正文是第 ${catalogSeq} 代、签名是第 ${String(catalogSigSeq ?? "无")} 代——源正在重建索引，请稍后重试（index_generation_mismatch）` };
	const pins = shardPinsOf(index.catalogText!);
	for (const [no, pinSeq] of pins) {
		const sig = readSigJson(path.join(index.shardsDir, `${no}.yaml.sig`));
		const sigSeq = sigSeqOf(sig);
		if (sigSeq === null)
			return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `shards/${no}.yaml 签名代次不可判定（catalog 钉第 ${pinSeq} 代）——请用当前 ojm 重签` };
		if (sigSeq !== pinSeq)
			return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `shards/${no}.yaml 签名是第 ${sigSeq} 代，catalog 钉的是第 ${pinSeq} 代——源正在重建索引，请稍后重试（index_generation_mismatch）` };
	}
	return { item: "索引同代", ok: true, detail: `catalog 第 ${catalogSeq} 代，${pins.size} 片代次与钉值一致` };
}

/** 读 .sig JSON（不可解析 → 空对象，由调用方按 fail-closed 处理） */
function readSigJson(sigPath: string): { seq?: unknown } {
	try {
		return JSON.parse(fs.readFileSync(sigPath, "utf-8")) as { seq?: unknown };
	}
	catch {
		return {};
	}
}

/**
 * REG-CS2 索引时效：catalog 自带 `issued_at` / `expires_at`，过了失效时刻的索引不能再用来装。
 * 与站点 `market/api.ts guardCatalogFreshness` 同一判定（CLI/API 一致，D1）。
 */
export function expiryCheck(text: string | null): VerifyCheck {
	if (text === null)
		return { item: "索引时效", ok: true, detail: "索引文件缺失，跳过时效校验" };
	const times = indexTimesOf(text);
	if (times === null)
		return { item: "索引时效", ok: false, code: "index_expired", detail: "catalog.yaml 缺 issued_at / expires_at——索引未带时效，用 ojm market build-index 重建" };
	const now = Math.floor(Date.now() / 1000);
	const ok = now <= times.expires_at;
	const at = new Date(times.expires_at * 1000).toISOString();
	return {
		item: "索引时效",
		ok,
		code: ok ? undefined : "index_expired",
		detail: ok
			? `索引有效至 ${at}`
			: `索引已于 ${at} 失效（index_expired）——源未在其自声明的有效期内重建，请重建后再发布`,
	};
}

/** manifest 结构：必填字段 + 内嵌原生清单 desc 非空（等值要求已移除，见 §9.3） */
function structureCheck(bytes: Uint8Array, file: string): VerifyCheck[] {
	let entries: ReturnType<typeof readTgz>;
	try {
		entries = readTgz(bytes);
	}
	catch (error) {
		return [{ item: "manifest 结构", ok: false, detail: `${file}：包无法解开（${(error as Error).message}）` }];
	}
	const root = entries.find(e => /^(?:[^/]+\/)?manifest\.yaml$/.test(e.name));
	if (root === undefined)
		return [{ item: "manifest 结构", ok: false, detail: `${file}：包内缺 manifest.yaml` }];
	const manifest = (yamlParse(root.content.toString("utf-8")) ?? {}) as Record<string, unknown>;
	const missing = ["name", "version", "summary", "peerRuntime", "archive"].filter(k => manifest[k] === undefined);
	const out: VerifyCheck[] = [{
		item: "manifest 结构",
		ok: missing.length === 0,
		detail: missing.length === 0
			? `${file}：必填字段齐备（name/version/summary/peerRuntime/archive）`
			: `${file}：缺必填字段 ${missing.join(", ")}`,
	}];

	const inner = entries.find(e => /^api\/[^/]+\/manifest\.yaml$/.test(e.name));
	if (inner !== undefined) {
		const innerManifest = (yamlParse(inner.content.toString("utf-8")) ?? {}) as Record<string, unknown>;
		const desc = innerManifest.desc;
		const ok = typeof desc === "string" && desc.trim() !== "";
		out.push({
			item: "manifest 结构",
			ok,
			detail: ok
				? `${file}：原生清单 desc 非空（oj 装配面必填）`
				: `${file}：原生清单 desc 缺失或空白——oj 启动装配会失败`,
		});
	}
	return out;
}

/** 同方案各版本的 0001 迁移必须逐字节一致（否则升级链的迁移校验会假失败） */
function migrationConsistencyCheck(cdnDir: string, files: string[]): VerifyCheck[] {
	const byName = new Map<string, Array<{ version: string, bytes: string }>>();
	for (const file of files) {
		const abs = path.isAbsolute(file) ? file : path.join(cdnDir, file);
		if (!fs.existsSync(abs))
			continue;
		let entries: ReturnType<typeof readTgz>;
		try {
			entries = readTgz(new Uint8Array(fs.readFileSync(abs)));
		}
		catch {
			continue;
		}
		const mig = entries.find(e => /\/migrations\/0001[^/]*\.sql$/.test(e.name));
		if (mig === undefined)
			continue;
		const name = nameOf(file);
		const list = byName.get(name) ?? [];
		list.push({ version: versionOf(file), bytes: createHash("sha256").update(mig.content).digest("hex") });
		byName.set(name, list);
	}
	const out: VerifyCheck[] = [];
	for (const [name, list] of byName) {
		if (list.length < 2)
			continue;
		const first = list[0]!.bytes;
		const bad = list.filter(v => v.bytes !== first).map(v => v.version);
		out.push({
			item: "manifest 结构",
			ok: bad.length === 0,
			detail: bad.length === 0
				? `${name}：各版本 0001 迁移逐字节一致`
				: `${name}：0001 迁移在版本 ${bad.join(", ")} 与首版不一致——升级链会报迁移缺失，须只增不改`,
		});
	}
	return out;
}

/** 扫描重建出的索引与盘上索引双向比对：检出「落了包没重建 / 索引被手改 / 索引多条目」 */
function driftOf(cdnDir: string, index: IndexSnapshot): string[] {
	const out: string[] = [];
	const files = fs.readdirSync(cdnDir).filter(f => f.endsWith(".tgz")).sort();
	const scanned: IndexedPackage[] = [];
	for (const file of files) {
		const bytes = new Uint8Array(fs.readFileSync(path.join(cdnDir, file)));
		const entries = readTgz(bytes);
		const root = entries.find(e => /^(?:[^/]+\/)?manifest\.yaml$/.test(e.name));
		if (root === undefined)
			continue;
		const manifest = (yamlParse(root.content.toString("utf-8")) ?? {}) as Record<string, unknown>;
		const name = String(manifest.name ?? "");
		const version = String(manifest.version ?? "");
		if (name === "" || version === "")
			continue;
		scanned.push({ name, version, file, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength, manifest });
	}
	if (index.catalogText === null) {
		if (scanned.length > 0)
			out.push(`盘上没有 catalog.yaml，但目录里有 ${scanned.length} 个包——索引从未重建`);
		return out;
	}
	// 三级化后版本明细住在分片里：全集 = 各片 solutions[].versions
	const inIndex = new Set<string>();
	for (const text of index.shardTexts.values()) {
		if (text === null)
			continue;
		const doc = (yamlParse(text) ?? { solutions: [] }) as { solutions?: Array<Record<string, unknown>> };
		for (const solution of doc.solutions ?? []) {
			const name = String(solution.name ?? "");
			for (const v of (solution.versions ?? []) as Array<Record<string, unknown>>)
				inIndex.add(`${name}@${String(v.version ?? "")}`);
		}
	}
	const onDisk = new Set(scanned.map(p => `${p.name}@${p.version}`));
	for (const pkg of scanned) {
		if (!inIndex.has(`${pkg.name}@${pkg.version}`))
			out.push(`索引缺条目：${pkg.name}@${pkg.version}（${pkg.file}）——落了包但没跑 ojm market build-index`);
	}
	// 反向漂移：索引钉了某个版本、盘上却没有对应 tgz（包被删/被挤走没重建）——
	// 只查正向会让「索引答应有、实际没有」悄悄漏过去，安装侧拉到 404 才知道
	for (const key of inIndex) {
		if (onDisk.has(key))
			continue;
		const [name, version] = key.split("@") as [string, string];
		out.push(`索引多条目：${name}@${version}——索引声明了该版本但 cdn/ 里没有 ${name}-${version}.tgz，跑 ojm market build-index 重建`);
	}
	return out;
}

/** 索引声明的 `name@version → sha256`（三级化后声明住在分片正文的 archive.sha256） */
function declaredHashes(index: IndexSnapshot): Map<string, string> {
	const out = new Map<string, string>();
	for (const text of index.shardTexts.values()) {
		if (text === null)
			continue;
		const doc = (yamlParse(text) ?? { solutions: [] }) as { solutions?: Array<Record<string, unknown>> };
		for (const solution of doc.solutions ?? []) {
			const name = String(solution.name ?? "");
			for (const v of (solution.versions ?? []) as Array<Record<string, unknown>>) {
				const archive = v.archive as Record<string, unknown> | undefined;
				const sha = archive?.sha256;
				if (typeof sha === "string")
					out.set(`${name}@${String(v.version ?? "")}`, sha);
			}
		}
	}
	return out;
}

function readOptional(file: string): string | null {
	return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
}

/** `<name>-<version>.tgz` → name（取最后一个 - 之前，版本段不含 -） */
function nameOf(file: string): string {
	const base = path.basename(file).replace(/\.tgz$/, "");
	const at = base.lastIndexOf("-");
	return at === -1 ? base : base.slice(0, at);
}

function versionOf(file: string): string {
	const base = path.basename(file).replace(/\.tgz$/, "");
	const at = base.lastIndexOf("-");
	return at === -1 ? "" : base.slice(at + 1);
}
