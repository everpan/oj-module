// 前端模块构建（SRP 拆分自 build.ts，2026-11-03，计划 docs/plans/20261103-0930）：
// 逐模块 vite/rolldown 构建 → 产物完整性（sha384 chunks、importmap 说明符校验、
// CJS require 门禁）→ modules.json 清单。元数据读取见 module-def.ts，
// 后端编排见 backend.ts。
import type { Plugin } from "vite";
import type { ProjectLayout } from "../layout";
import type { RouteDefinitionLike } from "../manifest-routes-derive";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { parse as parseYaml } from "yaml";
import { assertModuleList, loadSiteConfig, mergeModuleList, resolveModuleEntry } from "../config";
import { moduleDir, resolveLayout, scanModules } from "../layout";
import { isPrebuiltDep, isSharedDep, SHARED_DEPS } from "../shared-deps";
import { checkSharedVersions, resolveShellDist } from "../versions";
import { mergeInstalledModules, restoreInstalledFaces } from "./installed-merge";
import { readModuleDefinition } from "./module-def";
import { mergeShellSite } from "./site-merge";

/** modules.json 中的 chunk 条目 */
export interface ChunkEntry {
	url: string
	integrity: string
	/** 懒加载 chunk：L2 完整性档位下不受保护（设计文档 §4.7） */
	lazy: boolean
}

/** modules.json 中的模块条目 */
export interface BuiltModule {
	name: string
	version: string
	enabled: boolean
	dependencies: string[]
	peerRuntime?: string
	entry: string
	integrity: string
	css: string[]
	chunks: ChunkEntry[]
	/**
	 * 生效的 web 路由前缀段（契约 C2-14：`web.route_prefix` 缺省 `/<name>`）。
	 * 运行期据其改写模块路由根（单根约定下仅根段），缺省 = name 保证零漂移。
	 */
	routePrefix: string
}

/**
 * 解析模块生效的 web 路由前缀段（R1.1）。
 * module-root：读 `src/<name>/solution.yaml` 的 `web.route_prefix`（契约 C2-14，缺省 `/<name>`）；
 * 未配置/非法/非 module-root → 缺省 `name`，与现有路由根（顶层段即 name）逐字节一致。
 */
function resolveRoutePrefix(layout: ProjectLayout, name: string): string {
	if (layout.kind !== "module-root")
		return name;
	const solPath = path.join(moduleDir(layout, name), "solution.yaml");
	if (!fs.existsSync(solPath))
		return name;
	try {
		const doc = parseYaml(fs.readFileSync(solPath, "utf-8")) as Record<string, unknown>;
		const web = doc.web;
		if (web && typeof web === "object" && !Array.isArray(web)) {
			const rp = (web as Record<string, unknown>).route_prefix;
			if (typeof rp === "string" && /^\/[a-z][a-z0-9-]{0,63}$/.test(rp))
				return rp.slice(1);
		}
	}
	catch {
		// YAML 解析失败 → 缺省，不阻断构建（契约校验会在别处暴露）
	}
	return name;
}

const ALGORITHM = "sha384";

function sha384(file: string): string {
	const digest = crypto.createHash(ALGORITHM).update(fs.readFileSync(file)).digest("base64");
	return `${ALGORITHM}-${digest}`;
}

function warnUnsharedDeps(projectRoot: string) {
	const pkgPath = path.join(projectRoot, "package.json");
	if (!fs.existsSync(pkgPath))
		return;

	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
	const deps = Object.keys(pkg.dependencies ?? {});
	const unshared = deps.filter(dep => !isSharedDep(dep) && !dep.startsWith("@oj-module/"));

	if (unshared.length) {
		console.warn(
			`[ojm] ⚠️ 以下运行时依赖不在共享表内，会被打进模块产物：${unshared.join(", ")}\n`
			+ "     若它应与宿主共用，请加入 SHARED_DEPS 并在宿主 importmap 中映射（设计文档 C8）",
		);
	}
}

/** 提取产物文件中的全部裸说明符（排除相对/绝对/# 路径） */
function collectBareSpecifiers(file: string): string[] {
	const source = fs.readFileSync(file, "utf-8");
	const found = new Set<string>();
	const patterns = [
		/(?:import|export)\s[^'";]*?from\s*["']([^"']+)["']/g, // import/export ... from "x"
		/import\s*["']([^"']+)["']/g, // 副作用导入 import "x"
		/import\(\s*["']([^"']+)["']\s*\)/g, // 动态 import("x")
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			const spec = match[1]!;
			if (!spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("#"))
				found.add(spec);
		}
	}
	return [...found];
}

/**
 * P7.9 / B11 + C8：构建期扫描模块产物的裸说明符。
 * - 深路径命中共享表前缀但非精确 importmap 键（如 dayjs/plugin/utc）：
 *   构建期直接报错——importmap 无前缀通配，浏览器必抛
 *   "Failed to resolve module specifier"，不能拖到运行期（§4.7 错误契约）。
 * - 表外说明符：C8 构建期告警（按真实 import 分析，不依赖 package.json 字段）。
 */
function assertResolvableSpecifiers(
	moduleName: string,
	moduleOutDir: string,
	emitted: Map<string, { type: string, fileName: string }>,
): void {
	const exactKeys = new Set(SHARED_DEPS.map(dep => dep.specifier));
	const deepPathErrors: string[] = [];
	const unsharedWarnings = new Set<string>();

	for (const info of emitted.values()) {
		if (info.type !== "chunk")
			continue;
		for (const spec of collectBareSpecifiers(path.join(moduleOutDir, info.fileName))) {
			if (exactKeys.has(spec))
				continue;
			if (isSharedDep(spec)) {
				deepPathErrors.push(`  · ${info.fileName} → "${spec}"`);
			}
			else {
				unsharedWarnings.add(spec);
			}
		}
	}

	if (deepPathErrors.length > 0) {
		throw new Error(
			`[ojm] 模块 "${moduleName}" 的产物含 importmap 无法解析的深路径说明符：\n`
			+ `${deepPathErrors.join("\n")}\n`
			+ "共享表只提供精确键（importmap 无前缀通配）。修复建议：改从包根导入"
			+ "（如 dayjs 插件改在宿主侧注册），或联系框架方在 SHARED_DEPS 增补该深路径条目。",
		);
	}

	if (unsharedWarnings.size > 0) {
		console.warn(
			`[ojm] ⚠️ 模块 "${moduleName}" import 了共享表外的三方库：${[...unsharedWarnings].join(", ")}\n`
			+ "     它们会被打进模块产物。若应与宿主共用，请加入 SHARED_DEPS（设计文档 C8）",
		);
	}
}

/**
 * 构建模块工程。
 *
 * 产出（layout.distDir：module-root / new → dist/web；flat → build）：
 *   <dist>/modules/<name>/<version>/{entry.js, chunk-*.js, *.css}
 *   <dist>/modules.json
 *
 * opts.mergeSite 仅 `ojm build` 传 true：清场 + 拷 shell dist 全量；
 * devServer 热重建默认 false，只写模块产物。
 */
/**
 * 菜单路由布局守卫（纯函数，返回警告文案数组）：带菜单元数据（title + order≥0 主菜单区）的
 * 路由若未声明 layout 或为 "none"，浏览器端将裸 Outlet 全屏渲染——菜单点进去没有侧边栏/顶栏。
 * 方案页要框架外壳应显式 `layout: "container"`（内建模块与 ojm new 骨架的统一约定）；
 * order<0（底部固定区，如 login 全屏）与无 title（不进菜单）的路由不告警。
 */
export function menuLayoutWarnings(routes: RouteDefinitionLike[], moduleName: string): string[] {
	const warns: string[] = [];
	const walk = (list: RouteDefinitionLike[]) => {
		for (const r of list) {
			const h = r.handle;
			const isMenu = typeof h?.title === "string" && typeof h.order === "number" && h.order >= 0;
			const noChrome = h?.layout == null || h.layout === "none";
			if (isMenu && noChrome) {
				warns.push(
					`[ojm] 模块 ${moduleName} 的菜单路由 ${r.path ?? "(index)"} 未声明 layout（或为 "none"）：`
					+ "菜单进入将全屏、不套框架外壳。方案页需要侧边栏/顶栏时请设 handle.layout = \"container\"。",
				);
			}
			if (r.children?.length)
				walk(r.children);
		}
	};
	walk(routes);
	return warns;
}

export async function buildModules(
	projectRoot: string,
	opts: { mergeSite?: boolean } = {},
): Promise<BuiltModule[]> {
	const layout = resolveLayout(projectRoot);
	const config = await loadSiteConfig(projectRoot);
	// module-root：模块清单由 src/*/web/entry.ts 扫描得出（web.config.ts 仅可选覆盖）；
	// 历史布局：仍以 web.config.ts 的 modules 为唯一真源。
	const modules = layout.kind === "module-root"
		? mergeModuleList(scanModules(layout), config.modules, projectRoot)
		: assertModuleList(projectRoot, config.modules);
	const outDir = layout.distDir;
	const baseUrl = config.baseUrl ?? "";

	if (opts.mergeSite)
		mergeShellSite(outDir, config.siteBase ?? "", config.apiBase ?? "");

	// P4.5 / C4 / D12：构建前先过版本矩阵门禁，版本漂移直接拒绝
	checkSharedVersions(projectRoot, resolveShellDist());

	warnUnsharedDeps(projectRoot);

	const built: BuiltModule[] = [];

	for (const item of modules) {
		if (item.enabled === false) {
			console.log(`[ojm] 跳过已禁用模块 ${item.name}`);
			continue;
		}

		const entryFile = resolveModuleEntry(projectRoot, item.entry);
		const definition = await readModuleDefinition(entryFile, projectRoot);

		if (definition.name !== item.name) {
			throw new Error(
				`模块名不一致：${layout.kind === "module-root" ? `src/${item.name}` : "web.config.ts"} 中为 "${item.name}"，entry.ts 中为 "${definition.name}"`,
			);
		}

		for (const w of menuLayoutWarnings(definition.routes ?? [], definition.name))
			console.warn(w);

		const moduleOutDir = path.join(outDir, "modules", definition.name, definition.version);
		const emitted = new Map<string, { fileName: string, type: "chunk" | "asset", isEntry: boolean, isDynamicEntry: boolean }>();

		const collectChunks: Plugin = {
			name: "ojm:collect-chunks",
			writeBundle(_options, bundle) {
				for (const [fileName, output] of Object.entries(bundle)) {
					emitted.set(fileName, {
						fileName,
						type: output.type,
						isEntry: output.type === "chunk" && output.isEntry,
						isDynamicEntry: output.type === "chunk" && output.isDynamicEntry,
					});
				}
			},
		};

		console.log(`[ojm] 构建 ${definition.name}@${definition.version} ...`);

		await build({
			root: projectRoot,
			logLevel: "warn",
			// §4.1-④：tailwind 模块管线——模块内 import 的 css 经 @tailwindcss/vite
			// 编译，产物由宿主 <link> 注入（R16）；模块无 css 入口时插件不产生任何产物
			plugins: [collectChunks, tailwindcss()],
			// Spike A 坑 2：lib 模式不替换 process.env.NODE_ENV，
			// 浏览器顶层求值会抛 process is not defined（风险 R15）
			define: { "process.env.NODE_ENV": JSON.stringify("production") },
			build: {
				outDir: moduleOutDir,
				emptyOutDir: true,
				sourcemap: false,
				/**
				 * 模块产物压缩（2026-09-17 由 `false` 改为 `true`）。
				 *
				 * 本行原为 `false` **且无注释**（同文件其余设置都带 rationale）—— 经查出自
				 * 2026-08-31 的调试提交 `1bf3200`，疑似调试期临时值遗留。实测代价极大：
				 * 仅这一项就让 planning 的 gzip 从 186,730 → **75,872（−59.4%）**、
				 * workitems 88,351 → **40,113（−54.6%）**（同一份产物只做压缩，未改任何配置）。
				 * 背景：曾评估「把重复的生成 client 提成共享资产来省体积」，实测 gzip 净变化
				 * 仅 −364 B（生成 client 压缩率 6.8%，且重复内容已被同一 bundle 内的 gzip
				 * 滑窗吃掉）⇒ **真正的杠杆是压缩，不是去重**（见 oj-module 台账 T54）。
				 *
				 * ⚠️ **本项只作用于「模块产物」**，与宿主共享资产无关：`shell-dist/assets/*.js`
				 * 由 `shell/scripts/build.mts` 自己的 esbuild 构建，且 `esm-exports.ts` 的
				 * 导出面解析**依赖资产顶格输出**（其文件头写明「`minify: false` 下顶层语句
				 * 一律顶格输出」）⇒ **不要**顺手把共享资产也压了，那会让导入完整性门禁失效。
				 *
				 * 代价（已知并接受）：生产产物栈不可读（`sourcemap: false` 保持不变 —— 开
				 * sourcemap 会额外部署 .map 文件，属另一个决策）。
				 */
				minify: true,
				lib: {
					entry: entryFile,
					formats: ["es"],
					fileName: () => "entry.js",
				},
				rolldownOptions: {
					// 只把共享依赖留给宿主 importmap；
					// 相对路径 / 绝对路径是模块自身代码，需要打包
					external: (id: string) => !id.startsWith(".") && !path.isAbsolute(id) && isPrebuiltDep(id),
					output: {
						// P7.x / e2e：模块产物内联动态 import（lazy 页面、i18n 等），
						// 输出为**单文件**。原因：
						// 1. 拆出的 chunk 只能靠 import.meta.url 在「真实 HTTP 服务」下解析，
						//    任何非 HTTP 加载上下文（e2e harness、离线/原生壳、L2 完整性之外的
						//    加载路径）都会 ECONNREFUSED / 404，导致页面空白；
						// 2. 拆出的 lazy chunk 不受 L2 完整性保护（构建期已告警），是模块化
						//    方案的真实完整性缺陷；单文件后整包受 modulepreload+integrity 覆盖；
						// 3. 单文件模块是微前端模块的通用形态，宿主按真实 URL 一次性加载即可，
						//    无孤儿 chunk 依赖。
						codeSplitting: false as any,
					},
				},
			},
		});

		// 运行期 require 门禁：CJS 依赖 require 了 external 共享包时，rolldown 只留一个浏览器
		// 不可用的 require 桩（"Calling `require` for ..."），表现为模块加载即抛错、页面空白。
		// 这类依赖必须移出 bundle 走宿主 importmap（shell 侧有 CJS→ESM 垫片）。
		const builtEntry = path.join(moduleOutDir, "entry.js");
		if (fs.existsSync(builtEntry)) {
			const code = fs.readFileSync(builtEntry, "utf-8");
			if (code.includes("doesn't expose the `require` function")) {
				const specs = [...new Set([...code.matchAll(/ne\("([^"]+)"\)/g)].map(m => m[1]))];
				throw new Error(
					`[ojm] ${definition.name}@${definition.version} 产物含运行期 require(${specs.join(", ") || "?"})`
					+ "——浏览器没有 require，模块加载即抛错。"
					+ "根因：该 CJS 依赖被标为 bundle（自带副本），但它 require 的共享包被 external 了。"
					+ "修复：把它从 SHARED_DEPS 的 bundle 列表移回共享资产，或改用该依赖的 ESM 入口。",
				);
			}
		}

		const prefix = `${baseUrl}/modules/${definition.name}/${definition.version}/`;
		const chunks: ChunkEntry[] = [];
		const css: string[] = [];

		for (const info of emitted.values()) {
			if (info.type === "asset") {
				if (info.fileName.endsWith(".css"))
					css.push(`${prefix}${info.fileName}`);
				continue;
			}

			// P7.3：entry 也进 chunks（lazy:false）——宿主 L2 完整性按 chunks[]
			// 注入 modulepreload+integrity，此前 entry 被 isEntry 跳过导致
			// 顶层 integrity 成为死字段（评审 S3：入口恰好不受保护）
			chunks.push({
				url: `${prefix}${info.fileName}`,
				integrity: sha384(path.join(moduleOutDir, info.fileName)),
				lazy: info.isEntry ? false : info.isDynamicEntry,
			});
		}

		// §4.6：lazy chunk 不受 L2 完整性保护，构建期必须显式提示
		const lazyChunks = chunks.filter(c => c.lazy);
		if (lazyChunks.length > 0) {
			console.warn(
				`[ojm] 模块 "${definition.name}" 含 ${lazyChunks.length} 个 lazy chunk，`
				+ "它们在 L2 完整性档位下不受保护（§4.7 D7）：\n"
				+ `${lazyChunks.map(c => `  · ${c.url}`).join("\n")}\n`
				+ "若这些 chunk 也要求完整性，请升级到 L3（Service Worker）或使用逃生通道（§4.7）。",
			);
		}

		// P7.9 / B11：扫描产物中的裸说明符，构建期拦截 importmap 无法解析的
		// 深路径（如 dayjs/plugin/utc——isSharedDep 前缀命中但 importmap 只有
		// 精确键，浏览器必抛 Failed to resolve module specifier）；
		// 顺带以真实 import 分析落地 C8 表外依赖告警（不再只扫 package.json 字段）
		assertResolvableSpecifiers(definition.name, moduleOutDir, emitted);

		built.push({
			name: definition.name,
			version: definition.version,
			enabled: true,
			dependencies: definition.config?.dependencies ?? [],
			peerRuntime: definition.peerRuntime,
			entry: `${prefix}entry.js`,
			integrity: sha384(path.join(moduleOutDir, "entry.js")),
			css,
			chunks,
			routePrefix: resolveRoutePrefix(layout, definition.name),
		});
	}

	const manifestPath = path.join(outDir, "modules.json");
	// 支柱二 / U5 根治：release 擦除先重物化已装方案 web 面，清单写出前并入其登记——
	// 否则例行 dev/build 把已装方案冲掉（2026-11-07 实锤：市场菜单消失需手工愈合）。
	restoreInstalledFaces(projectRoot, outDir, layout.apiDist);
	const merged = mergeInstalledModules(projectRoot, outDir, built);
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);
	console.log(`[ojm] 清单已生成 → ${manifestPath}`);

	return built;
}
