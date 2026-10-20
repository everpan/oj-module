/**
 * market CDN 的布局单点：**目录在哪 + 基址是什么**只在这里算（计划 §4.3 单一真相表）。
 *
 * 两条不能破的规矩：
 * 1. **不许硬编码端口/主机/挂载路径**——全部从 `api/config.yaml` 读。
 *    dev 形态下 `/cdn` 只在 oj 子进程（`server.port`）上成立，dev server 自己（5174）
 *    会把 `/cdn/*` 交给静态层、未命中就回落 index.html（设计 §3.1.1）；写成相对路径或
 *    写死 9778，市场页拿到的会是 HTML 而不是索引 YAML。
 * 2. **基址无尾斜杠**——`market/api.ts` 按 `${base}/bundles.yaml` 拼。
 *
 * 文本版（`resolveCdnLayoutFromConfig`）与工程版（`resolveCdnLayout`）分工：前者纯函数便于单测，
 * 后者负责读盘。取值口径只有前者一份，后者不重算。
 */

import fs from "node:fs";
import path from "node:path";
import { parse as yamlParse } from "yaml";

import { resolveConfigPath } from "../layout";

/** 本地模拟 CDN 的挂载前缀（模板 api/config.yaml 随 Jinfirst 发布） */
export const CDN_MOUNT_PREFIX = "/cdn";

export interface CdnLayout {
	/** cdn 目录绝对路径（由挂载的 `web` 相对 config 所在目录解析） */
	dir: string
	/** 挂载前缀，无尾斜杠（如 `/cdn`） */
	prefix: string
	/** 市场基址：`http://<host>:<port><prefix>`，无尾斜杠 */
	baseUrl: string
}

/** 从工程根出发解析（会读 `api/config.yaml`） */
export function resolveCdnLayout(projectRoot: string): CdnLayout {
	const configPath = resolveConfigPath(projectRoot);
	return resolveCdnLayoutFromConfig(fs.readFileSync(configPath, "utf-8"), configPath);
}

/** 从 config 文本解析（纯函数，不落 IO） */
export function resolveCdnLayoutFromConfig(configText: string, configPath: string): CdnLayout {
	const doc = isObj(yamlParse(configText)) ? yamlParse(configText) as Record<string, unknown> : {};
	const mount = findCdnMount(mountsOf(doc), configPath);
	const configDir = path.dirname(configPath);

	const web = mount.web;
	if (typeof web !== "string" || web.trim() === "") {
		throw new Error(
			`[ojm] ${configPath} 的 /cdn 挂载缺少 web 目录（当前是 api 挂载或目录为空）。\n`
			+ "下一步：把这一条改成\n"
			+ "  - prefix: /cdn\n"
			+ "    web: ../cdn\n",
		);
	}

	const prefix = normalizePrefix(String(mount.prefix));
	const port = readPort(doc, configPath);
	const host = readHost(doc);

	return {
		dir: path.resolve(configDir, web),
		prefix,
		baseUrl: `http://${host}:${port}${prefix}`,
	};
}

function isObj(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

function mountsOf(doc: Record<string, unknown>): unknown[] {
	const mounts = doc.mounts;
	return Array.isArray(mounts) ? mounts : [];
}

/** 前缀归一化：补前导斜杠、去尾斜杠（拼接口径统一） */
function normalizePrefix(raw: string): string {
	let prefix = raw.trim();
	if (!prefix.startsWith("/"))
		prefix = `/${prefix}`;
	while (prefix.length > 1 && prefix.endsWith("/"))
		prefix = prefix.slice(0, -1);
	return prefix;
}

function findCdnMount(mounts: unknown[], configPath: string): Record<string, unknown> {
	const hit = mounts.find((entry) => {
		if (!isObj(entry) || typeof entry.prefix !== "string")
			return false;
		return normalizePrefix(entry.prefix) === CDN_MOUNT_PREFIX;
	});
	if (hit)
		return hit as Record<string, unknown>;

	throw new Error(
		`[ojm] ${configPath} 的 mounts 里没有 /cdn 条目——本地模拟 CDN 无处可挂。\n`
		+ "出现这条错误说明该工程的 config 被手改过或来自旧模板。\n"
		+ "下一步：把下面两行粘到 mounts: 段里（位置在 /api 之后、任何 `/` 之前）：\n"
		+ "  - prefix: /cdn\n"
		+ "    web: ../cdn\n",
	);
}

/** 端口取自 config，口径与 oj-config.readOjPort 一致（缺失/非法即人称报错） */
function readPort(doc: Record<string, unknown>, configPath: string): number {
	const server = isObj(doc.server) ? doc.server as Record<string, unknown> : {};
	const raw = server.port;
	const port = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN;
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(
			`[ojm] ${configPath} 缺少合法的 server.port。\n`
			+ "该文件由 ojm init 生成，手动改动后请保留端口配置（oj 代码默认 9778）。",
		);
	}
	return port;
}

/** 主机缺省回落到 oj 模板显式钉死的 127.0.0.1（config.yaml 注释解释过为何不用 localhost） */
function readHost(doc: Record<string, unknown>): string {
	const server = isObj(doc.server) ? doc.server as Record<string, unknown> : {};
	const host = server.host;
	return typeof host === "string" && host.trim() !== "" ? host.trim() : "127.0.0.1";
}
