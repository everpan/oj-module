/**
 * ESM 导入/导出面的静态解析 —— 共享资产导出完整性校验的基础设施（R14 / A13）。
 *
 * 为什么需要它：shell 把每个共享依赖单独打包成自包含 ESM，相互 external，
 * 由 importmap 解析（设计文档 §4.3 / D5）。这条链路上有一类**静默**失败——
 * 产物构建成功、文件存在、体积正常，但具名导出为空，直到浏览器执行
 * `import { create } from "zustand"` 才抛
 * "does not provide an export named 'create'"（整页白屏）。
 *
 * 根因（A22）：`export *` 一旦经过 **external** 模块，esbuild 无法静态展开，
 * 会退化成运行期的 `__reExport(...)`（往普通对象上 defineProperty），
 * 最终产物只剩 `export { default }`。具名导入要求**静态**导出面，因此必炸。
 *
 * 本模块只做「扫描产物文本、回答谁导出/导入了什么」，不含修复逻辑，
 * 供 shell 构建（门禁，失败即中断）与 tests/ 共用，避免两套正则漂移。
 *
 * 解析口径：`es-module-lexer` 真词法扫描，而非行首正则。
 * 早先的实现假设「esbuild/vite 在 `minify: false` 下顶层语句一律顶格」，一旦
 * 共享资产开启压缩（`minifyWhitespace` 会把 `export{a as b}` / `}from"react"`
 * 挤成一行且行内任意位置），行首锚定的正则全部失配 → 门禁集体误报「零具名导出」
 * 和「裸说明符未登记」。词法扫描只依赖语法、与压缩/换行无关，故换掉。
 * 顺带消灭了「字符串字面量里恰好写了 import/from」的误报（原先靠行首锚定压制）。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ImportType, initSync, parse as lexModule } from "es-module-lexer";

/** 一个 ESM 文件的导出面 */
export interface EsmExports {
	/** 静态具名导出（不含 `default`、不含 `export *` 透传的部分） */
	names: Set<string>
	/**
	 * 是否有 `default` 导出。
	 *
	 * 单独成一个字段而非塞进 names：default 导入（`import X from "pkg"`）与具名导入
	 * 是两套不同的失败信息（都是 "does not provide an export named"，但名字不同），
	 * 且大量包是「只有 default」或「只有具名」，混在一起无法区分这两种形态。
	 */
	hasDefault: boolean
	/**
	 * 是否含 `export * from "…"`。为真表示导出面无法静态确定
	 * （浏览器可以，静态扫描不行），校验须跳过而非判失败。
	 */
	hasStarReexport: boolean
}

/** 一条静态导入/再导出语句消费的说明符与具名绑定 */
export interface EsmImport {
	specifier: string
	names: string[]
	/**
	 * 是否消费 `default`。
	 *
	 * 单独成字段：`import X from "pkg"` 与 `import { a } from "pkg"` 的失败
	 * 形态相同（都是 "does not provide an export named"）但判据不同——
	 * 只校验具名会漏掉 default 导入，而「只有 default」的包（dayjs / ky /
	 * simplebar-react / i18next …）恰好全靠 default 导入使用。
	 */
	needsDefault: boolean
}

/**
 * `import { a, b as c }` 中被**请求**的名字。
 *
 * 注意方向：导入取 `as` **左**边的原名（`b as c` 取 `b`），
 * 与导出相反——esbuild 会把 `import { useState } from "react"` 改写成
 * `import { useState as useState2 }`，右侧只是本地别名，与目标模块无关。
 */
function importedNamesFromClause(clause: string): string[] {
	return clause
		.split(",")
		.map(part => part.trim())
		.filter(Boolean)
		.map(part => part.split(/\s+as\s+/)[0]!.trim())
		.filter(name => name !== "default");
}

/** wasm 实例化只需一次；按需初始化，避免「只是 import 一下」的消费方付启动开销 */
let lexReady = false;
function lex(source: string): ReturnType<typeof lexModule> {
	if (!lexReady) {
		initSync();
		lexReady = true;
	}
	return lexModule(source);
}

/** 语句文本；`ss`/`se` 是 lexer 给出的整条语句区间（含分号） */
function statementAt(source: string, ss: number, se: number): string {
	return source.slice(ss, se);
}

/**
 * 从一条 `import … from "x"` / `export … from "x"` 语句里分出关键字与子句。
 *
 * 语句边界已由 lexer 确定，这里只处理语句内部的切片，因此不再需要行首锚定，
 * 压缩后（`import{a as b}from"react"`）同样成立。
 */
function clauseOf(statement: string): { keyword: "import" | "export", clause: string } | undefined {
	const head = /^\s*(import|export)\b/.exec(statement);
	if (!head)
		return undefined;
	const rest = statement.slice(head[0].length);
	// `from` 后必须紧跟说明符字符串，才不会误取子句里的同名标识符
	const fromIdx = rest.search(/\bfrom\s*["']/);
	if (fromIdx < 0)
		return undefined;
	return { keyword: head[1] as "import" | "export", clause: rest.slice(0, fromIdx) };
}

/** 解析产物的静态导出面 */
export function parseEsmExports(source: string): EsmExports {
	const [imports, exports] = lex(source);
	const names = new Set<string>();
	let hasDefault = false;

	for (const exp of exports) {
		if (exp.n === "default")
			hasDefault = true;
		else
			names.add(exp.n);
	}

	// `export * from "x"` 不产生具名导出（静态不可展开），lexer 也不把它列进 exports，
	// 只能从「语句以 export 开头、星号之后不带 as」反推。
	// `export * as ns from "x"` 是有名字的导出（ns），导出面仍可静态确定，不算在内。
	const hasStarReexport = imports.some((imp) => {
		if (imp.t !== ImportType.Static || imp.ss < 0)
			return false;
		return /^export\s*\*(?!\s*as\b)/.test(statementAt(source, imp.ss, imp.se));
	});

	return { names, hasDefault, hasStarReexport };
}

/**
 * 解析产物消费了哪些说明符的哪些具名导出。
 *
 * 覆盖：`import { a, b as c } from "x"`、`import X, { a } from "x"`、
 * `export { a } from "x"`（再导出同样是消费）。
 *
 * 不覆盖：`import * as ns from "x"`、动态 `import("x")` 后取属性——
 * 这些都拿不到具名绑定，无从校验。
 */
export function parseEsmImports(source: string): EsmImport[] {
	const [imports] = lex(source);
	const found = new Map<string, { names: Set<string>, needsDefault: boolean }>();

	const slot = (specifier: string) => {
		let entry = found.get(specifier);
		if (!entry) {
			entry = { names: new Set<string>(), needsDefault: false };
			found.set(specifier, entry);
		}
		return entry;
	};

	for (const imp of imports) {
		// 动态 import / import.meta 不带静态具名绑定
		if (imp.t !== ImportType.Static || imp.ss < 0 || !imp.n)
			continue;
		const parsed = clauseOf(statementAt(source, imp.ss, imp.se));
		if (!parsed)
			continue;

		const entry = slot(imp.n);
		const brace = /\{([^}]*)\}/.exec(parsed.clause);
		if (brace) {
			for (const name of importedNamesFromClause(brace[1] ?? ""))
				entry.names.add(name);
		}

		// default 导入：子句去掉 `{…}` 后仍剩标识符（`X` / `X,`）。
		// `* as ns` 是命名空间导入，不消费 default。
		// 不能假定它一定可用——只有 default 的包若 shim 没兜住，浏览器同样是
		// "does not provide an export named 'default'"。
		if (parsed.keyword === "import") {
			const head = parsed.clause.replace(/\{[^}]*\}/g, "").trim();
			if (head && !head.startsWith("*"))
				entry.needsDefault = true;
		}
	}

	return [...found].map(([specifier, entry]) => ({
		specifier,
		names: [...entry.names],
		needsDefault: entry.needsDefault,
	}));
}

/**
 * 产物里的动态 require 目标：`__require("x")`。
 *
 * 被打包进来的 CJS 依赖若 `require()` 了一个 **external** 的共享包，esbuild 无法
 * 转成静态 import，只能生成 `__require("x")`；而它内部判据是
 * `typeof require !== "undefined"`，浏览器里没有 `require`，于是抛
 * `Dynamic require of "x" is not supported` —— 且这些调用全在模块初始化路径上，
 * 资产一加载就整页崩（A23）。
 */
export function parseDynamicRequires(source: string): string[] {
	const found = new Set<string>();
	for (const m of source.matchAll(/__require\d*\(\s*["']([^"']+)["']\s*\)/g))
		found.add(m[1]!);
	return [...found];
}

/**
 * 产物里 require 垫片（构建期 banner）**已覆盖**的说明符。
 *
 * 注意：注入垫片后 `__require("x")` 的调用点仍留在文本里（只是运行时转调垫片），
 * 所以门禁必须比对「垫片是否覆盖了它」，不能只扫调用点，否则修完还是报警。
 */
export function parseRequireShimSpecifiers(source: string): Set<string> {
	const covered = new Set<string>();
	for (const m of source.matchAll(/__rad_require\s*=\s*\{([^}]*)\}/g)) {
		for (const key of m[1]!.matchAll(/["']([^"']+)["']\s*:/g))
			covered.add(key[1]!);
	}
	return covered;
}

/** 一处「资产动态 require 了共享包，但没有垫片兜住」 */
export interface DynamicRequireHit {
	file: string
	specifier: string
	url: string
}

/**
 * 动态 require 门禁（A23）。
 *
 * 纯静态扫描，零误报、不执行；修复完成后恒为空，用于防回归。
 */
export function collectDynamicRequires(distDir: string): DynamicRequireHit[] {
	const assetsDir = resolve(distDir, "assets");
	const importmap = readShellImportmap(distDir);

	const hits: DynamicRequireHit[] = [];
	for (const file of readdirSync(assetsDir).filter(f => f.endsWith(".js"))) {
		const source = readFileSync(resolve(assetsDir, file), "utf-8");
		const covered = parseRequireShimSpecifiers(source);
		for (const specifier of parseDynamicRequires(source)) {
			const url = importmap[specifier];
			if (url && !covered.has(specifier))
				hits.push({ file, specifier, url });
		}
	}
	return hits;
}

/**
 * 产物引用的全部裸说明符（静态/副作用 import、`import("x")`、再导出）。
 *
 * 浏览器只能解析 importmap 里登记过的裸说明符，漏一个就是
 * `Failed to resolve module specifier` 白屏。
 */
export function parseBareSpecifiers(source: string): string[] {
	const [imports] = lex(source);
	const found = new Set<string>();
	// lexer 已给出每条语句的说明符原文；非字符串字面量（`import(x)`）为 undefined，跳过
	for (const imp of imports) {
		const spec = imp.n;
		if (!spec)
			continue;
		if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("data:") || spec.startsWith("http"))
			continue;
		found.add(spec);
	}
	return [...found];
}

/** 一处「资产引用了 importmap 未登记的裸说明符」 */
export interface UnresolvedSpecifier {
	file: string
	specifier: string
}

/** 解析门禁：产物引用的裸说明符必须全部能被 importmap 解析 */
export function collectUnresolvedSpecifiers(distDir: string): UnresolvedSpecifier[] {
	const assetsDir = resolve(distDir, "assets");
	const importmap = readShellImportmap(distDir);

	const gaps: UnresolvedSpecifier[] = [];
	for (const file of readdirSync(assetsDir).filter(f => f.endsWith(".js"))) {
		for (const specifier of parseBareSpecifiers(readFileSync(resolve(assetsDir, file), "utf-8"))) {
			if (!importmap[specifier])
				gaps.push({ file, specifier });
		}
	}
	return gaps;
}

/**
 * 读取 shell 产物 index.html 里的 importmap。
 * 单一实现，避免 shell 构建脚本与 tests/ 各写一份正则而漂移。
 */
export function readShellImportmap(distDir: string): Record<string, string> {
	const html = readFileSync(resolve(distDir, "index.html"), "utf-8");
	const match = html.match(/<script type="importmap"[^>]*>(.*?)<\/script>/s);
	if (!match)
		throw new Error(`${resolve(distDir, "index.html")} 缺少 importmap`);
	return JSON.parse(match[1]).imports as Record<string, string>;
}

/** 一处「消费方要的具名导出，目标资产没提供」 */
export interface ExportGap {
	/** 消费方资产文件名（assets/ 下） */
	file: string
	/** 被导入的裸说明符 */
	specifier: string
	/** importmap 给出的 URL */
	url: string
	/** 缺失的具名导出；为空表示 importmap 指向的资产文件不存在 */
	missing: string[]
}

export function formatExportGap(gap: ExportGap): string {
	return gap.missing.length
		? `  · ${gap.file} 从 "${gap.specifier}"（${gap.url}）导入 ${gap.missing.join(", ")}，但该资产未提供这些具名导出`
		: `  · ${gap.file} → "${gap.specifier}"：importmap 指向的资产不存在（${gap.url}）`;
}

/**
 * 共享资产导出完整性校验（设计文档 R14 落地）。
 *
 * importmap 给出的每个资产，都必须**静态**提供消费方 import 的具名导出。
 * 缺一个名字 = 浏览器抛 "does not provide an export named 'x'" = 整页白屏，
 * 而产物体积、文件存在性、构建退出码全部正常（A22）——只有这道门禁能拦在构建期。
 *
 * 覆盖 `distDir/assets` 下全部 .js：含 runtime.js（框架产物，最大的消费方）、
 * 宿主 index-*.js，以及各共享资产之间的相互引用。
 * shell 构建脚本（失败即中断）与 CI 测试共用这一份实现。
 */
export function collectExportGaps(distDir: string): ExportGap[] {
	const assetsDir = resolve(distDir, "assets");
	const importmap = readShellImportmap(distDir);

	const exportCache = new Map<string, EsmExports>();
	const exportsOf = (file: string) => {
		let cached = exportCache.get(file);
		if (!cached) {
			cached = parseEsmExports(readFileSync(resolve(assetsDir, file), "utf-8"));
			exportCache.set(file, cached);
		}
		return cached;
	};

	const gaps: ExportGap[] = [];
	for (const file of readdirSync(assetsDir).filter(f => f.endsWith(".js"))) {
		for (const imp of parseEsmImports(readFileSync(resolve(assetsDir, file), "utf-8"))) {
			const url = importmap[imp.specifier];
			// 相对路径 / 未登记裸说明符不在本门禁职责内
			if (!url)
				continue;
			const target = url.replace(/^\//, "").replace(/^assets\//, "");
			if (!existsSync(resolve(assetsDir, target))) {
				gaps.push({ file, specifier: imp.specifier, url, missing: [] });
				continue;
			}
			const provided = exportsOf(target);
			// 含 `export *` 的资产导出面静态不可知（浏览器可知），跳过而非误判
			if (provided.hasStarReexport)
				continue;
			const missing = imp.names.filter(n => !provided.names.has(n));
			// default 导入：目标资产必须真的有 default 导出
			if (imp.needsDefault && !provided.hasDefault)
				missing.unshift("default");
			if (missing.length)
				gaps.push({ file, specifier: imp.specifier, url, missing });
		}
	}

	return gaps;
}
