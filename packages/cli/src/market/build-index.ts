/**
 * `ojm market build-index`（T4）：扫描 `cdn/*.tgz` → 提取内嵌 manifest → 全量重建两份索引并签名。
 *
 * 为什么不增量合并：索引是**共享可变单文件**，多人发布时读-改-写天然 TOCTOU，且索引签名会被
 * 后发者覆盖。而 `market/api.ts verifyIndexSig` 注释已写明「索引签名只做完整性，信任由 TOFU/
 * 信任库承载」——索引本就不是信任锚，那就把它降级为派生产物：谁都能重建，重建结果只取决于目录内容。
 */

import type { IndexedPackage } from "./index-builder";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { stringify as yamlStringify } from "yaml";
import { recomputeIndex, signIndex } from "../publish";
import { resolveCdnLayout } from "./cdn-layout";
import { buildIndexData } from "./index-builder";
import { readEmbeddedManifest } from "./scan";

export interface BuildIndexOptions {
	projectRoot?: string
	id?: string
	key?: string
	privateKeyPem?: string
	/** 重建后离线自检（verifyCanonical 复核两份索引签名） */
	check?: boolean
}

export interface BuildIndexResult {
	bundlesPath: string
	manifestsPath: string
	bundlesSigPath: string
	manifestsSigPath: string
	/** 入索引的方案数 */
	solutions: number
	/** 因缺内嵌 manifest 等原因被跳过的文件名 */
	skipped: string[]
	checkPassed?: boolean
}

export async function buildIndex(opts: BuildIndexOptions = {}): Promise<BuildIndexResult> {
	const projectRoot = opts.projectRoot ?? process.cwd();
	const layout = resolveCdnLayout(projectRoot);
	if (!fs.existsSync(layout.dir))
		throw new Error(`[ojm] CDN 目录不存在：${layout.dir}（先跑 ojm market publish，或检查 config 的 /cdn 挂载）`);

	const files = fs.readdirSync(layout.dir).filter(f => f.endsWith(".tgz")).sort();
	const packages: IndexedPackage[] = [];
	const skipped: string[] = [];
	for (const file of files) {
		const abs = path.join(layout.dir, file);
		const bytes = new Uint8Array(fs.readFileSync(abs));
		let manifest: Record<string, unknown> | null = null;
		try {
			manifest = readEmbeddedManifest(bytes);
		}
		catch (error) {
			console.warn(`[ojm] 跳过 ${file}：${(error as Error).message}`);
		}
		const name = typeof manifest?.name === "string" ? manifest.name as string : "";
		const version = typeof manifest?.version === "string" ? manifest.version as string : "";
		if (manifest === null || name === "" || version === "") {
			skipped.push(file);
			console.warn(`[ojm] 跳过 ${file}：包内缺 manifest.yaml 或缺少 name/version`);
			continue;
		}
		packages.push({
			name,
			version,
			file,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			size: bytes.byteLength,
			manifest,
			signature: readSidecarSig(abs),
		});
	}

	const data = buildIndexData(packages);
	const bundlesText = normalizeYaml(data.bundles);
	const manifestsText = normalizeYaml(data.manifests);
	const bundlesPath = path.join(layout.dir, "bundles.yaml");
	const manifestsPath = path.join(layout.dir, "manifests.yaml");
	fs.writeFileSync(bundlesPath, bundlesText);
	fs.writeFileSync(manifestsPath, manifestsText);

	// 索引是多人协作产物：格式再 determinism 一次（recomputeIndex 即 sortKeysDeep + 确定性 stringify）
	const signed = signIndexes({ bundlesPath, manifestsPath, id: opts.id, key: opts.key, privateKeyPem: opts.privateKeyPem });

	console.log(`[ojm] 索引已重建：${data.bundles.solutions.length} 个方案 / ${packages.length} 个版本（来源 ${files.length} 个 tgz）`);
	if (skipped.length > 0)
		console.warn(`[ojm] ${skipped.length} 个包被跳过：${skipped.join(", ")}`);

	return {
		bundlesPath,
		manifestsPath,
		bundlesSigPath: signed.bundlesSigPath,
		manifestsSigPath: signed.manifestsSigPath,
		solutions: data.bundles.solutions.length,
		skipped,
	};
}

/**
 * 读包级 detached 签名侧车（`<tgz>.sig`），转成 Form B `archive.signature`。
 *
 * 为什么非读不可：安装器 verifying 段只认 Form B 的 archive.signature（同目录侧车不参与判定），
 * 没有它一律 `sig_missing` 硬 fail-closed——索引是「包 + 签名」的聚合视图，少带签名等于把包报成不可装。
 */
function readSidecarSig(tgzPath: string): Record<string, unknown> | undefined {
	const sigPath = `${tgzPath}.sig`;
	if (!fs.existsSync(sigPath))
		return undefined;
	try {
		const parsed = JSON.parse(fs.readFileSync(sigPath, "utf-8")) as unknown;
		return isObj(parsed) ? parsed as Record<string, unknown> : undefined;
	}
	catch {
		console.warn(`[ojm] ${sigPath} 不是合法 JSON，已按无签名处理（该包会被安装器以 sig_missing 拒装）`);
		return undefined;
	}
}

function isObj(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 确定性 stringify：键序归一 + 无软换行，和既有 publish 的索引口径逐字一致 */
function normalizeYaml(value: unknown): string {
	return recomputeIndex(yamlStringify(value, { lineWidth: 0 }));
}

function signIndexes(args: { bundlesPath: string, manifestsPath: string, id?: string, key?: string, privateKeyPem?: string }): { bundlesSigPath: string, manifestsSigPath: string } {
	const pem = args.privateKeyPem ?? readPemFrom(args.id, args.key);
	const keyId = args.id ?? "";
	if (keyId === "")
		throw new Error("[ojm] 重建索引须给签名身份：--id <publisher.id>（.sig 的发布方标识；C2-37 命名空间）");
	const bundlesText = fs.readFileSync(args.bundlesPath, "utf-8");
	const manifestsText = fs.readFileSync(args.manifestsPath, "utf-8");
	const bundlesSig = signIndex("bundles", bundlesText, pem, keyId);
	const manifestsSig = signIndex("manifests", manifestsText, pem, keyId);
	const bundlesSigPath = `${args.bundlesPath}.sig`;
	const manifestsSigPath = `${args.manifestsPath}.sig`;
	fs.writeFileSync(bundlesSigPath, `${JSON.stringify(bundlesSig, null, 2)}\n`);
	fs.writeFileSync(manifestsSigPath, `${JSON.stringify(manifestsSig, null, 2)}\n`);
	console.log(`[ojm] 索引签名已写出（发布方 ${keyId}）`);
	return { bundlesSigPath, manifestsSigPath };
}

/** 从身份目录或私钥文件读出 PEM（磁盘路径是常规场景；隔离场景应直接传内存 PEM） */
function readPemFrom(id?: string, key?: string): string {
	const fsKey = key ?? (id === undefined ? undefined : path.join(os.homedir(), ".ojm", "keys", id, "private.pem"));
	if (fsKey === undefined)
		throw new Error("[ojm] 缺少签名身份：--id <publisher.id> 或 --key <pem 路径>");
	if (!fs.existsSync(fsKey))
		throw new Error(`[ojm] 私钥文件不存在：${fsKey}（用 ojm keygen --id ${id} 生成）`);
	return fs.readFileSync(fsKey, "utf-8");
}
