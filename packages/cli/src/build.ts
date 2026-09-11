import type { Plugin as EsbuildPlugin } from "esbuild";
import type { Plugin } from "vite";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";
import { build } from "vite";
import { loadModulesConfig, resolveModuleEntry } from "./config";
import { resolveLayout } from "./layout";
import { isSharedDep, SHARED_DEPS } from "./shared-deps";
import { checkSharedVersions, resolveShellDist } from "./versions";

/**
 * `@oj-module/runtime` 的只读占位源码（设计文档 B10 / §4.3）。
 *
 * 读取模块定义时只需要 entry 顶层调用 `defineModule({ name, version, ... })` 的
 * 结果，而绝不需要真正加载框架运行时（其产物含 Vite 专有的 `?react`/`?url` svg
 * 导入，Node 下无法加载）。通过 esbuild 虚拟模块插件内联进 bundle，从源头避开 svg
 * 问题；其余共享依赖保持 external，由 tsx/Node 在 import() 时按真实包加载。
 *
 * 这里列出运行时的「值导出」，使 esbuild 不会报 missing export（类型导出无需提供）。
 * `defineModule` 仅把入参原样回传，CLI 即可读取 name/version 等元数据。
 */
const RUNTIME_STUB_SOURCE = `
const _fn = (...a) => a[a.length - 1];
const _obj = () => ({});
// 组件
export const BasicContent = _fn;
export const BasicButton = _fn;
export const BasicTable = _fn;
export const Iframe = _fn;
export const AccessControl = _fn;
export const FormAvatarItem = _fn;
export const FormTreeItem = _fn;
// api
export const fetchPie = _fn;
export const fetchLine = _fn;
export const fetchLogin = _fn;
export const fetchLogout = _fn;
export const fetchAsyncRoutes = _fn;
export const fetchUserInfo = _fn;
export const fetchRefreshToken = _fn;
export const fetchRoleList = _fn;
export const fetchAddRoleItem = _fn;
export const fetchUpdateRoleItem = _fn;
export const fetchDeleteRoleItem = _fn;
export const fetchRoleMenu = _fn;
export const fetchMenuByRoleId = _fn;
export const fetchMenuList = _fn;
export const fetchAddMenuItem = _fn;
export const fetchUpdateMenuItem = _fn;
export const fetchDeleteMenuItem = _fn;
// hooks 与权限常量
export const useAccess = _fn;
export const usePreferences = _fn;
// i18n 初始化（宿主链路消费）
export const setupI18n = _fn;
// 全局副作用（宿主链路消费）
export const LayoutEffects = _fn;
export const accessControlCodes = _obj;
export const AccessControlRoles = _obj;
export const permissionPrefix = "permission:button";
// store
export const useAuthStore = _fn;
export const useUserStore = _fn;
// 图标
export const menuIcons = _obj;
export const EmbeddedIcon = _fn;
export const ExternalIcon = _fn;
export const LayoutCenterIcon = _fn;
export const LayoutLeftIcon = _fn;
export const LayoutRightIcon = _fn;
export const MixedNavigationIcon = _fn;
export const OutsidePageIcon = _fn;
export const ProfileCardIcon = _fn;
export const ServerErrorIcon = _fn;
export const SideNavigationIcon = _fn;
export const TopNavigationIcon = _fn;
export const TwoColumnNavigationIcon = _fn;
export const RiAccountCircleLine = _fn;
export const RiContrastFill = _fn;
export const RiFullscreenExitLine = _fn;
export const RiFullscreenLine = _fn;
export const RiMailCheckLine = _fn;
export const RiMoonIcon = _fn;
export const RiReactjsLine = _fn;
export const RiSunIcon = _fn;
export const RiUserSettingsLine = _fn;
// 工具与常量
export const handleTree = _fn;
export const traverseTreeValues = _fn;
export const filterTree = _fn;
export const mapTree = _fn;
export const getAllExpandedKeys = _fn;
export const getAppInfo = _fn;
export const getRedirectPath = _fn;
export const getYesNoOptions = _fn;
export const getBooleanOptions = _fn;
// 模块契约
export const defineModule = (d) => d;
export const defineRoutes = (...a) => a[a.length - 1];
export const defineGuard = (...a) => a[a.length - 1];
export const getModules = () => [];
export const getModule = () => undefined;
export const getRoutes = () => [];
export const getRegisteredStore = () => undefined;
export const getRegisteredApiPrefix = () => undefined;
export const loadAll = async () => [];
export const unloadModule = async () => {};
export const useSlotNodes = () => [];
// AC-D15：zod re-export——stub 用可调用代理（契约 schema 不在元数据读取期求值，仅占位防 missing export）
export const z = new Proxy({}, { get: () => _fn });
`;

/**
 * esbuild 插件：把 `@oj-module/runtime` 解析到一个内联的只读占位虚拟模块，
 * 避免真正加载框架运行时（含 svg）。用虚拟模块而非 alias 指向实体文件，是因为
 * 实体路径依赖 import.meta.url，在 vitest 等变换环境下拿不到合法的 file URL。
 */
const runtimeStubPlugin: EsbuildPlugin = {
	name: "ram-runtime-stub",
	setup(b) {
		b.onResolve({ filter: /^@oj-module\/runtime$/ }, () => ({
			path: "@oj-module/runtime",
			namespace: "ram-runtime-stub",
		}));
		b.onLoad({ filter: /.*/, namespace: "ram-runtime-stub" }, () => ({
			contents: RUNTIME_STUB_SOURCE,
			loader: "js",
			resolveDir: process.cwd(),
		}));
	},
};

/**
 * 把 entry 内所有动态 import 的目标（lazy 页面、i18n JSON）替换为虚拟空模块：
 * 元数据读取只需要 defineModule 的入参对象，动态模块永远不该执行。
 * 若放任这些模块进 bundle，esbuild 输出 ESM 时会把页面模块的裸导入 hoist 到
 * bundle 顶层（如 pro-components），Node import() 时即被求值并可能加载失败；
 * 若标为 external，vitest 等变换环境又会在 transform 阶段强行解析相对说明符。
 * 空模块两条路都堵死（P3.4）。
 */
const dynamicImportStubPlugin: EsbuildPlugin = {
	name: "ram-dynamic-import-stub",
	setup(b) {
		// esbuild 的 onResolve 不支持按 kind 过滤，在回调里判断后放行其余 resolver
		b.onResolve({ filter: /^\./ }, (args) => {
			if (args.kind === "dynamic-import") {
				return { path: args.path, namespace: "ram-dynamic-stub" };
			}
			return null;
		});
		b.onLoad({ filter: /.*/, namespace: "ram-dynamic-stub" }, () => ({
			contents: "export default {};",
			loader: "js",
		}));
	},
};

/**
 * 元数据读取封闭性（P3 验收发现）：裸导入全部桩化，`ram init` 产出的外部工程
 * 尚未安装依赖（@oj-module/* 未发布），真实 import() 会
 * ERR_MODULE_NOT_FOUND；读元数据只需要 defineModule 入参，共享依赖执行与否无关。
 *
 * - 值统一为「自引用可调用代理」：任意属性链访问/调用都安全（JSX 元素在
 *   模块顶层求值等形态）。
 * - 从 modulesSrc 源码扫出的具名导入经 ownKeys/getOwnPropertyDescriptor 陷阱
 *   静态暴露——esbuild 对 CJS 桩做 __toESM 属性拷贝（走这两把陷阱），仅 get
 *   陷阱拷不出名字，顶层 `React.createElement` 会直接崩（验收实测）。
 * - `#` 开头的工程子路径导入不桩化，走默认解析。
 */
/**
 * 扫描 modulesSrc 下全部源码，收集「裸说明符 → 具名导入列表」。
 * 只为给桩模块提供可静态暴露的名字（供 esbuild __toESM 拷贝），不求精确：
 * 解析不到的形状（多行、注释包裹等）只会让该名字未被种子，运行时落到 get
 * 陷阱兜底；扫到未使用的名字也无害。
 */
function collectBareImportedNames(...roots: string[]): Map<string, string[]> {
	const found = new Map<string, Set<string>>();
	const record = (spec: string, clause: string) => {
		if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#"))
			return;
		const set = found.get(spec) ?? new Set<string>();
		for (const raw of clause.split(",")) {
			const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
			if (name && /^[\w$]+$/.test(name))
				set.add(name);
		}
		set.add("default");
		found.set(spec, set);
	};
	const walk = (dir: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		}
		catch {
			return;
		}
		for (const entry of entries) {
			const filePath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(filePath);
				continue;
			}
			if (!/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name))
				continue;
			const source = fs.readFileSync(filePath, "utf-8");
			for (const m of source.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s*)?["']([^"']+)["']/g))
				record(m[2], m[1]);
			for (const m of source.matchAll(/import\s+(\w+)\s*(?:,\s*\{([^}]*)\}\s*)?from\s*["']([^"']+)["']/g)) {
				if (m[1] && m[3])
					record(m[3], m[1]);
				if (m[2] && m[3])
					record(m[3], m[2]);
			}
			// namespace / default 导入的属性访问（`React.lazy` / `ns.foo()`）：
			// 名字从成员访问推断，否则 __toESM 拷贝后这些名字不存在（playground 实测）
			const bindings = new Map<string, string>();
			for (const m of source.matchAll(/import\s+(?:\*\s+as\s+)?(\w+)\s+from\s*["']([^"']+)["']/g)) {
				if (m[1] && m[2] && !m[2].startsWith(".") && !m[2].startsWith("#"))
					bindings.set(m[1], m[2]);
			}
			for (const [binding, spec] of bindings) {
				for (const m of source.matchAll(new RegExp(`\\b${binding}\\.(\\w+)`, "g"))) {
					const set = found.get(spec) ?? new Set<string>();
					set.add(m[1]);
					found.set(spec, set);
				}
			}
		}
	};
	for (const root of roots)
		walk(root);
	return new Map([...found].map(([spec, set]) => [spec, [...set]]));
}

/** 每次元数据读取一个实例：modulesSrc 扫描出的「裸说明符 → 具名导入列表」 */
function makeBareImportStubPlugin(namesBySpec: Map<string, string[]>): EsbuildPlugin {
	return {
		name: "ram-bare-import-stub",
		setup(b) {
			b.onResolve({ filter: /^[^./#]/ }, args => ({ path: args.path, namespace: "ram-bare-stub" }));
			b.onLoad({ filter: /.*/, namespace: "ram-bare-stub" }, (args) => {
				const names = namesBySpec.get(args.path) ?? [];
				return {
					contents: [
						"const value = new Proxy(function () {}, { get: () => value, apply: () => undefined });",
						`const names = ${JSON.stringify(names)};`,
						"module.exports = new Proxy({}, {",
						"\tget: () => value,",
						"\tgetOwnPropertyDescriptor: (_t, p) => names.includes(p) ? { enumerable: true, configurable: true, get: () => value } : undefined,",
						"\townKeys: () => names,",
						"});",
					].join("\n"),
					loader: "js",
				};
			});
		},
	};
}

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
}

const ALGORITHM = "sha384";

function sha384(file: string): string {
	const digest = crypto.createHash(ALGORITHM).update(fs.readFileSync(file)).digest("base64");
	return `${ALGORITHM}-${digest}`;
}

/**
 * 用 esbuild 把 entry 打包成单文件（含 runtime 占位 stub 与动态 import 空 stub），
 * 写出到工程内临时目录后以普通 `import()` 加载，从而读取模块定义
 * （name/version/peerRuntime/config）而无需真正加载整个框架运行时
 * （其源码含 Vite 专有的 `?react`/`?url` svg 导入），替代脆弱的正则（B10）。
 *
 * P3.4 起同时供主仓库 `scripts/build-modules.ts` 复用（经 exports `./build`）。
 */
export async function readModuleDefinition(entryFile: string, projectRoot: string) {
	// 必须落在工程目录内（而非 os.tmpdir），否则 bundle 外部化的共享依赖
	// （react / antd …）在 import() 时无法从 /tmp 解析到 node_modules。
	const outDir = fs.mkdtempSync(path.join(projectRoot, ".ram-tmp-"));
	try {
		// entry 可能登记在 modulesSrc 之外（playground 登记仓库级模块），
		// entry 所在目录同样入扫，保证其相对导入图的具名导入都被种子
		const bareNames = collectBareImportedNames(resolveLayout(projectRoot).modulesSrc, path.dirname(entryFile));
		await esbuild({
			entryPoints: [entryFile],
			// 固定输出名 entry.js：esbuild 默认取 entry 文件 basename，
			// 会让非 entry.ts 文件名（如测试夹具）的产物对不上后续 import 路径
			entryNames: "entry",
			bundle: true,
			format: "esm",
			platform: "node",
			packages: "external",
			plugins: [runtimeStubPlugin, dynamicImportStubPlugin, makeBareImportStubPlugin(bareNames)],
			outdir: outDir,
			jsx: "automatic",
			loader: { ".ts": "ts", ".tsx": "tsx", ".json": "json" },
			logLevel: "silent",
		});
		const bundled = path.join(outDir, "entry.js");
		const mod = await import(pathToFileURL(bundled).href);
		const definition = mod.default;
		if (!definition?.name || !definition?.version) {
			throw new Error(`${entryFile} 的 default 导出缺少 name 或 version`);
		}
		return definition as {
			name: string
			version: string
			peerRuntime?: string
			config?: { dependencies?: string[] }
		};
	}
	finally {
		fs.rmSync(outDir, { recursive: true, force: true });
	}
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
			`[ram] ⚠️ 以下运行时依赖不在共享表内，会被打进模块产物：${unshared.join(", ")}\n`
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
			`[ram] 模块 "${moduleName}" 的产物含 importmap 无法解析的深路径说明符：\n`
			+ `${deepPathErrors.join("\n")}\n`
			+ "共享表只提供精确键（importmap 无前缀通配）。修复建议：改从包根导入"
			+ "（如 dayjs 插件改在宿主侧注册），或联系框架方在 SHARED_DEPS 增补该深路径条目。",
		);
	}

	if (unsharedWarnings.size > 0) {
		console.warn(
			`[ram] ⚠️ 模块 "${moduleName}" import 了共享表外的三方库：${[...unsharedWarnings].join(", ")}\n`
			+ "     它们会被打进模块产物。若应与宿主共用，请加入 SHARED_DEPS（设计文档 C8）",
		);
	}
}

/**
 * 构建后端（api/src 存在时编排 `bin/oj build`，D8）。
 *
 * 绝不在此处跑 migrate：oj build 本身零磁盘副作用，`ram build` 保持零 DB
 * 副作用（CI/无 DB 环境可跑）；迁移由 preview 在起服务前应用（设计 §6）。
 * 无后端源码返回 false（纯前端工程跳过）。
 */
export async function buildBackend(projectRoot: string): Promise<boolean> {
	const apiSrc = path.join(projectRoot, "api/src");
	if (!fs.existsSync(apiSrc))
		return false;

	const oj = path.join(projectRoot, "bin/oj");
	if (!fs.existsSync(oj)) {
		throw new Error(
			`[ram] 找到 api/src 但缺少 ${oj}。\n`
			+ "请重跑 ram init 幂等补缺（不会覆盖 config 与用户代码）。",
		);
	}
	const apiDist = path.join(projectRoot, "api/dist");
	console.log("[ram] oj build（后端）…");
	execFileSync(oj, ["build", "-d", apiSrc, "-o", apiDist], { stdio: "inherit" });
	return true;
}

/**
 * 全站合并（仅 `ram build` 调用，设计 §5）：清场后拷 shell dist 全量，
 * 再由模块构建写入 modules.json 与 modules/。清场防旧哈希资产无限累积
 * （shell 每次重构建生成新哈希文件名）；devServer 热重建路径不合并——
 * dev 的 / 与 /assets/* 直接服务 shell dist，合并产物无人消费。
 */
function mergeShellSite(distDir: string): void {
	const shellDist = resolveShellDist();
	fs.rmSync(distDir, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(distDir), { recursive: true });
	fs.cpSync(shellDist, distDir, { recursive: true });
	console.log(`[ram] 已合并宿主站点 → ${distDir}`);
}

/**
 * 构建模块工程。
 *
 * 产出（目录随布局：新布局 modules/dist，旧布局 dist/）：
 *   <dist>/modules/<name>/<version>/{entry.js, chunk-*.js, *.css}
 *   <dist>/modules.json
 *
 * opts.mergeSite 仅 `ram build` 传 true：清场 + 拷 shell dist 全量；
 * devServer 热重建默认 false，只写模块产物。
 */
export async function buildModules(
	projectRoot: string,
	opts: { mergeSite?: boolean } = {},
): Promise<BuiltModule[]> {
	const config = await loadModulesConfig(projectRoot);
	const layout = resolveLayout(projectRoot);
	const outDir = layout.distDir;
	const baseUrl = config.baseUrl ?? "";

	if (opts.mergeSite)
		mergeShellSite(outDir);

	// P4.5 / C4 / D12：构建前先过版本矩阵门禁，版本漂移直接拒绝
	checkSharedVersions(projectRoot, resolveShellDist());

	warnUnsharedDeps(projectRoot);

	const built: BuiltModule[] = [];

	for (const item of config.modules) {
		if (item.enabled === false) {
			console.log(`[ram] 跳过已禁用模块 ${item.name}`);
			continue;
		}

		const entryFile = resolveModuleEntry(projectRoot, item.entry);
		const definition = await readModuleDefinition(entryFile, projectRoot);

		if (definition.name !== item.name) {
			throw new Error(
				`模块名不一致：modules.config.ts 中为 "${item.name}"，entry.ts 中为 "${definition.name}"`,
			);
		}

		const moduleOutDir = path.join(outDir, "modules", definition.name, definition.version);
		const emitted = new Map<string, { fileName: string, type: "chunk" | "asset", isEntry: boolean, isDynamicEntry: boolean }>();

		const collectChunks: Plugin = {
			name: "ram:collect-chunks",
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

		console.log(`[ram] 构建 ${definition.name}@${definition.version} ...`);

		await build({
			root: projectRoot,
			logLevel: "warn",
			plugins: [collectChunks],
			// Spike A 坑 2：lib 模式不替换 process.env.NODE_ENV，
			// 浏览器顶层求值会抛 process is not defined（风险 R15）
			define: { "process.env.NODE_ENV": JSON.stringify("production") },
			build: {
				outDir: moduleOutDir,
				emptyOutDir: true,
				sourcemap: false,
				minify: false,
				lib: {
					entry: entryFile,
					formats: ["es"],
					fileName: () => "entry.js",
				},
				rolldownOptions: {
					// 只把共享依赖留给宿主 importmap；
					// 相对路径 / 绝对路径是模块自身代码，需要打包
					external: (id: string) => !id.startsWith(".") && !path.isAbsolute(id) && isSharedDep(id),
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
				`[ram] 模块 "${definition.name}" 含 ${lazyChunks.length} 个 lazy chunk，`
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
		});
	}

	const manifestPath = path.join(outDir, "modules.json");
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(manifestPath, `${JSON.stringify(built, null, 2)}\n`);
	console.log(`[ram] 清单已生成 → ${manifestPath}`);

	return built;
}
