// 内置匿名面权威提取（2026-11-10）：模板 config.yaml 是 auth/tenant anonymous_paths 的
// 单一权威源（oj 匿名模型 config 独占；安装器 C2-26 只覆盖市场方案，baseline 模块的匿名
// 面无接线通道）。ojm dev/preview 在派生 config 上对它做 force-union 补齐——用户手删/
// 遗漏的条目在 dev/preview 产物自动愈合，原文件不动。
// fail-fast 同 readInitInclude 纪律：模板包损坏（缺 config/段缺失/解析失败）直接抛，
// 不留「静默少补」的退化路径。

import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export interface BuiltinAnonymous {
	/** auth.anonymous_paths：不带 token 也能访问的路径 */
	auth: string[]
	/** tenant.anonymous_paths：豁免租户头的路径 */
	tenant: string[]
}

/** 从模板根读内置匿名面（templates/config.yaml 为权威源） */
export function readBuiltinAnonymous(templatesDir: string): BuiltinAnonymous {
	const configPath = path.join(templatesDir, "config.yaml");
	let doc: unknown;
	try {
		doc = parse(fs.readFileSync(configPath, "utf-8"));
	}
	catch (error) {
		throw new Error(`[ojm] 模板 config.yaml 读取/解析失败（内置匿名面权威源）：${(error as Error).message}`);
	}
	const root = (doc ?? {}) as Record<string, unknown>;
	const section = (key: string): string[] => {
		const s = root[key];
		if (s === null || typeof s !== "object" || Array.isArray(s))
			throw new Error(`[ojm] 模板 config.yaml 缺 ${key} 段——内置匿名面无法提取（模板包损坏）`);
		const list = (s as Record<string, unknown>).anonymous_paths;
		if (!Array.isArray(list))
			throw new Error(`[ojm] 模板 config.yaml 缺 ${key}.anonymous_paths 键——内置匿名面无法提取（模板包损坏）`);
		return list.filter((x): x is string => typeof x === "string");
	};
	return { auth: section("auth"), tenant: section("tenant") };
}

/** force-union：保留用户列表原顺序与自定义项，缺失的权威条目追加尾部。幂等。 */
export function unionAnonymous(existing: unknown, required: string[]): string[] {
	const list = Array.isArray(existing) ? existing.filter((x): x is string => typeof x === "string") : [];
	const have = new Set(list.map(x => x.trim()));
	return [...list, ...required.filter(x => !have.has(x.trim()))];
}
