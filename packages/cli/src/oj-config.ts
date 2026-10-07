/**
 * oj config.yaml 的读取（设计 §4）。
 *
 * 用真 YAML 解析（`yaml` 已在 cli 依赖里），不再行级正则——流式写法
 * （`server: { port: 9778 }`）、引号、注释、锚点都由解析器保证，手改 config
 * 后不会静默读空。
 *
 * config 由 `ojm init` 生成，字段 miss 即被手改：直接报错，绝不静默回落
 * （oj 代码默认端口是 9778，回落错值会与实际监听错位）。
 */

import fs from "node:fs";
import { parse } from "yaml";

/** 取 `server:` 段；缺失/非对象 → 空对象（调用方按 miss 处理） */
function readServerBlock(configPath: string): Record<string, unknown> {
	let doc: unknown;
	try {
		doc = parse(fs.readFileSync(configPath, "utf-8"));
	}
	catch (error) {
		throw new Error(
			`[ojm] ${configPath} 解析失败（不是合法 YAML）：${(error as Error).message}\n`
			+ "该文件由 ojm init 生成，改动后请用 YAML 语法检查确认缩进与引号。",
		);
	}
	const server = (doc as { server?: unknown } | null | undefined)?.server;
	return server && typeof server === "object" ? server as Record<string, unknown> : {};
}

/** 取 `server:` 段内某标量字段；miss 或非标量返回 undefined */
export function readOjServerField(configPath: string, field: string): string | undefined {
	const value = readServerBlock(configPath)[field];
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return String(value);
	return undefined;
}

/**
 * API 基础前缀（devkit 手册 §10：新键 `api_prefix`，旧键 `base` 仅兼容，
 * 并存会被 oj 报 duplicate field 拒启——故优先读新键，旧工程回落 `base`）。
 */
export function readOjApiPrefix(configPath: string): string {
	const prefix = readOjServerField(configPath, "api_prefix") ?? readOjServerField(configPath, "base");
	return prefix ?? "/api";
}

/**
 * `auth.anonymous_paths` 的匿名路径列表（相对 base，不含 base 本身）。
 *
 * 条目两种形态：裸字符串，或 `{ path, one_layer }`（oj 侧尾 `/*` 是严格一层）。
 * 读不到该段返回空数组——调用方据此「无法判定就不判定」，不误报。
 */
export function readOjAnonymousPaths(configPath: string): string[] {
	let doc: unknown;
	try {
		doc = parse(fs.readFileSync(configPath, "utf-8"));
	}
	catch {
		return [];
	}
	const auth = (doc as { auth?: unknown } | null | undefined)?.auth;
	if (!auth || typeof auth !== "object")
		return [];
	const list = (auth as { anonymous_paths?: unknown }).anonymous_paths;
	if (!Array.isArray(list))
		return [];
	const out: string[] = [];
	for (const item of list) {
		if (typeof item === "string")
			out.push(item);
		else if (item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string")
			out.push((item as { path: string }).path);
	}
	return out;
}

export function readOjPort(configPath: string): number {
	const raw = readOjServerField(configPath, "port");
	const port = raw === undefined ? Number.NaN : Number(raw);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(
			`[ojm] ${configPath} 缺少合法的 server.port。\n`
			+ "该文件由 ojm init 生成，手动改动后请保留端口配置（oj 代码默认 9778）。",
		);
	}
	return port;
}
