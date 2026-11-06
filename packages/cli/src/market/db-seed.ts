/**
 * market_release 直写 seed（A6，计划 v4 §五「站点内部通道，不走上传签名面」）：
 * `ojm market trial` / `walkthrough` 的隔离站点目录来源。
 *
 * 为什么直写 DB：DB 目录化后安装解析/index 卡片/releases 全部直读 market_release 表——
 * 隔离站点要把 fixture 变成「可装」，必须让目录行存在；上传签名面是给发布者的远端通道，
 * 试车夹具不该依赖它（签名/信任库/限速全是被测面之外的噪音）。oj serve 起站时迁移已
 * 应用（migrate_on_start），本模块在其后单写——隔离场景 CLI 是唯一写者，无并发。
 *
 * 行内容与上传端点落库口径同源：sha256/size 实重算、签名四列取 .sig 旁车、manifest 取
 * 包内嵌抽取物（clamp 口径照抄服务端钳制——catalog 展示字段 ≤200/≤2000，全量 manifest
 * 仍在包内）。
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { parse as yamlParse } from "yaml";
import { readTgz } from "./scan";

/** .sig 旁车六字段（与契约 C2-35 同构） */
interface SidecarSig {
	alg: string
	key_id: string
	public_key: string
	value: string
	canon: string
	registry_id: string
}

function parseSidecar(tgzPath: string): SidecarSig {
	const sig = JSON.parse(readFileSync(`${tgzPath}.sig`, "utf-8")) as Partial<SidecarSig>;
	const missing = (["alg", "key_id", "public_key", "value", "registry_id"] as const).filter(k => typeof sig[k] !== "string");
	if (missing.length > 0)
		throw new Error(`[ojm] seed 目录行失败：${tgzPath}.sig 旁车字段不全（须 alg/key_id/public_key/value/registry_id；缺 ${missing.join("/")}）`);
	return sig as SidecarSig;
}

/** 包内嵌根 manifest 抽取物（坏包 fail-closed：试车夹具不该有坏包） */
function manifestOf(tgzPath: string): Record<string, unknown> {
	const entries = readTgz(new Uint8Array(readFileSync(tgzPath)));
	const root = entries.find(e => /^(?:[^/]+\/)?manifest\.yaml$/.test(e.name));
	if (root === undefined)
		throw new Error(`[ojm] seed 目录行失败：${tgzPath} 包内缺 manifest.yaml`);
	return (yamlParse(root.content.toString("utf-8")) ?? {}) as Record<string, unknown>;
}

/** 入库钳制（与上传端点 clampManifest 同源口径：catalog 展示字段截断，全量 manifest 仍在包内） */
function clampManifest(m: Record<string, unknown>): Record<string, unknown> {
	const out = { ...m };
	if (typeof out.summary === "string" && out.summary.length > 200)
		out.summary = out.summary.slice(0, 200);
	if (typeof out.description === "string" && out.description.length > 2000)
		out.description = out.description.slice(0, 2000);
	return out;
}

/**
 * upsert 一行目录（trial/walkthrough 发布 fixture 的内部通道）。
 * 同 product@version 重 seed = 全列覆盖（试车语义：最后一次 seed 为准）。
 */
export function seedMarketRelease(dbPath: string, opts: { tgzPath: string, now?: number }): void {
	const tgzPath = opts.tgzPath;
	const at = opts.now ?? Math.floor(Date.now() / 1000);
	const bytes = new Uint8Array(readFileSync(tgzPath));
	const sig = parseSidecar(tgzPath);
	const manifest = clampManifest(manifestOf(tgzPath));
	if (typeof manifest.name !== "string" || manifest.name === "")
		throw new Error(`[ojm] seed 目录行失败：${tgzPath} 包内 manifest 缺 name`);
	if (typeof manifest.version !== "string" || manifest.version === "")
		throw new Error(`[ojm] seed 目录行失败：${tgzPath} 包内 manifest 缺 version`);
	const db = new DatabaseSync(dbPath);
	try {
		db.prepare(
			`INSERT INTO market_release (product,version,key_id,sha256,size,published_at,published_at_source,yanked,first_seen_at,sig_alg,sig_value,sig_public_key,sig_registry_id,manifest)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
			 ON CONFLICT(product,version) DO UPDATE SET
			   key_id=excluded.key_id, sha256=excluded.sha256, size=excluded.size,
			   published_at=excluded.published_at, published_at_source=excluded.published_at_source,
			   yanked=excluded.yanked, sig_alg=excluded.sig_alg, sig_value=excluded.sig_value,
			   sig_public_key=excluded.sig_public_key, sig_registry_id=excluded.sig_registry_id,
			   manifest=excluded.manifest`,
		).run(
			manifest.name,
			manifest.version,
			sig.key_id,
			createHash("sha256").update(bytes).digest("hex"),
			bytes.byteLength,
			at,
			"upload",
			0,
			at,
			sig.alg,
			sig.value,
			sig.public_key,
			sig.registry_id,
			JSON.stringify(manifest),
		);
	}
	finally {
		db.close();
	}
}

/** 摘除一行目录 + 其字节（neg op 收尾；walkthrough 恢复主链路原状用） */
export function removeMarketRelease(dbPath: string, name: string, version: string): void {
	const db = new DatabaseSync(dbPath);
	try {
		db.prepare("DELETE FROM market_release WHERE product = ? AND version = ?").run(name, version);
	}
	finally {
		db.close();
	}
}

/**
 * 行签名列置 NULL（遗留目录行形态——neg-nosig：锚定「无签名行拒装」的 fail-closed 语义；
 * 上传通道恒写四列，唯有 seed/遗留路径能造出 NULL 行）。
 */
export function nullReleaseSig(dbPath: string, name: string, version: string): void {
	const db = new DatabaseSync(dbPath);
	try {
		db.prepare("UPDATE market_release SET sig_alg = NULL, sig_value = NULL, sig_public_key = NULL, sig_registry_id = NULL WHERE product = ? AND version = ?").run(name, version);
	}
	finally {
		db.close();
	}
}
