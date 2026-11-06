/**
 * 脚手架完整性门禁——内置模块自治契约。
 *
 * 契约（下游反馈 2026-11-06）：`src/app` 内置模块与 `src/oj-market` 属上游自治，
 * 下游不得本地修改；`ojm build` 前逐文件与**当前 cli 包内 templates** 比对
 * （上游模板即基线，不另立可被下游手改的哈希 lock）。CLI 升级后工程里的旧版
 * 默认模块与新模板必不一致 → fail-fast，必须先 `ojm init --yes` 同步再构建
 * （「必须先同步上游」策略，用户已确认）。
 *
 * 语义边界：
 *   - 保护集 = init.include.yaml 白名单中保护根前缀条目展开的模板文件清单；
 *     demo-only 文件本就不在白名单，不参与比较，无误报；
 *   - 三类漂移均拦：modified（内容不一致，CRLF 归一防 autocrlf 误报）、
 *     missing（白名单文件缺失）、extra（保护根内模板没有的文件）；
 *   - 门禁开关 = `src/.ojm-builtin.json` 存在（新脚手架 init 必写；缺失 =
 *     旧工程/框架仓，退化现状不拦——与 builtin.ts 同哲学）；
 *   - **不是安全边界**：删开关文件即退回旧行为；错误信息如实告知处置路径；
 *   - 仅约束打包链路（ojm build / build --bundle / market publish --real）；
 *     dev 不拦，允许本地试验。
 *
 * 消费方：`cli.ts` build action（分支前，失败零产物）、`market/publish.ts`、
 * `init.ts`（--yes 恢复复用保护根/白名单/清理面）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { builtinListPath } from "./builtin";

/** 上游自治的保护根（相对工程根，正斜杠）。init --yes 恢复范围与此严格一致。 */
export const PROTECTED_ROOTS = ["src/app", "src/oj-market"] as const;

/** rel 是否落在保护根内（接受平台分隔符输入，归一后比较） */
export function isProtectedRel(rel: string): boolean {
	const p = rel.split(path.sep).join("/");
	return PROTECTED_ROOTS.some(root => p === root || p.startsWith(`${root}/`));
}

/** cli 包根（src 运行态与 dist 发布态各上跳一层即包根） */
export function cliRoot(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function templatesRoot(): string {
	return path.join(cliRoot(), "templates");
}

/**
 * 读取模板根 `init.include.yaml` 的 `include` 白名单，归一为相对模板根的路径集合。
 * 清单随模板一起发布，缺失即安装包损坏——直接 fail-fast，不留「静默少拷」的
 * 退化路径。条目指向不存在的路径同样 fail-fast：拼错一个目录名不会当场报错，
 * 只会在用户工程里留下难以追溯的缺文件（旧 exclude 清单没有这类校验面）。
 */
export function readInitInclude(templatesDir: string): Set<string> {
	const yamlPath = path.join(templatesDir, "init.include.yaml");
	if (!fs.existsSync(yamlPath))
		throw new Error(`模板缺少 init.include.yaml：${yamlPath}（安装包损坏？）`);
	const doc = yaml.parse(fs.readFileSync(yamlPath, "utf-8")) as { include?: string[] } | null;
	const out = new Set<string>();
	for (const raw of doc?.include ?? []) {
		// 跨平台：include 清单用正斜杠书写，但 path.normalize 在 Windows 会把
		// 正斜杠折成反斜杠，导致与 srcRel（path.relative 在 Windows 同样出反斜杠）
		// 的对比永远落空、整棵 src 子树被 skip。这里只把反斜杠归正、剥 ./ 前缀，
		// 不引入平台分隔符（修复：Windows 下 init 不拷贝 src 树）。
		const p = raw.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
		out.add(p);
		if (!fs.existsSync(path.join(templatesDir, p)))
			throw new Error(`init.include.yaml 收录了不存在的路径：${p}（拼写错误或模板缺文件？）`);
	}
	return out;
}

export interface ScaffoldDrift {
	modified: string[]
	missing: string[]
	extra: string[]
}

/** 门禁开关：工程声明了内置模块概念（`src/.ojm-builtin.json` 存在） */
export function guardEnabled(projectRoot: string): boolean {
	return fs.existsSync(builtinListPath(projectRoot));
}

/** 白名单中保护根条目展开成模板文件相对路径清单（正斜杠、去重、排序） */
export function protectedTemplateFiles(templatesDir: string, include: Set<string>): string[] {
	const files = new Set<string>();
	const walk = (abs: string): void => {
		for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
			const p = path.join(abs, entry.name);
			if (entry.isDirectory())
				walk(p);
			else
				files.add(path.relative(templatesDir, p).split(path.sep).join("/"));
		}
	};
	for (const rel of include) {
		if (!isProtectedRel(rel))
			continue;
		const abs = path.join(templatesDir, rel);
		if (fs.statSync(abs).isDirectory())
			walk(abs);
		else
			files.add(rel);
	}
	return [...files].sort();
}

const normalizeText = (s: string): string => s.replaceAll("\r\n", "\n");

function walkProjectFiles(projectRoot: string, root: string, visit: (rel: string, abs: string) => void): void {
	const absRoot = path.join(projectRoot, root);
	if (!fs.existsSync(absRoot))
		return;
	const walk = (abs: string): void => {
		for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
			const p = path.join(abs, entry.name);
			if (entry.isDirectory())
				walk(p);
			else
				visit(path.relative(projectRoot, p).split(path.sep).join("/"), p);
		}
	};
	walk(absRoot);
}

/**
 * 收集工程默认模块相对当前 cli 模板的漂移。
 * 门禁未启用（无 `.ojm-builtin.json`）→ null；已启用 → 三类清单（可为空）。
 */
export function collectDefaultModuleDrift(projectRoot: string): ScaffoldDrift | null {
	if (!guardEnabled(projectRoot))
		return null;
	const templatesDir = templatesRoot();
	const expected = protectedTemplateFiles(templatesDir, readInitInclude(templatesDir));
	const expectedSet = new Set(expected);
	const drift: ScaffoldDrift = { modified: [], missing: [], extra: [] };
	for (const rel of expected) {
		const projectFile = path.join(projectRoot, rel);
		if (!fs.existsSync(projectFile)) {
			drift.missing.push(rel);
			continue;
		}
		if (normalizeText(fs.readFileSync(projectFile, "utf-8")) !== normalizeText(fs.readFileSync(path.join(templatesDir, rel), "utf-8")))
			drift.modified.push(rel);
	}
	for (const root of PROTECTED_ROOTS) {
		walkProjectFiles(projectRoot, root, (rel) => {
			if (!expectedSet.has(rel))
				drift.extra.push(rel);
		});
	}
	drift.extra.sort();
	return drift;
}

/**
 * 门禁入口：有漂移即抛（错误信息点名文件 + 上游自治说明 + `ojm init --yes` 处置）。
 * 调用方保证在任何产物写入之前调用（失败零产物）。
 */
export function assertDefaultModulesUntouched(projectRoot: string): void {
	const drift = collectDefaultModuleDrift(projectRoot);
	if (!drift)
		return;
	const sections: string[] = [];
	const section = (label: string, items: string[]): void => {
		if (items.length > 0)
			sections.push(`${label}（${items.length} 个文件）：\n${items.map(f => `  - ${f}`).join("\n")}`);
	};
	section("内容被修改", drift.modified);
	section("缺失", drift.missing);
	section("多出（模板没有）", drift.extra);
	if (sections.length === 0)
		return;
	throw new Error([
		"[ojm] 框架默认模块与上游模板不一致，已拒绝构建（未写入任何产物）。",
		"",
		...sections,
		"",
		"框架默认模块（src/app 内置模块、src/oj-market）由上游自治：本地修改会在下次同步时丢失，",
		"功能需求请向上游仓库提交 issue，不要在下游直接改这些目录。",
		"处置：",
		"  - 确认放弃本地修改并恢复上游版本：ojm init --yes",
		"    （仅覆盖/清理 src/app 与 src/oj-market，会丢弃其中的本地改动，执行前请备份；",
		"     下游自定义模块与工程配置不受影响）。",
	].join("\n"));
}

/**
 * `ojm init --yes` 恢复的清理面：删除保护根内模板没有的文件（含遗留空目录）。
 * 返回删除清单（正斜杠相对路径），供 init report 展示。
 */
export function removeExtraProtectedFiles(projectRoot: string): string[] {
	const templatesDir = templatesRoot();
	const expected = new Set(protectedTemplateFiles(templatesDir, readInitInclude(templatesDir)));
	const removed: string[] = [];
	for (const root of PROTECTED_ROOTS) {
		walkProjectFiles(projectRoot, root, (rel, abs) => {
			if (!expected.has(rel)) {
				fs.rmSync(abs);
				removed.push(rel);
			}
		});
		const absRoot = path.join(projectRoot, root);
		if (fs.existsSync(absRoot))
			pruneEmptyDirs(absRoot);
	}
	return removed.sort();
}

/** 递归删除空目录（自底向上）；根自身保留，返回其是否为空 */
function pruneEmptyDirs(dir: string): boolean {
	let empty = true;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (pruneEmptyDirs(p))
				fs.rmdirSync(p);
			else
				empty = false;
		}
		else {
			empty = false;
		}
	}
	return empty;
}
