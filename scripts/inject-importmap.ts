/**
 * App 链生产形态 importmap 注入（方案 A，见 docs/prd/202608312359-app-chain-importmap-plan.md）。
 *
 * 在 `vite build`（共享依赖 external）+ `build-modules.ts` 之后运行：
 *   1. 从 shell 构建产物解析 importmap（真源，含不动点补全的全部深路径）；
 *   2. 值前缀按部署 base 改写（base 从主应用产物自身反推，零配置漂移）；
 *   3. runtime 键改指主应用切出的 runtime entry chunk——App 链的 runtime 实例
 *      就是宿主正在用的一份（shell 的 runtime.js 无 App bootstrap，不能借用）；
 *   4. 拷贝 shell 共享资产 → build/assets/；
 *   5. 注入 importmap 至 build/index.html（须先于任何 module script）；
 *   6. 门禁：裸说明符未覆盖 / 动态 require 未垫 / runtime 导出面缺失即 fail。
 *
 * 前置：`pnpm --filter @react-antd-module/cli build:shell` 至少跑过一次（共享资产
 * 确定性产物，无需每次重建）。
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { collectDynamicRequires, collectUnresolvedSpecifiers } from "../packages/cli/src/esm-exports";

const root = resolve(import.meta.dirname, "..");
const shellDist = resolve(root, "packages/cli/shell-dist");
const buildDir = resolve(root, "build");
const buildAssets = resolve(buildDir, "assets");

/** runtime entry chunk 必须保留的单例关键导出（冻结契约见 tests/runtime-exports.test.ts） */
const RUNTIME_CRITICAL_EXPORTS = new Set(["loadAll", "getRoutes"]);

/** 从 html 提取 <script type="importmap"> 的 imports；缺失即抛错 */
export function extractImportmap(html: string): Record<string, string> {
	const match = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
	if (!match)
		throw new Error("index.html 中未找到 importmap——请先构建宿主：pnpm --filter @react-antd-module/cli build:shell");
	return JSON.parse(match[1]).imports;
}

/** importmap 值前缀改写："/assets/x" → "<base>assets/x"；根部署（"/"）原样 */
export function rewriteImportmapBase(map: Record<string, string>, base: string): Record<string, string> {
	if (base === "/")
		return map;
	const rewritten: Record<string, string> = {};
	for (const [spec, value] of Object.entries(map))
		rewritten[spec] = value.replace(/^\/assets\//, `${base}assets/`);
	return rewritten;
}

/** 提取产物 export 段的全部导出名（minify 后的 `as 别名` 与裸标识符） */
export function parseExportNames(src: string): Set<string> {
	const names = new Set<string>();
	const re = /export\{([^}]*)\}/g;
	for (const seg of src.matchAll(re)) {
		for (const item of seg[1].split(",")) {
			const as = item.trim().match(/as\s+([A-Za-z_$][\w$]*)$/);
			const name = as?.[1] ?? item.trim();
			if (name)
				names.add(name);
		}
	}
	return names;
}

/** 在 build/assets 中找 runtime entry chunk：runtime-*.js 且导出面含关键单例项 */
export function findRuntimeChunk(assetsDir: string): string | null {
	if (!existsSync(assetsDir))
		return null;
	for (const file of readdirSync(assetsDir)) {
		if (!file.startsWith("runtime-") || !file.endsWith(".js"))
			continue;
		const exports = parseExportNames(readFileSync(resolve(assetsDir, file), "utf-8"));
		if ([...RUNTIME_CRITICAL_EXPORTS].every(name => exports.has(name)))
			return file;
	}
	return null;
}

/** 从主应用产物反推部署 base（如 "/react-antd-admin/"） */
function detectBase(html: string): string {
	const match = html.match(/src="(\/[^"]*?assets\/)index-[^/"]+\.js"/);
	if (!match)
		throw new Error("无法从 build/index.html 反推部署 base——主应用构建产物异常");
	return match[1].replace(/assets\/$/, "");
}

function main() {
	if (!existsSync(resolve(shellDist, "index.html")) || !existsSync(resolve(shellDist, "assets")))
		throw new Error(`缺少宿主共享资产（${shellDist}）——请先执行：pnpm --filter @react-antd-module/cli build:shell`);
	if (!existsSync(resolve(buildDir, "index.html")))
		throw new Error(`缺少主应用构建产物（${buildDir}）——请先执行 pnpm build:framework`);

	// runtime entry chunk 必须先找到：缺了说明导出面被 tree-shake 砍坏（R1 防线）
	const runtimeChunk = findRuntimeChunk(buildAssets);
	if (!runtimeChunk) {
		throw new Error(
			"未找到具备完整导出面的 runtime entry chunk（runtime-*.js 缺 loadAll/getRoutes 导出）——"
			+ "检查 vite.config.ts 的 input.runtime 与 preserveEntrySignatures 配置",
		);
	}

	const base = detectBase(readFileSync(resolve(buildDir, "index.html"), "utf-8"));
	const map = rewriteImportmapBase(
		extractImportmap(readFileSync(resolve(shellDist, "index.html"), "utf-8")),
		base,
	);
	// 模块 import "@react-antd-module/runtime" 命中宿主同源实例（单例，D5/D12）
	map["@react-antd-module/runtime"] = `${base}assets/${runtimeChunk}`;

	// 拷贝 shell 共享资产（js + sourcemap）
	for (const file of readdirSync(resolve(shellDist, "assets"))) {
		if (file.endsWith(".js") || file.endsWith(".map"))
			copyFileSync(resolve(shellDist, "assets", file), resolve(buildAssets, file));
	}

	// 注入 importmap：<head> 开头，先于任何 module script（幂等：先剥旧注入行）
	const html = readFileSync(resolve(buildDir, "index.html"), "utf-8")
		.replace(/<script type="importmap">[\s\S]*?<\/script>\n\s*/g, "");
	const injected = html.replace(
		"<head>",
		`<head>\n    <script type="importmap">${JSON.stringify({ imports: map })}</script>`,
	);
	if (injected === html)
		throw new Error("importmap 注入失败：build/index.html 中未找到 <head>");
	writeFileSync(resolve(buildDir, "index.html"), injected);

	// 门禁 1：产物裸说明符必须被 importmap 全覆盖（浏览器否则 Failed to resolve）
	const unresolved = collectUnresolvedSpecifiers(buildDir);
	if (unresolved.length) {
		throw new Error(
			`存在 importmap 未覆盖的裸说明符（${unresolved.length} 处）——浏览器会抛 "Failed to resolve module specifier"：\n${
				unresolved.map(g => `  · ${g.file} → "${g.specifier}"`).join("\n")
			}\n修复：在 packages/cli/src/shared-deps.ts 登记，或确认 shell 资产已包含该深路径。`,
		);
	}

	// 门禁 2：拷入的 shell 资产自身不得有未垫片的动态 require（A23 复查）
	const requireHits = collectDynamicRequires(buildDir);
	if (requireHits.length) {
		throw new Error(
			`存在未被垫片覆盖的动态 require（${requireHits.length} 处）：\n${
				requireHits.map(h => `  · ${h.file} → "${h.specifier}"`).join("\n")
			}`,
		);
	}

	console.log([
		`[inject-importmap] ✓ importmap 已注入（${Object.keys(map).length} 键，`,
		`base=${base}，runtime → ${runtimeChunk}）`,
	].join(""));
}

try {
	main();
}
catch (error) {
	console.error(`[inject-importmap] ${(error as Error).message}`);
	process.exit(1);
}
