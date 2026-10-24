/**
 * `ojm market verify`（T7）：离线验包——不起站点、不装、不要凭据、不要 DB。
 *
 * 分四类列结果（包级与索引级**分开**，因为语义不同）：
 * - 完整性：tgz 实际 sha256 与索引声明的 archive.sha256 是否一致；
 * - 包级签名：`<tgz>.sig` 能否用包内公钥复核规范串 `<name>@<version>:<sha256>`——**这是信任锚**；
 * - 索引签名：索引字节与其 `.sig`——只是完整性层（防目录/索引被改），不是信任锚；
 * - manifest 结构：必填字段、内嵌原生清单 desc 是否非空（oj 装配面必填）、同方案各版本 0001 迁移是否逐字节一致。
 *
 * 复用既有原语，一行密码学都不重写：`lifecycle/sign.ts` 的 canonicalString/verifyCanonical、
 * `publish.ts` 的 indexCanonical、`node:crypto` 的 sha256。
 */

import type { IndexKind } from "../publish";
import type { IndexedPackage } from "./index-builder";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import process from "node:process";
import { parse as yamlParse } from "yaml";
import { canonicalString, verifyCanonical } from "../lifecycle/sign";
import { indexCanonical, indexSeqOf, indexTimesOf } from "../publish";
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

export function verifyMarket(opts: VerifyOptions = {}): VerifyResult {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const layout = resolveCdnLayout(projectRoot);
	const checks: VerifyCheck[] = [];
	const drift: string[] = [];

	const bundlesText = readOptional(path.join(layout.dir, "bundles.yaml"));
	const manifestsText = readOptional(path.join(layout.dir, "manifests.yaml"));
	const declared = declaredHashes(manifestsText);

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

	checks.push(indexSigCheck(layout.dir, "bundles", bundlesText));
	checks.push(indexSigCheck(layout.dir, "manifests", manifestsText));
	checks.push(generationCheck(layout.dir, [{ kind: "bundles", text: bundlesText }, { kind: "manifests", text: manifestsText }]));
	checks.push(expiryCheck(bundlesText));
	checks.push(...migrationConsistencyCheck(layout.dir, tgzFiles));

	if (opts.rebuildCheck === true)
		drift.push(...driftOf(layout.dir));

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

/**
 * `.sig` 里验签只用到 public_key / value 两字段；缺任一即不可复核。
 * 抽成类型守卫：包级与索引级两处验签共用（DRY），也顺带让调用点的布尔式保持单行
 * （本仓 indent-binary-ops 与 no-mixed-spaces-and-tabs 对续行缩进的要求互相打架）。
 */
function hasSigFields(sig: { public_key?: string, value?: string }): sig is { public_key: string, value: string } {
	return typeof sig.public_key === "string" && typeof sig.value === "string";
}

/** 包级 detached 验签：`<tgz>.sig` 的公钥复核规范串 */
function signatureCheck(tgzPath: string, name: string, version: string, sha256: string): VerifyCheck {
	const sigPath = `${tgzPath}.sig`;
	if (!fs.existsSync(sigPath))
		return { item: "包级签名", ok: false, detail: `${path.basename(tgzPath)}：缺 .tgz.sig（sig_missing）——用 ojm market publish 重发，或向发布方索取签名包` };
	try {
		const sig = JSON.parse(fs.readFileSync(sigPath, "utf-8")) as { public_key?: string, value?: string };
		const canonical = canonicalString(name, version, sha256);
		const ok = hasSigFields(sig) && verifyCanonical(sig.public_key, canonical, sig.value);
		return {
			item: "包级签名",
			ok,
			detail: ok
				? `${path.basename(tgzPath)}：Ed25519 验签通过（规范串 ${name}@${version}:${sha256.slice(0, 12)}…）`
				: `${path.basename(tgzPath)}：验签失败——包体被改或签名不匹配`,
		};
	}
	catch (error) {
		return { item: "包级签名", ok: false, detail: `${path.basename(sigPath)} 不可解析：${(error as Error).message}` };
	}
}

/**
 * 索引级验签（REG-CS1①：fail-closed，缺签名即拒，不再「运行期容忍」）。
 *
 * 为什么不能容忍：容忍等于把「索引完整性」交给发布方的自觉——谁改了 bundles.yaml 都能装。
 * 规范串带 seq（`index:<kind>:<seq>:<sha256>`），故 `.sig` 必须带 seq 才可能验过。
 */
function indexSigCheck(cdnDir: string, kind: IndexKind, text: string | null): VerifyCheck {
	if (text === null)
		return { item: "索引签名", ok: true, detail: `${kind}.yaml 不存在，跳过` };
	const sigPath = path.join(cdnDir, `${kind}.yaml.sig`);
	if (!fs.existsSync(sigPath)) {
		return {
			item: "索引签名",
			ok: false,
			code: "index_sig_missing",
			detail: `${kind}.yaml.sig 缺失（index_sig_missing）——完整性无保障，安装侧会拒装。下一步：① ojm market build-index --id <publisher.id> 重建并签名；② 或对既有索引补签 ojm publish <目录> --id <publisher.id>`,
		};
	}
	try {
		const sig = JSON.parse(fs.readFileSync(sigPath, "utf-8")) as { public_key?: string, value?: string, seq?: unknown };
		const seq = sigSeqOf(sig);
		if (seq === null)
			return { item: "索引签名", ok: false, code: "index_sig_mismatch", detail: `${kind}.yaml.sig 缺 seq 字段——签名未覆盖代次，请用当前 ojm 重签` };
		const ok = hasSigFields(sig) && verifyCanonical(sig.public_key, indexCanonical(kind, seq, text), sig.value);
		return {
			item: "索引签名",
			ok,
			code: ok ? undefined : "index_sig_mismatch",
			detail: ok
				? `${kind}.yaml 验签通过（第 ${seq} 代）`
				: `${kind}.yaml 验签失败（index_sig_mismatch）——索引被改或签名不符`,
		};
	}
	catch (error) {
		return { item: "索引签名", ok: false, code: "index_sig_mismatch", detail: `${kind}.yaml.sig 不可解析：${(error as Error).message}` };
	}
}

/** `.sig` 的 seq 字段（非正整数即 null——代次必须是可比较的整数） */
function sigSeqOf(sig: { seq?: unknown }): number | null {
	const seq = sig.seq;
	return typeof seq === "number" && Number.isInteger(seq) && seq >= 1 ? seq : null;
}

/**
 * REG-CS1② 同代校验：代次真源 = **catalog**（bundles.yaml 顶层 `seq`）。
 *
 * 每份索引的正文 seq（若有）与 `.sig.seq` 都必须等于它——不允许把「今年的总目录」和
 * 「去年的分册」拼起来用（红队 F2：写索引写到一半进程被杀就会留下这种中间态）。
 * 这是**运维事故**不是安全事件，所以错误码与「签名不符」分开，提示也指向「稍后重试」。
 */
export function generationCheck(cdnDir: string, files: Array<{ kind: IndexKind, text: string | null }>): VerifyCheck {
	const present = files.filter(f => f.text !== null);
	if (present.length === 0)
		return { item: "索引同代", ok: true, detail: "索引文件缺失，跳过同代校验" };
	const catalog = present[0]!;
	const catalogSeq = indexSeqOf(catalog.text!);
	if (catalogSeq === null)
		return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `${catalog.kind}.yaml 缺顶层 seq 字段——用 ojm market build-index 重建索引` };
	for (const f of present) {
		const textSeq = indexSeqOf(f.text!);
		if (textSeq !== null && textSeq !== catalogSeq)
			return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `${f.kind}.yaml 正文是第 ${textSeq} 代，catalog 是第 ${catalogSeq} 代——源正在重建索引，请稍后重试（index_generation_mismatch）` };
		let sig: { seq?: unknown };
		try {
			sig = JSON.parse(fs.readFileSync(path.join(cdnDir, `${f.kind}.yaml.sig`), "utf-8")) as { seq?: unknown };
		}
		catch {
			return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `${f.kind}.yaml.sig 不可解析，无法判定代次` };
		}
		const sigSeq = sigSeqOf(sig);
		if (sigSeq === null)
			return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `${f.kind}.yaml.sig 缺 seq，无法判定代次——请用当前 ojm 重签` };
		if (sigSeq !== catalogSeq)
			return { item: "索引同代", ok: false, code: "index_generation_mismatch", detail: `${f.kind}.yaml 签名是第 ${sigSeq} 代，catalog 是第 ${catalogSeq} 代——源正在重建索引，请稍后重试（index_generation_mismatch）` };
	}
	return { item: "索引同代", ok: true, detail: `全部索引同代（seq=${catalogSeq}）` };
}

/**
 * REG-CS2 索引时效：总目录自带 `issued_at` / `expires_at`，过了失效时刻的索引不能再用来装。
 * 与站点 `market/api.ts guardCatalogFreshness` 同一判定（CLI/API 一致，D1）。
 */
export function expiryCheck(text: string | null): VerifyCheck {
	if (text === null)
		return { item: "索引时效", ok: true, detail: "索引文件缺失，跳过时效校验" };
	const times = indexTimesOf(text);
	if (times === null)
		return { item: "索引时效", ok: false, code: "index_expired", detail: "bundles.yaml 缺 issued_at / expires_at——索引未带时效，用 ojm market build-index 重建" };
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

/** 扫描重建出的索引与盘上索引比对，检出「落了包没重建 / 索引被手改」 */
function driftOf(cdnDir: string): string[] {
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
	const onDisk = readOptional(path.join(cdnDir, "bundles.yaml"));
	if (onDisk === null) {
		if (scanned.length > 0)
			out.push(`盘上没有 bundles.yaml，但目录里有 ${scanned.length} 个包——索引从未重建`);
		return out;
	}
	const parsed = (yamlParse(onDisk) ?? { solutions: [] }) as { solutions?: Array<Record<string, unknown>> };
	const inIndex = new Set<string>();
	for (const solution of parsed.solutions ?? []) {
		const name = String(solution.name ?? "");
		for (const v of (solution.versions ?? []) as Array<Record<string, unknown>>)
			inIndex.add(`${name}@${String(v.version ?? "")}`);
	}
	for (const pkg of scanned) {
		if (!inIndex.has(`${pkg.name}@${pkg.version}`))
			out.push(`索引缺条目：${pkg.name}@${pkg.version}（${pkg.file}）——落了包但没跑 ojm market build-index`);
	}
	return out;
}

function declaredHashes(manifestsText: string | null): Map<string, string> {
	const out = new Map<string, string>();
	if (manifestsText === null)
		return out;
	const list = (yamlParse(manifestsText) ?? []) as Array<Record<string, unknown>>;
	for (const item of Array.isArray(list) ? list : []) {
		const archive = item.archive as Record<string, unknown> | undefined;
		const sha = archive?.sha256;
		if (typeof sha === "string")
			out.set(`${String(item.name ?? "")}@${String(item.version ?? "")}`, sha);
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
