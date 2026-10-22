/**
 * oj 原生别名 `#/<模块名>/…` 在 TS 侧的投影（生成 `<project>/tsconfig.paths.json`）。
 *
 * 为什么必须生成而不能手写一条通配：oj 的 `#/<name>/<tail>` 锚定「目标模块根」，在
 * `src/<name>/{api,web}` 布局下即 `src/<name>/api`。tsconfig 的 `paths` 做不了这件事：
 *   - 每条规则的替换值只允许一个 `*`——想用单条 `"#/*"` 同时匹配模块名与尾路径，会被
 *     TS 以 TS5062 直接拒掉（两处通配只能二选一）；
 *   - `paths` 是静态全局映射，表达不了 `#x`（本模块根，随引用方变化）。
 * 所以只能**按模块逐条枚举** `"#/<name>/*": ["./src/<name>/api/*"]`。模块清单必须与
 * `src/<name>/api/manifest.yaml` 同源，手写必然漂移 → 由 `ojm init` / `ojm build` / `ojm dev` 生成。
 *
 * 生成物只被 `src/tsconfig.json`（后端）`extends`：前端 tsconfig 不引，因为 web 侧
 * 没有 `#` 解析（`build.ts` 的 esbuild/vite 不认别名），让编辑器「能过」而打包失败
 * 比漏补 path 更坏。
 *
 * 模式串用 manifest 的 `name`（oj 的身份口径，v0.1.85 起与目录名脱钩），替换值用
 * **目录名**——两者在正常工程里同值，但真分叉时只有按此口径才不会一边错位。
 */
import type { ProjectLayout } from "./layout";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { tryResolveLayout } from "./layout";

/** 生成物文件名（工程根）。`src/tsconfig.json` 以 `../tsconfig.paths.json` 引用 */
export const ALIAS_PATHS_FILE = "tsconfig.paths.json";

/** 生成物头注释：tsconfig 允许注释，且这是唯一会被 `ojm` 覆写的 tsconfig */
const HEADER = [
	"// 由 ojm 生成：ojm init / ojm build / ojm dev 会按 src/*/api/manifest.yaml 重写本文件，请勿手改。",
	"//",
	"// oj 别名 `#/<模块名>/…` 锚在目标模块根（本布局下即 src/<模块名>/api）。tsconfig 的",
	"// paths 只能静态全局映射，且每条规则的替换值只允许一个 `*`（`./src/*/api/*` 会被 TS",
	"// 以 TS5062 拒掉），故按模块逐条枚举。",
].join("\n");

/** 读模块根 manifest 的 `name`（oj 的模块身份）；读不到/格式坏时回落到目录名 */
function manifestName(apiDir: string, fallback: string): string {
	try {
		const doc: unknown = parse(fs.readFileSync(path.join(apiDir, "manifest.yaml"), "utf-8"));
		if (doc && typeof doc === "object" && "name" in doc) {
			const name = (doc as { name?: unknown }).name;
			if (typeof name === "string" && name.trim())
				return name.trim();
		}
	}
	catch {}
	return fallback;
}

/**
 * 模块名 → tsconfig `paths` 规则（仅 module-root 布局）。
 *
 * 键序按目录名排序（`scanModules` 已排序），保证同布局两次生成字节一致——
 * 否则「生成物是否过期」的比对会因文件系统枚举顺序抖动而误报。
 */
export function aliasPathEntries(layout: ProjectLayout): Record<string, string[]> {
	if (layout.kind !== "module-root")
		return {};
	const entries: Record<string, string[]> = {};
	for (const mod of fs.readdirSync(layout.modulesSrc, { withFileTypes: true })) {
		if (!mod.isDirectory() || mod.name.startsWith("."))
			continue;
		const apiDir = path.join(layout.modulesSrc, mod.name, "api");
		if (!fs.existsSync(path.join(apiDir, "manifest.yaml")))
			continue;
		const name = manifestName(apiDir, mod.name);
		entries[`#/${name}/*`] = [`./${path.posix.join("src", mod.name, "api", "*")}`];
	}
	return entries;
}

/** 渲染 `tsconfig.paths.json`（含头注释；tsconfig 解析器接受 JSONC） */
export function renderAliasPaths(layout: ProjectLayout): string {
	const entries = Object.entries(aliasPathEntries(layout));
	const body = entries.length === 0
		? "\t\t\"paths\": {}"
		: `\t\t"paths": {\n${
			entries
				.map(([pattern, targets]) => `\t\t\t${JSON.stringify(pattern)}: [${targets.map(t => JSON.stringify(t)).join(", ")}]`)
				.join(",\n")
		}\n\t\t}`;
	return `${HEADER}\n{\n\t"compilerOptions": {\n${body}\n\t}\n}\n`;
}

/**
 * 按当前模块清单同步生成物，**内容未变则不写**（避免每次 build 都产生无意义 diff）。
 *
 * 返回 `skipped` 表示不是 module-root 布局（历史布局的别名口径不同，不在此生成）。
 */
export function syncAliasPaths(projectRoot: string): "created" | "updated" | "unchanged" | "skipped" {
	const layout = tryResolveLayout(projectRoot);
	if (layout?.kind !== "module-root")
		return "skipped";
	const file = path.join(projectRoot, ALIAS_PATHS_FILE);
	const next = renderAliasPaths(layout);
	const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
	if (prev === next)
		return "unchanged";
	fs.writeFileSync(file, next);
	return prev === null ? "created" : "updated";
}
