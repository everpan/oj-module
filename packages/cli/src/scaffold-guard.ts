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

/**
 * 读取 `init.include.yaml` 的 `exclude` 段：**存在但不随脚手架下发**的模块目录。
 *
 * 与 include 反向——这里不参与拷贝，只作完整性审计的口径凭据（见 auditInitInclude）。
 * 同样校验条目存在：拼错一个目录名不该让「有意排除」变成「其实没排除」。
 */
export function readInitExclude(templatesDir: string): Set<string> {
	const yamlPath = path.join(templatesDir, "init.include.yaml");
	if (!fs.existsSync(yamlPath))
		throw new Error(`模板缺少 init.include.yaml：${yamlPath}（安装包损坏？）`);
	const doc = yaml.parse(fs.readFileSync(yamlPath, "utf-8")) as { exclude?: string[] } | null;
	const out = new Set<string>();
	for (const raw of doc?.exclude ?? []) {
		let p = raw.replaceAll("\\", "/");
		while (p.startsWith("./"))
			p = p.slice(2);
		out.add(p);
		if (!fs.existsSync(path.join(templatesDir, p)))
			throw new Error(`init.include.yaml 的 exclude 收录了不存在的路径：${p}（拼写错误或模板缺文件？）`);
	}
	return out;
}

/** 完整性审计范围：框架内置模块的两个聚合容器（模板新增模块必落在这两处之一） */
const AUDITED_MODULE_CONTAINERS = ["src/app/api", "src/app/web"] as const;

export interface InitIncludeAudit {
	/** 目录存在，却既不在 include（也无收录子孙）、也不在 exclude 里的模块目录 */
	uncovered: string[]
}

/**
 * 白名单完整性审计：`src/app/{api,web}/<模块>` 下每个目录必须「有归属」——
 * 要么被 include 收录（整目录，或像 `web/home` 那样只收子路径），要么在 exclude 里
 * 显式声明不下发。两边都没有 = 有人加了模块却忘了登记。
 *
 * 为什么必须拦：include 是 `init` 拷贝的唯一真源，漏收的目录**不会报错**——
 * 它只是不进新工程；api 模块更隐蔽，`pruneUnincludedApiPaths` 会把它在
 * openapi.json 里的端点一并剪掉，新工程等于从来没有这个模块
 * （2026-11-12 演练实锤：`wecom-bot` 漏收 → `/api/wecom-bot/mcp` 静默消失）。
 */
export function auditInitInclude(
	templatesDir: string,
	include: Set<string> = readInitInclude(templatesDir),
	exclude: Set<string> = readInitExclude(templatesDir),
): InitIncludeAudit {
	const covered = (rel: string): boolean => {
		if (include.has(rel) || exclude.has(rel))
			return true;
		// 逐子路径收录（web/home 只收 routes/locales/pages）同样算「有归属」
		const prefix = `${rel}/`;
		for (const p of include) {
			if (p.startsWith(prefix))
				return true;
		}
		return false;
	};
	const uncovered: string[] = [];
	const scan = (rel: string): void => {
		if (fs.existsSync(path.join(templatesDir, rel)) && !covered(rel))
			uncovered.push(rel);
	};
	// 聚合容器：src/app/{api,web}/<模块>
	for (const container of AUDITED_MODULE_CONTAINERS) {
		const abs = path.join(templatesDir, container);
		if (!fs.existsSync(abs))
			continue;
		for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
			if (entry.isDirectory())
				scan(`${container}/${entry.name}`);
		}
	}
	// 平铺布局：src/<模块>/{api,web}（如 src/oj-market）。同样「漏收即静默丢模块」——
	// v4 api 迁移就漏过 src/oj-market/api，脚手架一度零 /api/oj-market/*。
	for (const entry of fs.readdirSync(path.join(templatesDir, "src"), { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === "app")
			continue;
		for (const kind of ["api", "web"])
			scan(`src/${entry.name}/${kind}`);
	}
	return { uncovered: uncovered.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) };
}

/**
 * 审计不过即拒 init（**先于任何写盘**，不留半成品工程）。
 * 处置二选一：要下发 → 写进 include；不下发 → 写进 exclude 并写明理由。
 */
export function assertInitIncludeComplete(templatesDir: string, include?: Set<string>): void {
	const { uncovered } = auditInitInclude(templatesDir, include);
	if (uncovered.length === 0)
		return;
	const lines = uncovered.map(p => `  - ${p}`);
	throw new Error([
		`[ojm] 模板有模块目录未在 init.include.yaml 声明（${uncovered.length} 个）：`,
		...lines,
		"原因：白名单是 init 拷贝的唯一真源，漏收不会报错——模块只是不进新工程，api 模块的端点还会被 openapi 裁剪一并剪掉（新工程等于从来没有它）。",
		"处置：在 packages/cli/templates/init.include.yaml 二选一登记",
		"  · 要下发：include 里加 `- <目录>`（web 模块可只列需要的子路径）",
		"  · 不下发：exclude 里加 `- <目录>` 并写明理由（demo-only / 模板自用）",
	].join("\n"));
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

/**
 * 文件名是否为上游用例（.test.* / .spec.*，含 tsx/mjs/cjs）。
 *
 * 用例是上游回归资产，不随脚手架下发（依赖 vitest/@testing-library 与上游夹具，
 * 用户工程没装 → pnpm typecheck 整片报「找不到模块」）。init 拷贝与门禁**必须同口径**：
 * 拷贝侧跳过、门禁侧也跳过，否则用户工程刚 init 完就报「缺失」。
 * 白名单里**显式列出**的用例（tests/*.spec.ts）不受影响——那些在保护根之外。
 */
export function isUpstreamTestFile(name: string): boolean {
	return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);
}

/** 白名单中保护根条目展开成模板文件相对路径清单（正斜杠、去重、排序；跳过上游用例） */
export function protectedTemplateFiles(templatesDir: string, include: Set<string>): string[] {
	const files = new Set<string>();
	const walk = (abs: string): void => {
		for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
			const p = path.join(abs, entry.name);
			if (entry.isDirectory()) {
				walk(p);
				continue;
			}
			if (isUpstreamTestFile(entry.name))
				continue;
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
			if (entry.isDirectory()) {
				walk(p);
				continue;
			}
			// 与保护集同口径：夹带用例不在期望集，也不该算「多出」
			if (isUpstreamTestFile(entry.name))
				continue;
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
	// 工程即 cli 包内 templates 自身（上游源仓）：基线 == 自身，比较无意义
	// （白名单外的 demo-only 文件在 extra 轴上必误报），直接放行
	if (path.resolve(projectRoot) === path.resolve(templatesDir))
		return null;
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
