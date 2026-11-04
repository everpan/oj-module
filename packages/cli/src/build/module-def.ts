// 模块元数据读取（SRP 拆分自 build.ts，2026-11-03，计划 docs/plans/20261103-0930）：
// 用 esbuild 把 entry 打包成单文件并 import()，读 defineModule 入参——
// 本文件只做这一件事，构建编排见 backend.ts / module-build.ts。
import type { Plugin as EsbuildPlugin } from "esbuild";
import type { RouteDefinitionLike } from "../manifest-routes-derive";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";
import { resolveLayout } from "../layout";

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
export const AntdApp = _fn;
// 页面级错误边界（增量⑥）：宿主壳与模块自绘子树包裹用
export const ErrorBoundary = _fn;
export const PageError = _fn;
// api
export const notify = _obj;
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
// RBAC（阶段 C 增补，与 runtime api/rbac 对齐）
export const fetchRbacRoleList = _fn;
export const fetchRbacPermissionList = _fn;
export const fetchRbacCreateRole = _fn;
export const fetchRbacUpdateBindings = _fn;
export const fetchRbacDeleteRole = _fn;
export const fetchRbacUserList = _fn;
export const fetchRbacCreateUser = _fn;
export const fetchRbacUpdateUserRoles = _fn;
export const fetchRbacAdminResetPassword = _fn;
export const fetchRbacSetForbidden = _fn;
export const fetchRbacOplog = _fn;
export const fetchRbacOplogPost = _fn;
export const fetchRbacSettings = _fn;
export const fetchRbacUpdateSetting = _fn;
export const fetchRbacContacts = _fn;
export const fetchRbacContactDetail = _fn;
export const fetchLoginMethods = _fn;
export const fetchChangePassword = _fn;
export const fetchLdapLogin = _fn;
// 方案路由归并（P1-14/R21 读端点 + 分组纯函数）
export const fetchSolutionRoutes = _fn;
export const roleLabel = _fn;
export const canEditRoleBindings = _fn;
export const canDeleteRole = _fn;
export const canAssignRole = _fn;
export const bindingDiff = _fn;
export const groupByModule = _fn;
export const groupSettingsByModule = _fn;
// hooks 与权限常量
export const useAccess = _fn;
export const usePreferences = _fn;
// i18n 初始化（宿主链路消费）
export const setupI18n = _fn;
export const ANT_DESIGN_LOCALE = _obj;
// 全局副作用（宿主链路消费）
export const LayoutEffects = _fn;
export const accessControlCodes = _obj;
export const AccessControlRoles = _obj;
export const permissionPrefix = "permission:button";
// store
export const useAccessStore = _fn;
export const useAuthStore = _fn;
// 方案路由归并 store（token 就绪自动重拉，R21）
export const useSolutionRoutes = _fn;
export const useUserStore = _fn;
export const useTabsStore = _fn;
// 租户上下文（L2）：请求头由运行时注入，模块只在登出清理 / URL 带 tenant 参数时读写
export const useTenantStore = _fn;
export const currentTenant = () => "default";
export const bootstrapTenant = () => "default";
export const DEFAULT_TENANT = "default";
export const TENANT_HEADER = "X-TENANT-ID";
export const TENANT_QUERY_PARAM = "tenant";
// 页签 key 唯一正确取口（keepAlive 下 useLocation 是激活页位置，0.1.21）
export const useTabKey = _fn;
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
// 站点部署 base（子路径部署）：stub 只需占位，元数据读取期不拼 URL
export const resolveSiteBase = _fn;
export const withSiteBase = _fn;
// API 端点 base（整页跳转的后端端点、上传 action 用它拼 URL，与站点 base 正交）
export const resolveApiBase = _fn;
export const getYesNoOptions = _fn;
export const getBooleanOptions = _fn;
// 模块契约
export const defineModule = (d) => d;
export const defineRoutes = (...a) => a[a.length - 1];
export const defineGuard = (...a) => a[a.length - 1];
export const getModules = () => [];
export const getModule = () => undefined;
export const getRoutes = () => [];
export const getHostRoutes = () => [];
// 模块生效 web 路由前缀段取值口（R1.3：写进 modules.json 的 routePrefix，未声明回落 name）
export const getModuleRoutePrefix = _fn;
export const getRegisteredStore = () => undefined;
export const getRegisteredApiPrefix = () => undefined;
export const loadAll = async () => [];
export const unloadModule = async () => {};
export const useSlotNodes = () => [];
// AC-D15：zod re-export——stub 用可调用代理（契约 schema 不在元数据读取期求值，仅占位防 missing export）
export const z = new Proxy({}, { get: () => _fn });
// R29：ky 实例 re-export（第一方市场编排面）——同 z，元数据读取期仅需可调用占位
export const request = new Proxy({}, { get: () => _fn });
`;

/**
 * esbuild 插件：把 `@oj-module/runtime` 解析到一个内联的只读占位虚拟模块，
 * 避免真正加载框架运行时（含 svg）。用虚拟模块而非 alias 指向实体文件，是因为
 * 实体路径依赖 import.meta.url，在 vitest 等变换环境下拿不到合法的 file URL。
 */
const runtimeStubPlugin: EsbuildPlugin = {
	name: "ojm-runtime-stub",
	setup(b) {
		b.onResolve({ filter: /^@oj-module\/runtime$/ }, () => ({
			path: "@oj-module/runtime",
			namespace: "ojm-runtime-stub",
		}));
		b.onLoad({ filter: /.*/, namespace: "ojm-runtime-stub" }, () => ({
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
	name: "ojm-dynamic-import-stub",
	setup(b) {
		// esbuild 的 onResolve 不支持按 kind 过滤，在回调里判断后放行其余 resolver
		b.onResolve({ filter: /^\./ }, (args) => {
			if (args.kind === "dynamic-import") {
				return { path: args.path, namespace: "ojm-dynamic-stub" };
			}
			return null;
		});
		b.onLoad({ filter: /.*/, namespace: "ojm-dynamic-stub" }, () => ({
			contents: "export default {};",
			loader: "js",
		}));
	},
};

/**
 * 元数据读取封闭性（P3 验收发现）：裸导入全部桩化，`ojm init` 产出的外部工程
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
		name: "ojm-bare-import-stub",
		setup(b) {
			b.onResolve({ filter: /^[^./#]/ }, (args) => {
				// 排除入口自身与绝对路径：entryPoints 在 Windows 上以盘符绝对路径（d:/...）
				// 传入，会命中上面的裸说明符过滤被桩化成「可 thenable 的代理」——
				// 整个入口模块变成 new Proxy(function(){},{get:()=>value,apply:()=>value})，
				// mod.default 因而是一个 thenable，async readModuleDefinition 执行 return
				// 时被当 thenable 接管、其 .then 永远不回调 resolve → Promise 永 pending →
				// 事件循环排空 → Node 以退出码 0 静默退出（pnpm dev 起不来）。
				// macOS/Linux 绝对路径以 / 开头已被过滤排除，故这是 Windows-only bug。
				if (args.kind === "entry-point")
					return null;
				if (/^[a-z]:/i.test(args.path))
					return null;
				return { path: args.path, namespace: "ojm-bare-stub" };
			});
			b.onLoad({ filter: /.*/, namespace: "ojm-bare-stub" }, (args) => {
				const names = namesBySpec.get(args.path) ?? [];
				return {
					contents: [
						// `apply` 返回 value（自身）而非 undefined：桩必须**可无限链式调用**。
						// 反例（真踩过）：zustand v5 是柯里化 API——`create()(initializer)`
						// 先调一次取工厂、再调一次取 store，且**都在模块顶层求值**。
						// 若 apply 返回 undefined，元数据读取即抛
						// `(0, import_zustand.create)(...) is not a function`，
						// 整个 `ojm dev/build` 起不来（模块代码本身完全合法）。
						// 同类形态：`axios.create(...)`、`i18next.createInstance(...)`、
						// `createTheme(...)` 等顶层库工厂。桩只在元数据读取期跑，放宽只会
						// 把「崩溃」变成「无害空转」。
						"const value = new Proxy(function () {}, { get: () => value, apply: () => value });",
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
	const outDir = fs.mkdtempSync(path.join(projectRoot, ".ojm-tmp-"));
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
			// ESM 输出 + import() 加载：入口经下方 onResolve 修正后不会被裸导入桩误伤为
			// thenable 代理，Windows/macOS 行为一致（此前 Windows 卡死的根因是入口被桩化成
			// 代理导致 async return 被 thenable 接管而永不 settle）。元数据读取只需取
			// `.default`，无需 CJS 语义。
			format: "esm",
			platform: "node",
			packages: "external",
			plugins: [runtimeStubPlugin, dynamicImportStubPlugin, makeBareImportStubPlugin(bareNames)],
			outdir: outDir,
			jsx: "automatic",
			// 元数据读取不需要 css：empty 装载器把 `import "./styles.css"` 抹成空模块，
			// 避免裸导入桩拦截 css 内部的 `@import "tailwindcss"`（js 桩无法注入 css）
			loader: { ".ts": "ts", ".tsx": "tsx", ".json": "json", ".css": "empty" },
			logLevel: "silent",
		});
		const bundled = path.join(outDir, "entry.js");
		// 加载桩化产物（ESM）：入口不会被裸导入桩误伤为 thenable 代理（见 onResolve 修正），
		// 故 mod.default 是真实定义，import() 正常 settle。
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
			// R5：entry.ts 声明的路由树（含 handle.category/order/title），
			// buildBundle 据此派生 manifest.routes（单一真源，避免手工双写漂移）
			routes?: RouteDefinitionLike[]
		};
	}
	finally {
		fs.rmSync(outDir, { recursive: true, force: true });
	}
}
