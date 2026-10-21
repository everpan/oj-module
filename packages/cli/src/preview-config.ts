/**
 * preview 派生 config（设计 §6 单服务化，2026-10-19）。
 *
 * 单服务 preview 由 oj 一个进程同时出 API 与静态（web 挂载 + spa: true），
 * 而 spa 只能来自 config 文件（CLI --app-path 的 upsert 保留但不设置
 * spa——实测 oj 0.1.80）。用户在模板里手改 config 不可取（web/dist 缺失时
 * oj serve 整体拒启，会连带挂掉 ojm dev），故 preview 现场生成一份
 * 派生 config：
 *
 *   - 与原 config 同目录（api/.ojm-preview.yaml，固定名）——config 内
 *     相对路径（证书 / db / api 挂载目录）按 config 所在目录解析，派生后
 *     与原件逐字一致，无需重写任何路径；
 *   - 唯一改动：upsert {prefix: "/", web: <siteDir>, spa: true} 挂载 +
 *     显式传 port 时覆盖 server.port；
 *   - 临时产物：preview 进程退出即删（三路清理见 preview.ts），模板
 *     .gitignore 已收录该文件名。
 *
 * 纯变换（derivePreviewConfigText）与落盘（writePreviewConfig）分离：
 * 前者可单测到「除注入点外 doc 与原 parse 深相等」，后者只做 IO。
 */

import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { resolveConfigPath } from "./layout";

/** 派生 config 文件名（与原 config 同目录；固定名 = 崩溃自愈，不积累残留） */
export const PREVIEW_CONFIG_NAME = ".ojm-preview.yaml";

export interface DerivePreviewConfigOptions {
	/** 全站产物目录（layout.distDir），写入 web 挂载的绝对路径 */
	siteDir: string
	/**
	 * web 挂载前缀（默认 `"/"`）。配了 `siteBase` 的工程，产物里 URL 全是
	 * `/oj/...`，preview 必须把站点挂在同一前缀上才能验证子路径部署
	 * （否则资源全 404，预览白屏）。
	 */
	prefix?: string
	/**
	 * release 形态的后端模块根（api/dist）。给了且原 config 声明了 platform.modules 时，
	 * 把 `platform.root` 一并改写到该目录——特权模块的受控根必须与 `--api-path` 同源，
	 * 否则 release 下 reloadConfig 会按 dev 的 src 判定归属（装好的方案热更不生效）。
	 */
	apiRoot?: string
	/** 显式端口时覆盖 server.port；缺省沿用原 config（oj 代码默认 9778） */
	port?: number
	/** 原 config 文本（测试注入）；缺省读 api/config.yaml */
	configText?: string
}

export interface PreviewConfigFiles {
	/** 派生 config 路径（startOj 的 configPath） */
	configPath: string
	/** 同步删除派生 config（幂等；文件已不存在不抛） */
	cleanup: () => void
}

/** YAML 解析失败的人话报错（口径对齐 oj-config.ts 的 readServerBlock） */
function parseConfigDoc(configText: string, configPath: string): Record<string, unknown> {
	let doc: unknown;
	try {
		doc = parse(configText);
	}
	catch (error) {
		throw new Error(
			`[ojm] ${configPath} 解析失败（不是合法 YAML）：${(error as Error).message}\n`
			+ "该文件由 ojm init 生成，改动后请用 YAML 语法检查确认缩进与引号。",
		);
	}
	// 空 config（parse → null）合法：oj 用内置默认值；派生时从空对象建 mounts/server
	if (doc === null || doc === undefined)
		return {};
	if (typeof doc !== "object" || Array.isArray(doc)) {
		throw new TypeError(
			`[ojm] ${configPath} 顶层不是映射（拿到 ${Array.isArray(doc) ? "序列" : typeof doc}）——`
			+ "oj config 必须是键值结构，请检查文件内容。",
		);
	}
	return doc as Record<string, unknown>;
}

/** 挂载条目 = 非空非数组的普通对象（mounts: 一行一条） */
function isMountEntry(m: unknown): m is Record<string, unknown> {
	return m !== null && typeof m === "object" && !Array.isArray(m);
}

/** 找指定 prefix 的 web 挂载条目下标；没有返回 -1 */
function findWebMount(mounts: unknown[], prefix: string): number {
	return mounts.findIndex(m => isMountEntry(m) && m.prefix === prefix && "web" in m);
}

/**
 * 是否存在 prefix === "/" 的 api 挂载（oj 语义：与 web 挂载配对时恒无 SPA
 * 回落）。调用方（preview）必然注入 / web 挂载，故「有 / api 挂载」即「配对」。
 */
export function hasRootApiMount(mounts: unknown[]): boolean {
	return mounts.some(m => isMountEntry(m) && m.prefix === "/" && "api" in m);
}

/** mounts 段校验：缺省视为无挂载；存在但非序列 → 人话报错（不静默置空掩盖手误） */
function readMounts(doc: Record<string, unknown>, configPath: string): unknown[] {
	if (doc.mounts === undefined || doc.mounts === null)
		return [];
	if (!Array.isArray(doc.mounts)) {
		throw new TypeError(
			`[ojm] ${configPath} 的 mounts 不是序列（拿到 ${typeof doc.mounts}）——`
			+ "每个挂载占一行「- prefix: ...」列表，请对照 ojm init 生成的模板修正。",
		);
	}
	return doc.mounts;
}

/**
 * 原 config 文本 → 派生 config 文本。
 *
 * upsert 语义（DR-3）：已有 / web 条目 → 覆盖 web 指向、强制 spa: true，
 * 保留该条目其余键（如 headers）；没有 → 追加新条目。其余挂载与原样
 * 顶层段一律不动。
 */
export function derivePreviewConfigText(configText: string, opts: DerivePreviewConfigOptions & { configPath?: string }): string {
	const configPath = opts.configPath ?? "api/config.yaml";
	const doc = parseConfigDoc(configText, configPath);

	const mounts = [...readMounts(doc, configPath)];
	const prefix = opts.prefix ?? "/";
	const idx = findWebMount(mounts, prefix);
	if (idx >= 0) {
		// 保留用户自定义键（headers 等），只接管指向与回落
		mounts[idx] = { ...(mounts[idx] as Record<string, unknown>), web: opts.siteDir, spa: true };
	}
	else {
		mounts.push({ prefix, web: opts.siteDir, spa: true });
	}
	doc.mounts = mounts;

	// platform.root 跟随 api 挂载根：dev = src，release（preview）= dist
	const platform = doc.platform;
	if (opts.apiRoot !== undefined && platform !== null && typeof platform === "object" && !Array.isArray(platform)) {
		const mods = (platform as Record<string, unknown>).modules;
		if (Array.isArray(mods) && mods.length > 0)
			(platform as Record<string, unknown>).root = opts.apiRoot;
	}

	if (opts.port !== undefined) {
		const server = doc.server !== null && typeof doc.server === "object" && !Array.isArray(doc.server)
			? { ...(doc.server as Record<string, unknown>) }
			: {};
		server.port = opts.port;
		doc.server = server;
	}

	return stringify(doc);
}

/** 读 config 文本的 mounts 序列（解析失败 / mounts 非序列即人话报错） */
export function parseMounts(configText: string, configPath = "api/config.yaml"): unknown[] {
	return readMounts(parseConfigDoc(configText, configPath), configPath);
}

/**
 * 落盘派生 config 并返回清理器。config 文本读取失败（不存在/无权限）直接
 * 抛——四查已保证 config 存在，这里只可能是 IO 异常。
 */
export function writePreviewConfig(projectRoot: string, opts: DerivePreviewConfigOptions): PreviewConfigFiles {
	const configPath = resolveConfigPath(projectRoot);
	const previewPath = path.join(path.dirname(configPath), PREVIEW_CONFIG_NAME);
	const configText = opts.configText ?? fs.readFileSync(configPath, "utf-8");

	fs.writeFileSync(previewPath, derivePreviewConfigText(configText, { ...opts, configPath }));

	let cleaned = false;
	const cleanup = () => {
		if (cleaned)
			return;
		cleaned = true;
		try {
			fs.unlinkSync(previewPath);
		}
		catch {
			// 已不存在（并发退出/手工删除）——幂等
		}
	};
	return { configPath: previewPath, cleanup };
}
