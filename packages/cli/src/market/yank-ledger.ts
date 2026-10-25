/**
 * yank 账本（REG-CS4）：把「某版本已下线」这个事实从索引正文里抽出来，单独持久化。
 *
 * 为什么独立成账本：索引是**派生重建产物**（`build-index` 每次全量重扫 `cdn/*.tgz`），
 * tgz 文件本身不删除（yank ≠ delete）——所以「谁被下线」不能靠「文件不在」推断，必须有
 * 一份能跨重建存活的真源。账本就是这份真源：`cdn/yanked.json`（`name@version -> 条目`）。
 *
 * 重建索引时，`build-index` 读账本把对应版本标 `yanked: true` + `yanked_at`，并让 `latest`
 * 跳过已下线版本。`ojm market yank <name>@<version>` 写账本后顺手重建索引。
 */

import fs from "node:fs";
import path from "node:path";

import { resolveCdnLayout } from "./cdn-layout";

/** 单条 yank 记录（审计留痕：谁、何时、为何） */
export interface YankEntry {
	/** 方案名 */
	name: string
	/** 版本 */
	version: string
	/** 下线时刻（epoch 秒） */
	at: number
	/** 操作人（CLI 本地形态来自 --by；registry 上线后由会话身份注入） */
	by: string
	/** 下线原因（可选，审计用） */
	reason?: string
}

/** 账本 key：`<name>@<version>`，与 install 侧 resolveCdn 的命中口径一致 */
export function yankKey(name: string, version: string): string {
	return `${name}@${version}`;
}

/** 账本磁盘路径：`cdn/yanked.json` */
export function yankLedgerPath(projectRoot: string): string {
	return path.join(resolveCdnLayout(projectRoot).dir, "yanked.json");
}

/**
 * 读账本。文件不存在 → 空表（视为「无下线记录」）；非法 JSON → 抛错（fail-closed，不静默当空）。
 * 返回以 `yankKey` 为键的条目表，供 build-index 快速查某版本是否被下线。
 */
export function readYankLedger(projectRoot: string): Map<string, YankEntry> {
	const file = yankLedgerPath(projectRoot);
	if (!fs.existsSync(file))
		return new Map();
	const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
	if (!isObj(parsed))
		throw new Error(`[ojm] yank 账本 ${file} 不是合法 JSON 对象（应为 name@version → 条目 的映射）`);
	const out = new Map<string, YankEntry>();
	for (const [key, raw] of Object.entries(parsed)) {
		if (!isObj(raw))
			continue;
		const { name, version, at, by, reason } = raw as Record<string, unknown>;
		if (typeof name !== "string" || typeof version !== "string" || typeof at !== "number" || typeof by !== "string")
			continue;
		out.set(key, { name, version, at, by, ...(typeof reason === "string" ? { reason } : {}) });
	}
	return out;
}

/**
 * 标记某版本已下线（写账本）。幂等：重复 yank 同一版本不重复写、返回 created=false。
 * 目标版本在 `cdn/*.tgz` 中不存在 → 抛明确错误（REG-CS4 验收：对不存在的版本报明确错误）。
 */
export function markYanked(
	projectRoot: string,
	name: string,
	version: string,
	opts: { by: string, reason?: string, now?: number },
): { created: boolean } {
	const file = yankLedgerPath(projectRoot);
	const dir = path.dirname(file);
	// 目标版本必须真实存在于 cdn（文件名严格 <name>-<version>.tgz）——yank 的是「已发布版本」
	if (!fs.existsSync(path.join(dir, `${name}-${version}.tgz`)))
		throw new Error(`[ojm] 无法下线 ${name}@${version}：cdn 目录下不存在 ${name}-${version}.tgz（只可下线已发布的版本）`);
	const ledger = readYankLedger(projectRoot);
	const key = yankKey(name, version);
	if (ledger.has(key))
		return { created: false };
	ledger.set(key, { name, version, at: opts.now ?? Math.floor(Date.now() / 1000), by: opts.by, ...(opts.reason !== undefined ? { reason: opts.reason } : {}) });
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(ledger), null, 2)}\n`);
	return { created: true };
}

function isObj(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}
