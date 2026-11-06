/**
 * `ojm market verify`（A6 瘦身）：离线验包——不起站点、不装、不要凭据、不要 DB。
 *
 * v4 DB 目录化后**只剩包级面**（计划退役清单点名：generationCheck/driftOf/declaredHashes
 * 等索引面整建制删除——目录真源已移交站点 market_release 表，索引文件不复存在）：
 * - 包级签名：`<tgz>.sig` 能否用包内公钥复核规范串 `<registry_id>:<name>@<version>:<sha256>`
 *   ——**这是信任锚**（安装侧 TOFU 的同一道验签）；
 * - manifest 结构：必填字段、内嵌原生清单 desc 是否非空（oj 装配面必填）、同方案各版本
 *   0001 迁移是否逐字节一致。
 *
 * 完整性（sha256 对索引声明比对）随之退役——声明真源是站点 DB 行，离线 CLI 无声明可比；
 * 字节-声明一致性由上传端点服务端重算 sha256 硬约束在写通道守住。
 *
 * 复用既有原语，一行密码学都不重写：`lifecycle/sign.ts` 的 canonicalString/verifyCanonical、
 * `scan.ts` 的 readTgz、`node:crypto` 的 sha256。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import process from "node:process";
import { parse as yamlParse } from "yaml";
import { CANON, canonicalString, verifyCanonical } from "../lifecycle/sign";
import { resolveCdnLayout } from "./cdn-layout";
import { readTgz } from "./scan";

export interface VerifyCheck {
	item: string
	ok: boolean
	detail: string
	/** 失败码：可区分的拒因（包级面），供报告侧共用同一套判定 */
	code?: string
}

export interface VerifyOptions {
	projectRoot?: string
	/** 验指定的 tgz（缺省扫 cdn/ 下全部包） */
	file?: string
}

export interface VerifyResult {
	checks: VerifyCheck[]
	passed: boolean
	conclusion: string
}

const BOUNDARY = "完整性 / 来源校验通过——不构成内容安全性背书";

export function verifyMarket(opts: VerifyOptions = {}): VerifyResult {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const layout = resolveCdnLayout(projectRoot);
	const checks: VerifyCheck[] = [];

	const tgzFiles = opts.file !== undefined
		? [opts.file]
		: fs.existsSync(layout.dir) ? fs.readdirSync(layout.dir).filter(f => f.endsWith(".tgz")).sort() : [];

	for (const file of tgzFiles) {
		const tgzPath = path.isAbsolute(file) ? file : path.join(layout.dir, file);
		if (!fs.existsSync(tgzPath)) {
			checks.push({ item: "包级签名", ok: false, detail: `${file}：文件不存在` });
			continue;
		}
		const bytes = new Uint8Array(fs.readFileSync(tgzPath));
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const name = nameOf(file);
		const version = versionOf(file);

		checks.push(signatureCheck(tgzPath, name, version, sha256));
		checks.push(...structureCheck(bytes, file));
	}
	checks.push(...migrationConsistencyCheck(layout.dir, tgzFiles));

	const passed = checks.every(c => c.ok);
	return {
		checks,
		passed,
		conclusion: passed
			? `全部校验通过（${checks.length} 项）。${BOUNDARY}——验签过只说明来源与完整性，不说明代码无害。`
			: `存在未通过项。${BOUNDARY}：未通过项须逐条排查后再发布。`,
	};
}

/**
 * `.sig` 里验签只用到 public_key / value 两字段；缺任一即不可复核。
 * 抽成类型守卫让调用点的布尔式保持单行（本仓 indent-binary-ops 与 no-mixed-spaces-and-tabs
 * 对续行缩进的要求互相打架）。
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
 * manifest 结构：必填字段 + 内嵌原生清单 desc 非空（等值要求已移除，见 §9.3）。
 *  必填不含 archive：契约 C2-29 允许 Form A 整体省略，`ojm build --bundle` 对真实方案的
 * 落盘形态即省略（fixture 会写 file 占位）——把它当必填会让一切真实工程包验包必红。
 */
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
	const missing = ["name", "version", "summary", "peerRuntime"].filter(k => manifest[k] === undefined);
	const out: VerifyCheck[] = [{
		item: "manifest 结构",
		ok: missing.length === 0,
		detail: missing.length === 0
			? `${file}：必填字段齐备（name/version/summary/peerRuntime）`
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
