/**
 * 脚手架自带模块身份：`src/.ojm-builtin.json`。
 *
 * 名单派生自 init 白名单（`init.include.yaml` 的 `src/<name>/(api|web)` 条目）——
 * 单一真源是白名单，本模块只是它的读取/派生面，不在别处另立名单常量（防双写漂移）。
 *
 * 语义边界（评审钉死）：
 *   - 只是打包排除 / UI 折叠提示，**不是安全边界**——文件只活在源工程、永不入包，
 *     安装侧信任链（签名 + 信任库 + TOFU，fail-closed）与它无关；
 *   - 文件缺失 → 空名单（旧工程/框架仓没有内置概念，行为退化为现状）；
 *   - 坏 JSON / modules 非字符串数组 → fail-fast（与「坏清单出不了包」同哲学，
 *     缺失是故意的，坏文件是事故）；
 *   - 用户对该文件有完全控制权：删名 = 该模块恢复参与打包/显示，删文件 = 全部退化。
 *
 * 消费方：`ojm build --bundle`（排除）、`ojm info`（折叠）、`ojm new`（拒名）、
 * `ojm init`（生成/回填）。历史布局（new/flat）工程不适用（无 src/ 模块树概念），
 * 调用方自行判布局，本模块不感知 layout。
 */

import fs from "node:fs";
import path from "node:path";

export const BUILTIN_LIST_FILE = ".ojm-builtin.json";

export function builtinListPath(projectRoot: string): string {
	return path.join(projectRoot, "src", BUILTIN_LIST_FILE);
}

/**
 * 读取自带模块名单。
 * 文件缺失 → 空集；坏文件 → fail-fast（报路径与错因）。
 */
export function readBuiltinModules(projectRoot: string): Set<string> {
	const p = builtinListPath(projectRoot);
	if (!fs.existsSync(p))
		return new Set();
	let doc: unknown;
	try {
		doc = JSON.parse(fs.readFileSync(p, "utf-8"));
	}
	catch (error) {
		throw new Error(
			`[ojm] ${p} 解析失败（${error instanceof Error ? error.message : String(error)}）。`
			+ "该文件由 ojm init 生成、可手改/删除，但必须是合法 JSON"
			+ "（{ \"modules\": [\"<模块名>\", …] }）。",
		);
	}
	const modules = (doc as { modules?: unknown })?.modules;
	if (!Array.isArray(modules) || modules.some(m => typeof m !== "string")) {
		throw new Error(
			`[ojm] ${p} 的 modules 必须是字符串数组，`
			+ `实际为 ${Array.isArray(modules) ? `含非字符串项的数组（${JSON.stringify(modules)}）` : typeof modules
			}。修复或删除该文件后重试。`,
		);
	}
	return new Set(modules);
}

/**
 * 从 init.include.yaml 的 include 集合派生自带模块名：`src/<name>/(api|web)` 条目的
 * `<name>` 段（整目录收录 `src/<name>/api` 与逐文件收录 `src/<name>/web/...` 都命中）。
 * 与 `pruneUnincludedApiPaths` 的派生同族，扩 web 侧覆盖 web-only 模块（login/oj-market）。
 */
export function deriveBuiltinModules(include: Iterable<string>): Set<string> {
	const mods = new Set<string>();
	for (const p of include) {
		const m = /^src\/([^/]+)\/(?:api|web)(?:\/|$)/.exec(p)?.[1];
		if (m)
			mods.add(m);
	}
	return mods;
}

/**
 * init 接线：生成/回填 `src/.ojm-builtin.json`（copyIfAbsent 语义）。
 * 已存在 → 原样不动（用户手改权）；派生集为空 → 不写。
 * @returns "created" | "skipped" | "none"
 */
export function writeBuiltinList(projectRoot: string, include: Iterable<string>): "created" | "skipped" | "none" {
	const target = builtinListPath(projectRoot);
	if (fs.existsSync(target))
		return "skipped";
	const modules = [...deriveBuiltinModules(include)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	if (modules.length === 0)
		return "none";
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const doc = {
		"//": "由 ojm init 生成（名单派生自模板白名单）。可手改/删除：删名 = 该模块恢复参与打包与 ojm info 显示；删整个文件 = 退化为无内置概念。",
		modules,
	};
	fs.writeFileSync(target, `${JSON.stringify(doc, null, "\t")}\n`);
	return "created";
}
