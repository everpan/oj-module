/**
 * 构建预构建宿主（shell）。
 *
 * 产物（cli 包根 shell-dist/）：
 *   index.html                  —— importmap 由 cli 的 SHARED_DEPS 单一来源生成（P4.1/P4.3）
 *   assets/<name>.js            —— 各共享依赖的单入口自包含 ESM
 *   assets/index-<hash>.js      —— 宿主应用（host.tsx，external 全部共享依赖）
 *   assets/runtime.js           —— 拷贝自 @oj-module/runtime 的 dist
 *
 * 关键：每个共享依赖单独打包、相互 external（经 importmap 解析），
 * 从而宿主与模块命中同一份 react / antd / runtime 实例（单例，D5）。
 * 预构建清单不再手写（B11）：一律来自 generateShellEntries() / generateImportmap()。
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import react from "@vitejs/plugin-react";
import { build as esbuild } from "esbuild";
import { build } from "vite";
import {
	collectDynamicRequires,
	collectExportGaps,
	collectUnresolvedSpecifiers,
	formatExportGap,
	parseDynamicRequires,
	parseEsmExports,
} from "../../src/esm-exports";
import { generateImportmap, generateShellEntries, isSharedDep, SHARED_DEPS } from "../../src/shared-deps";

import { defaultTrustedOrigins, generateCsp, generateNonce } from "../src/csp";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const shellDir = resolve(__dirname, "..");
// 预构建宿主产物落在 cli 包根的 shell-dist/（原 @oj-module/shell 的 dist），
// 随 cli 一起发布，外部工程经 `@oj-module/cli/shell-dist` 消费
const distDir = resolve(shellDir, "..", "shell-dist");
const assetsDir = resolve(distDir, "assets");

function injectImportmap(map: Record<string, string>) {
	return {
		name: "inject-importmap",
		transformIndexHtml(html: string) {
			// P6.2 / §4.8：构建期随机 nonce——内联 importmap 必须带 nonce，
			// 否则被 CSP script-src 'self' 拦掉；每次 build 轮换，不加 strict-dynamic
			const nonce = generateNonce();
			const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${generateCsp(defaultTrustedOrigins, nonce).replace(/\n/g, " ")}" />`;
			const script = `<script type="importmap" nonce="${nonce}">${JSON.stringify({ imports: map }, null, 2)}</script>`;
			return html.replace("<!--CSP-->", cspMeta).replace("<!--IMPORTMAP-->", script);
		},
	};
}

/**
 * react 家族（react / react-dom / react-dom/client / react/jsx-runtime /
 * react/jsx-dev-runtime）在 npm 中仅有 CJS 产物、无 ESM 入口，且用
 * `Object.defineProperty(exports, "x", { get })` 方式赋导出。esbuild 对这类
 * CJS 无法静态合成具名导出（只会给 `default`），宿主 `import { useState } from
 * "react"` 即触发 "does not provide an export named" 链接错误 → 纯白屏。
 *
 * 修复（P8）：构建期在 Node 侧 `import()` 读出这些 CJS 包的真实导出名，再生成
 * 一段显式转发 shim（`export const useState = __m["useState"]; …`），由 esbuild
 * 原样打进 ESM 产物。其余依赖（antd/es、cssinjs/es、react-router .mjs …）都是
 * ESM，直接 `export *` 原样透传具名导出。整条链路不依赖任何 CJS 互操作插件。
 */
const REACT_CJS_PKGS = new Set<string>([
	"react",
	"react-dom",
	"react-dom/client",
	"react/jsx-runtime",
	"react/jsx-dev-runtime",
]);

const VALID_ID = /^[A-Z_$][\w$]*$/i;

/**
 * 「是共享依赖 且 不是本包」→ external，交给 importmap 解析（单例，D5）。
 * esbuild 的 `external` 只接受数组，故用 onResolve 表达该条件。
 * 子路径共享依赖同样被 external —— 这条规则正是 A22 的成因，见 explicitForwardingShim。
 */
function makeExternalShared(currentPkg: string): import("esbuild").Plugin {
	return {
		name: "ram-external-shared",
		setup(b) {
			b.onResolve({ filter: /.*/ }, (args) => {
				if (isSharedDep(args.path) && args.path !== currentPkg)
					return { path: args.path, external: true };
				return null;
			});
		},
	};
}

/** 把一份入口 shim 打成自包含 ESM 资产 */
async function bundleShim(name: string, pkg: string, shim: string, banner?: string) {
	const shimPath = resolve(shellDir, `.ram-shim-${name}.mjs`);
	writeFileSync(shimPath, shim);
	try {
		await esbuild({
			entryPoints: [shimPath],
			bundle: true,
			format: "esm",
			platform: "browser",
			target: "es2020",
			// Spike A 坑 2：浏览器顶层求值会抛 process is not defined（风险 R15）
			define: { "process.env.NODE_ENV": JSON.stringify("production") },
			plugins: [makeExternalShared(pkg)],
			outfile: resolve(assetsDir, `${name}.js`),
			sourcemap: "external",
			logLevel: "warning",
			banner: banner ? { js: banner } : undefined,
		});
	}
	finally {
		rmSync(shimPath, { force: true });
	}
}

/**
 * 构建期 require 垫片（A23）。
 *
 * 被打包进来的 CJS 依赖（use-sync-external-store / scheduler / 各种 UMD 工厂）
 * 会 `require("react")`，而 react 是 external（必须单例）。esbuild 只能生成
 * `__require("react")`，它内部判 `typeof require !== "undefined"`，浏览器没有
 * `require` → 一调用就抛，且全在模块初始化路径上，资产加载即整页崩。
 *
 * 对策：在产物顶部定义一个 `require`，把命中的共享包映射到真正的 ESM 导入。
 * 只导入该资产**实际 require 的**那几个包（当前最多 2 个），
 * 不会退化成「每个资产 import 全部共享包」。
 * UMD 工厂自带 `e && e.hasOwnProperty("default") ? e.default : e`，与命名空间语义吻合。
 */
function requireShimBanner(specifiers: string[]): string {
	const imports = specifiers.map((spec, i) => `import * as __rad_ext_${i} from ${JSON.stringify(spec)};`);
	const entries = specifiers.map((spec, i) => `  ${JSON.stringify(spec)}: __rad_ext_${i}`).join(",\n");
	return [
		...imports,
		`var __rad_require = {\n${entries}\n};`,
		"var require = function (id) {",
		"  if (Object.prototype.hasOwnProperty.call(__rad_require, id)) return __rad_require[id];",
		"  throw new Error(\"Dynamic require of \" + JSON.stringify(id) + \" is not supported（该说明符未在共享表内登记）\");",
		"};",
	].join("\n");
}

/**
 * 构建后复查：若产物含「CJS require 共享包」，用垫片重建一次。
 * 返回最终使用的 banner（供调用方复用）。
 */
async function repairDynamicRequires(name: string, pkg: string, shim: string): Promise<void> {
	const assetPath = resolve(assetsDir, `${name}.js`);
	const required = parseDynamicRequires(readFileSync(assetPath, "utf-8")).filter(isSharedDep);
	if (!required.length)
		return;
	console.warn(
		`[shell] ⚠️ ${pkg} 内含 CJS require(${required.join(", ")})，注入 require 垫片重建（A23）`,
	);
	await bundleShim(name, pkg, shim, requireShimBanner(required));
}

/**
 * 在 Node 侧读出包的真实导出名，用于为「export * 失效」的包生成显式转发 shim。
 *
 * 返回 null 有两种含义，都必须**保持原策略**而不是硬凑名字：
 *   1. 包在 Node 下抛错（浏览器专用包，如 nprogress 需要 document）；
 *   2. 包确实只有 default 导出（dayjs / simplebar-react / antd/locale/* …）。
 *
 * 刻意**不**回退到 `require()`：CJS 的 module.exports 上常带 `$$typeof` / `render`
 * 之类内部键，会被误当成公开导出名转发成 undefined，反而制造噪音。
 * 读不到就交给 assertSharedExportsComplete —— 只有真正有人具名导入时才报错。
 */
async function resolveExportNames(pkg: string): Promise<string[] | null> {
	try {
		const mod = await import(pkg);
		if (!mod || typeof mod !== "object")
			return null;
		const names = Object.keys(mod)
			.filter(n => n !== "default" && n !== "__esModule" && VALID_ID.test(n));
		return names.length ? names : null;
	}
	catch {
		return null;
	}
}

/**
 * 显式转发 shim（A22 对策）。
 *
 * `export *` 一旦经过 external 模块，esbuild 无从静态展开，只能退化成运行期
 * `Object.defineProperty` 拷贝（产物里的 `__reExport`），于是最终 `export {…}`
 * 只剩 default。浏览器侧 `import { create } from "zustand"` 随即抛
 * "does not provide an export named 'create'" —— 而构建退出码、文件体积、
 * 存在性检查全部正常，是彻底的静默失败。
 *
 * 对策：构建期读出真实导出名，逐个 `export const X = __m["X"]` 转发。
 * ESM 保证被依赖模块先于本模块求值，故求值时 __m 已由 importmap 加载完成，
 * 取值安全。这与 react 家族（CJS、无 ESM 产物）早已在用的策略一致。
 */
function explicitForwardingShim(pkg: string, names: string[]): string {
	const src = JSON.stringify(pkg);
	return [
		`import * as __m from ${src};\n`,
		...names.map(n => `export const ${n} = __m[${JSON.stringify(n)}];\n`),
		"export default (__m.default ?? __m);\n",
	].join("");
}

/**
 * 默认 shim：命名导出走 `export *`，default 走「有真实 default 就用它，
 * 否则回退到命名空间」。
 *
 * 注：不能用 `import __m from "pkg"`（react-router 等根本没 default，
 * esbuild 直接报 No matching export 让整条预构建失败）。
 */
function starShim(pkg: string): string {
	const src = JSON.stringify(pkg);
	return [
		`import * as __ns from ${src};\n`,
		`export * from ${src};\n`,
		"export default (__ns.default ?? __ns);\n",
	].join("");
}

/**
 * 共享样式依赖（如 `nprogress/nprogress.css`）：生成一段自执行的 JS 垫片，
 * 把 CSS 文本包进 <style> 注入 <head>（用 data-ram-css 标记去重，避免重复注入）。
 * 该垫片经 importmap 解析（`nprogress/nprogress.css` → /assets/nprogress-css.js），
 * 因此宿主/模块侧 `import "nprogress/nprogress.css"` 这类副作用导入即可生效。
 */
async function buildCssEntry(entry: { name: string, pkg: string }) {
	console.log(`[shell] 构建共享依赖(样式) ${entry.name} ← ${entry.pkg}`);
	const require = createRequire(import.meta.url);
	const cssPath = require.resolve(entry.pkg);
	const css = readFileSync(cssPath, "utf-8");
	const shim = [
		`const __css = ${JSON.stringify(css)};\n`,
		`if (!document.querySelector('style[data-ram-css=${JSON.stringify(entry.pkg)}]')) {\n`,
		"  const __s = document.createElement(\"style\");\n",
		`  __s.setAttribute("data-ram-css", ${JSON.stringify(entry.pkg)});\n`,
		"  __s.textContent = __css;\n",
		"  document.head.appendChild(__s);\n",
		"}\n",
	].join("");
	writeFileSync(resolve(assetsDir, `${entry.name}.js`), shim);
}

async function buildSharedEntries() {
	for (const entry of generateShellEntries()) {
		// 共享依赖的样式（*.css）：浏览器无法把 CSS 当 ES 模块 import，
		// 故改为「importmap 映射到一段注入 <style> 的 JS 垫片」——与共享 JS 依赖
		// 同一套 importmap 解析机制，宿主/模块命中同一份样式且无重复注入。
		if (entry.pkg.endsWith(".css")) {
			await buildCssEntry(entry);
			continue;
		}

		console.log(`[shell] 构建共享依赖 ${entry.name} ← ${entry.pkg}`);

		let shim: string;

		// react 家族在 npm 只有 CJS 产物、且用 defineProperty getter 赋导出，
		// esbuild 静态合成不出具名导出（A13）→ 直接走显式转发
		if (REACT_CJS_PKGS.has(entry.pkg)) {
			const names = await resolveExportNames(entry.pkg);
			shim = names ? explicitForwardingShim(entry.pkg, names) : starShim(entry.pkg);
		}
		else {
			shim = starShim(entry.pkg);
		}

		await bundleShim(entry.name, entry.pkg, shim);

		// A22：`export *` 经 external 子路径退化后，产物零具名导出。
		// 此时用构建期读到的真实导出名重建一次（读不到则交由此后的门禁报错）。
		const produced = parseEsmExports(readFileSync(resolve(assetsDir, `${entry.name}.js`), "utf-8"));
		if (produced.names.size === 0 && !produced.hasStarReexport) {
			const names = await resolveExportNames(entry.pkg);
			if (names) {
				console.warn(
					`[shell] ⚠️ ${entry.pkg} 的 export * 未产出静态具名导出（A22），`
					+ `改用显式转发重建（${names.length} 项）`,
				);
				shim = explicitForwardingShim(entry.pkg, names);
				await bundleShim(entry.name, entry.pkg, shim);
			}
		}

		// A23：CJS 依赖 require 了 external 的共享包 → 注入 require 垫片重建
		await repairDynamicRequires(entry.name, entry.pkg, shim);
	}
}

/**
 * 扫描所有已构建的共享依赖资产，找出其中「裸导入但 importmap 尚未覆盖」的说明符，
 * 将其补进 importmap —— 并且对父包不透传的子路径直接构建一份独立共享资产，
 * 从而一次性消除整类 "Failed to resolve module specifier" 白屏（举一反三）。
 *
 * 背景（本轮白屏根因）：共享依赖资产（如 antd.js / pro-components.js）内部会
 * `import … from "antd/es/modal"`、`"@ant-design/icons/es/icons/X"`（父包 `export *`
 * 透传具名导出），或副作用导入 `"dayjs/locale/zh-cn"`、`"zustand/react"`、
 * `"dayjs/plugin/*"`（父包不透传）。这些子路径在 `buildSharedEntries` 里都被
 * `isSharedDep` 判为共享依赖而 external 出去，最终以裸说明符落到产物里，必须由
 * importmap 兜底解析，否则浏览器直接白屏。
 *
 * 处理分两类：
 *   (a) 父包透传的子路径（antd、@ant-design/icons 的 es/*）—— 映射到父包资产，
 *        命中同一份实例（单例，D5/D12），无需新增资产；
 *   (b) 父包不透传的子路径（dayjs/locale/*、dayjs/plugin/*、zustand/react*、
 *        echarts/charts …）—— 现场 esbuild 构建一份独立 ESM 资产并写盘，再映射。
 *        这类子路径多为副作用注册（locale / plugin），独立资产加载即生效。
 *
 * 因新建资产自身也可能引入新的未覆盖子路径，故做不动点迭代（maxIter 兜底防死循环）。
 */
const SUBPATH_PARENT_REEXPORTS = new Set([
	"antd",
	"@ant-design/icons",
]);

/** 捕获三种裸导入形式：from "…" / import("…") / 副作用 import "…" */
const BARE_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;

/** 自动生成的子路径资产名统一加 ram- 前缀，避免与 SHARED_DEPS 显式资产名冲突 */
function subpathAssetName(spec: string): string {
	return `ram-${spec.replace(/[^a-z0-9]+/gi, "-")}`;
}

/** 为单个非父包透传的子路径构建独立 ESM（或 CSS）共享资产 */
async function buildSubpathAsset(spec: string) {
	const name = subpathAssetName(spec);
	if (spec.endsWith(".css")) {
		await buildCssEntry({ name, pkg: spec });
		return;
	}
	const shim = starShim(spec);
	const shimPath = resolve(shellDir, `.ram-shim-${name}.mjs`);
	writeFileSync(shimPath, shim);
	try {
		await esbuild({
			entryPoints: [shimPath],
			bundle: true,
			format: "esm",
			platform: "browser",
			target: "es2020",
			define: { "process.env.NODE_ENV": JSON.stringify("production") },
			plugins: [makeExternalShared(spec)],
			outfile: resolve(assetsDir, `${name}.js`),
			sourcemap: "external",
			logLevel: "warning",
		});
	}
	finally {
		rmSync(shimPath, { force: true });
	}
	await repairDynamicRequires(name, spec, shim);
}

/**
 * 为 antd 父包的子路径（如 `antd/es/modal`）构建「从父包再导出」的 shim 资产。
 *
 * 背景（本轮 my-profile 白屏根因）：共享表把 `antd/es/*` 这类父包透传子路径映射到
 * 父包资产 `antd.js`，而 `antd.js` 的 `default` 是**整个 antd 命名空间对象**
 * （`export default (__ns.default ?? __ns)`）。消费方若用**默认导入**子路径
 * （`antd-img-crop` 的 `import AntModal from "antd/es/modal"`），拿到的就是命名空间，
 * 渲染时触发 React #130（got object）。
 *
 * shim 复用父包 `antd.js` 的单一实例（`makeExternalShared(spec)` 让 `antd` 走 importmap，
 * 不重复打包 rc-*，满足 D5 单例），并把 `default` 修正为父包中对应的具名导出
 * （`modal→Modal` / `upload→Upload` 等；`Cap`/`last` 双重候选 + 命名空间回退），
 * 同时 `export *` 透传全部具名导出以兼容其它具名导入。
 */
async function buildAntdSubpathAsset(spec: string) {
	const name = subpathAssetName(spec);
	const last = spec.split("/").pop() || "";
	const Cap = last.charAt(0).toUpperCase() + last.slice(1);
	const shim = [
		"import * as __antd from \"antd\";\n",
		"export * from \"antd\";\n",
		`const __d = __antd[${JSON.stringify(Cap)}] ?? __antd[${JSON.stringify(last)}] ?? __antd.default;\n`,
		"export default __d;\n",
	].join("");
	const shimPath = resolve(shellDir, `.ram-shim-${name}.mjs`);
	writeFileSync(shimPath, shim);
	try {
		await esbuild({
			entryPoints: [shimPath],
			bundle: true,
			format: "esm",
			platform: "browser",
			target: "es2020",
			define: { "process.env.NODE_ENV": JSON.stringify("production") },
			plugins: [makeExternalShared(spec)],
			outfile: resolve(assetsDir, `${name}.js`),
			sourcemap: "external",
			logLevel: "warning",
		});
	}
	finally {
		rmSync(shimPath, { force: true });
	}
	await repairDynamicRequires(name, spec, shim);
}

/**
 * 为 `@ant-design/icons/es/icons/<Name>` 构建「default 指向具名图标」的 shim 资产。
 *
 * 背景（tabbar 关闭图标 × 丢失根因）：antd 内部用**默认导入**引用图标
 * （`import CloseOutlined from "@ant-design/icons/es/icons/CloseOutlined"`），
 * 而这类深路径此前被 SUBPATH_PARENT_REEXPORTS 直接映射到父包资产 icons.js。
 * icons.js 的 default 是 `@ant-design/icons` 的 default —— 通用 `<Icon />` 壳
 * （无 icon prop），于是所有 antd 内部图标都渲染成空的 `<span class="anticon">`
 * （关闭 ×、Typography 复制、Tabs 更多菜单等一起丢）。
 *
 * 子路径模块本身 default 导出各自的图标组件，故这里按末段名取父包具名导出修正
 * default（与 antd 子路径同思路）。单例不受影响：`@ant-design/icons` 在 shim 内
 * 是共享依赖 → external → importmap → 同一份 icons.js 实例（D5）。
 */
async function buildIconsSubpathAsset(spec: string) {
	const name = subpathAssetName(spec);
	const last = spec.split("/").pop() || "";
	const shim = [
		"import * as __icons from \"@ant-design/icons\";\n",
		`const __d = __icons[${JSON.stringify(last)}] ?? __icons.default;\n`,
		"export default __d;\n",
	].join("");
	const shimPath = resolve(shellDir, `.ram-shim-${name}.mjs`);
	writeFileSync(shimPath, shim);
	try {
		await esbuild({
			entryPoints: [shimPath],
			bundle: true,
			format: "esm",
			platform: "browser",
			target: "es2020",
			define: { "process.env.NODE_ENV": JSON.stringify("production") },
			plugins: [makeExternalShared(spec)],
			outfile: resolve(assetsDir, `${name}.js`),
			sourcemap: "external",
			logLevel: "warning",
		});
	}
	finally {
		rmSync(shimPath, { force: true });
	}
	await repairDynamicRequires(name, spec, shim);
}

async function autoGenerateSubpathAssets(base: Record<string, string>): Promise<Record<string, string>> {
	const map: Record<string, string> = { ...base };
	const maxIter = 20;
	let changed = true;
	let iter = 0;
	while (changed && iter++ < maxIter) {
		changed = false;
		for (const file of readdirSync(assetsDir)) {
			if (!file.endsWith(".js"))
				continue;
			const src = readFileSync(resolve(assetsDir, file), "utf-8");
			BARE_IMPORT_RE.lastIndex = 0;
			for (let mm = BARE_IMPORT_RE.exec(src); mm; mm = BARE_IMPORT_RE.exec(src)) {
				const spec = mm[1] ?? mm[2] ?? mm[3];
				if (!spec || [".", "/", "data:"].some(p => spec.startsWith(p)) || map[spec])
					continue;
				// 最长匹配（含子路径）的父共享依赖
				const parent = [...SHARED_DEPS]
					.filter(d => spec === d.specifier || spec.startsWith(`${d.specifier}/`))
					.sort((a, b) => b.specifier.length - a.specifier.length)[0];
				if (!parent)
					continue; // 与共享表无关，交给浏览器/其它机制
				if (SUBPATH_PARENT_REEXPORTS.has(parent.specifier) && parent.asset) {
					if (parent.specifier === "@ant-design/icons" && spec.includes("/es/icons/")) {
						// 图标深路径不能用父包资产 icons.js 兜底：父包 default 是通用
						// `<Icon />` 壳，而 antd 用默认导入取图标 → 渲染成空的
						// `<span class="anticon">`（关闭 × 丢失）。改为按名修正 default
						// 的 shim（见 buildIconsSubpathAsset）。
						const name = subpathAssetName(spec);
						if (!existsSync(resolve(assetsDir, `${name}.js`))) {
							try {
								await buildIconsSubpathAsset(spec);
								console.log(`[shell] 自动构建图标子路径共享资产 ${name} ← ${spec}`);
							}
							catch (e) {
								console.warn(`[shell] 跳过无法构建的图标子路径 ${spec}：${(e as Error).message}`);
								continue;
							}
						}
						map[spec] = `/assets/${name}.js`;
						changed = true;
						continue;
					}
					if (parent.specifier === "antd") {
						// antd 子路径（antd/es/*）不能用父包资产 antd.js 兜底：父包
						// default 是整包命名空间，默认导入子路径会拿到命名空间而非组件，
						// 触发 React #130。改为构建「从父包再导出」的 shim，复用单一实例
						// 且提供正确的 default（见 buildAntdSubpathAsset）。
						const name = subpathAssetName(spec);
						if (!existsSync(resolve(assetsDir, `${name}.js`))) {
							try {
								await buildAntdSubpathAsset(spec);
								console.log(`[shell] 自动构建 antd 子路径共享资产 ${name} ← ${spec}`);
							}
							catch (e) {
								console.warn(`[shell] 跳过无法构建的 antd 子路径 ${spec}：${(e as Error).message}`);
							}
						}
						map[spec] = `/assets/${name}.js`;
						changed = true;
						continue;
					}
					map[spec] = `/assets/${parent.asset}.js`;
					changed = true;
					continue;
				}
				// 非父包透传的子路径：构建独立资产（失败则跳过，不阻断整构建）
				const name = subpathAssetName(spec);
				if (!existsSync(resolve(assetsDir, `${name}.js`))) {
					try {
						await buildSubpathAsset(spec);
						console.log(`[shell] 自动构建子路径共享资产 ${name} ← ${spec}`);
					}
					catch (e) {
						console.warn(`[shell] 跳过无法构建的子路径 ${spec}：${(e as Error).message}`);
						continue;
					}
				}
				map[spec] = `/assets/${name}.js`;
				changed = true;
			}
		}
	}
	return map;
}

async function buildHost() {
	console.log("[shell] 构建宿主 host.js + index.html");
	await build({
		root: shellDir,
		logLevel: "warn",
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
		plugins: [react(), injectImportmap(await autoGenerateSubpathAssets(generateImportmap()))],
		build: {
			outDir: distDir,
			emptyOutDir: false,
			sourcemap: "hidden",
			rollupOptions: {
				input: resolve(shellDir, "index.html"),
				external: (id: string) => isSharedDep(id),
			},
			minify: false,
		},
	});
}

/**
 * 导出完整性门禁（设计文档 R14 落地）。
 *
 * 实现在 `@oj-module/cli/esm-exports`，与 CI 测试共用同一份判定逻辑：
 * importmap 给出的每个资产都必须**静态**提供消费方 import 的具名导出，
 * 缺一个就是浏览器里的 "does not provide an export named 'x'" + 整页白屏。
 */
function assertSharedExportsComplete(): void {
	const gaps = collectExportGaps(distDir);
	if (gaps.length) {
		throw new Error(
			`[shell] 共享资产导出完整性校验失败（${gaps.length} 处）——浏览器中会抛 "does not provide an export named"：\n`
			+ `${gaps.map(formatExportGap).join("\n")}\n`
			+ "常见根因：该包入口用 `export *` 转出子路径，而子路径被 external 后 esbuild 只能退化成运行期对象（A22）。\n"
			+ "修复：确认本文件的显式转发重建已覆盖该包；若已覆盖仍失败，检查该子路径是否已在 SHARED_DEPS 中登记。",
		);
	}

	// 裸说明符未被 importmap 登记 → 浏览器抛 Failed to resolve module specifier
	const unresolved = collectUnresolvedSpecifiers(distDir);
	if (unresolved.length) {
		throw new Error(
			`[shell] 存在 importmap 未覆盖的裸说明符（${unresolved.length} 处）——浏览器中会抛 "Failed to resolve module specifier"：\n${
				unresolved.map(g => `  · ${g.file} → "${g.specifier}"`).join("\n")
			}\n修复：在 SHARED_DEPS 增补该深路径条目（importmap 无前缀通配，深路径须单独成条）。`,
		);
	}

	// A23：CJS 依赖 require 了 external 共享包却无垫片兜住 → 浏览器加载即抛
	const requireHits = collectDynamicRequires(distDir);
	if (requireHits.length) {
		throw new Error(
			`[shell] 共享资产存在未被垫片覆盖的动态 require（${requireHits.length} 处）——浏览器中会抛 "Dynamic require of ... is not supported"：\n${
				requireHits.map(h => `  · ${h.file} 动态 require "${h.specifier}"（${h.url}）`).join("\n")
			}\n修复：确认本文件的 repairDynamicRequires 已覆盖该资产；若说明符不在共享表内，请登记或改为静态 import。`,
		);
	}

	const assetCount = readdirSync(assetsDir).filter(f => f.endsWith(".js")).length;
	console.log(
		`[shell] 共享资产校验通过（${assetCount} 个资产：裸说明符 0 未覆盖、`
		+ "具名导出 0 缺失、动态 require 0 未覆盖）",
	);
}

/** 共享表各包的实际安装版本 → dist/versions.json（P4.5 版本门禁的宿主侧真源） */
function packageNameOf(specifier: string): string {
	return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}

function installedVersion(specifier: string): string | undefined {
	try {
		const resolved = import.meta.resolve(specifier, pathToFileURL(resolve(shellDir, "package.json")).href);
		let dir = resolve(fileURLToPath(resolved), "..");
		const name = packageNameOf(specifier);
		while (dir !== parse(dir).root) {
			const pkgJson = resolve(dir, "package.json");
			if (existsSync(pkgJson)) {
				const parsed = JSON.parse(readFileSync(pkgJson, "utf-8"));
				if (parsed.name === name)
					return parsed.version;
			}
			dir = resolve(dir, "..");
		}
	}
	catch {
		return undefined;
	}
}

function writeVersionsJson() {
	const versions: Record<string, string> = {};
	for (const dep of SHARED_DEPS) {
		const version = installedVersion(dep.specifier);
		if (version)
			versions[dep.specifier] = version;
	}
	writeFileSync(resolve(distDir, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
	console.log(`[shell] 版本矩阵已生成（${Object.keys(versions).length} 项） → dist/versions.json`);
}

async function main() {
	rmSync(distDir, { recursive: true, force: true });

	// runtime 完整构建（js + d.ts）：shell 直接拷贝其 dist/runtime.js。
	// 注意不可只跑 vite build —— emptyOutDir 会清掉 dist 里的 d.ts 声明树。
	console.log("[shell] 构建 runtime（完整：js + d.ts）");
	execSync("pnpm --filter @oj-module/runtime build", {
		cwd: resolve(shellDir, "../../.."),
		stdio: "inherit",
	});

	await buildSharedEntries();

	// 拷贝 runtime 产物到宿主 assets。
	// 注意**不能**用 import.meta.resolve：脚本经 tsx 运行时会命中根 tsconfig 的
	// paths，把包名解析成 src/index.ts（拷进去的是 TS 源码，非构建产物）。
	// 宿主构建只在框架仓内跑（shell-dist 是随包发布的预置产物），用相对路径最可预测。
	const runtimeSrc = resolve(shellDir, "../../runtime/dist/runtime.js");
	mkdirSync(assetsDir, { recursive: true });
	copyFileSync(runtimeSrc, resolve(assetsDir, "runtime.js"));

	await buildHost();
	assertSharedExportsComplete();
	writeVersionsJson();

	// favicon：App 链由根 index.html + public/favicon.ico 提供，宿主链此前
	// 整链缺失（layout e2e I3 暴露）。与根 public 同源拷贝，保持两链一致
	const faviconSrc = resolve(shellDir, "../../../public/favicon.ico");
	if (existsSync(faviconSrc))
		copyFileSync(faviconSrc, resolve(distDir, "favicon.ico"));

	console.log("[shell] 完成 →", distDir);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
