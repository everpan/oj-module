import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 模块清单中的单个模块声明 */
export interface ModuleConfigEntry {
	name: string
	entry: string
	enabled?: boolean
}

/** web.config.ts 的结构 */
export interface ModulesConfig {
	/** 产物 URL 前缀，留空表示同源相对路径 */
	baseUrl?: string
	/**
	 * 站点部署子路径（如 `"/oj"`），留空 = 挂在域名根。
	 *
	 * 站点被 oj 挂到 `mounts: [{ prefix: /oj, web: dist, spa: true }]` 这类非根
	 * 前缀时**必须**配它：`ojm build` 会把全站 index.html 的站内绝对 URL
	 * （importmap / `<script src>` / `<link href>`）改写为 `/oj/...`，并注入
	 * `window.__OJ_BASE__` 供路由 basename 与模块资源解析取用。
	 * 不配则浏览器去域名根取 `/assets/*` → 404 白屏，深链刷新也匹配不到路由。
	 *
	 * 与 `baseUrl` 的区别：`baseUrl` 是**模块产物**的 URL 前缀（可指向 CDN
	 * 绝对域），`siteBase` 是**站点自身**的部署位置；两者正交，可同时使用。
	 */
	siteBase?: string
	modules?: ModuleConfigEntry[]
	/**
	 * 站点 HTML 变换模块（可选）：相对工程根的路径（`./html-transform.ts`）
	 * 或包名。`ojm dev` / `ojm preview` 动态 import 它，用其 default 导出
	 * 作为静态层的 HTML transform——用于按路由写 `<title>` / OpenGraph，
	 * 让 IM 预览与非 JS 爬虫拿到正确元信息。形状见
	 * `packages/cli/src/html-transform.ts`（default 导出
	 * `(path, html) => string | { html, cacheControl? } | Promise<…>`）。
	 */
	htmlTransform?: string
}

const DEFAULT_CONFIG: Required<Pick<ModulesConfig, "baseUrl" | "siteBase">> = {
	baseUrl: "",
	siteBase: "",
};

/**
 * 加载模块工程的 web.config.ts（**不校验 modules**）。
 *
 * 两种布局的差别只在模块清单从哪来：
 *   - module-root：模块由 `src/<name>/web/entry.ts` 扫描得出（一目录一模块），
 *     web.config.ts 退化为「站点级配置 + 可选覆盖」（设计 D3）；
 *   - 历史布局：modules 必填，用 `loadModulesConfig`。
 * 缺文件不是错误（新工程可以没有 web.config.ts），坏文件必须报错。
 */
export async function loadSiteConfig(projectRoot: string): Promise<ModulesConfig & { baseUrl: string, siteBase: string }> {
	const configPath = path.join(projectRoot, "web.config.ts");
	if (!fs.existsSync(configPath))
		return { ...DEFAULT_CONFIG };

	let mod: { default?: ModulesConfig };
	try {
		mod = await import(pathToFileURL(configPath).href);
	}
	catch (error) {
		throw new Error(`无法加载 ${configPath}：${(error as Error).message}`, { cause: error });
	}

	return { ...DEFAULT_CONFIG, ...mod.default };
}

/**
 * 加载模块工程的 web.config.ts（历史布局：modules 必填）。
 *
 * 用 tsx 真实 import，而不是正则解析——这样配置文件里可以写注释、
 * 用变量、做条件判断，且类型错误会直接暴露（B10 的正则方案做不到）。
 */
export async function loadModulesConfig(projectRoot: string): Promise<ModulesConfig & { baseUrl: string, siteBase: string, modules: ModuleConfigEntry[] }> {
	const config = await loadSiteConfig(projectRoot);
	return { ...config, modules: assertModuleList(projectRoot, config.modules) };
}

/** 历史布局的 modules 必填校验（module-root 布局不走这条） */
export function assertModuleList(projectRoot: string, modules: ModuleConfigEntry[] | undefined): ModuleConfigEntry[] {
	if (!modules?.length)
		throw new Error(`${path.join(projectRoot, "web.config.ts")} 未导出有效的 modules 列表`);
	return modules;
}

/** 前端模块的最终清单项（entry 为相对工程根的路径，与 web.config.ts 历史口径一致） */
export interface ResolvedWebModule {
	name: string
	entry: string
	enabled: boolean
}

/**
 * module-root 布局的模块清单：**扫描为准，web.config.ts 只做可选覆盖**（设计 D3）。
 *
 * 规则（并集，不是替换——新增模块目录不会因为忘了登记而被静默漏构建）：
 *   1. 来源只有 `src/<name>/web/entry.ts`：纯后端模块没有前端产物，不进入本清单；
 *   2. 覆盖项按声明顺序排在前，其余按模块名字典序追加；
 *   3. `enabled: false` 仍生效（跳过构建）；
 *   4. 覆盖项指向不存在的前端入口 → 报错（改名/删目录后忘了改 config 的典型症状）。
 */
export function mergeModuleList(
	scanned: { name: string, webSrc?: string }[],
	overrides: ModuleConfigEntry[] | undefined,
	projectRoot: string,
): ResolvedWebModule[] {
	const web = scanned.filter(m => m.webSrc);
	const byName = new Map(web.map(m => [m.name, m]));
	const ordered: ResolvedWebModule[] = [];
	const seen = new Set<string>();

	for (const item of overrides ?? []) {
		const hit = byName.get(item.name);
		if (!hit) {
			throw new Error(
				`web.config.ts 登记了模块 "${item.name}"，但 src/${item.name}/web/entry.ts 不存在。\n`
				+ "module-root 布局以目录为准：删掉这条登记，或补回该模块目录。",
			);
		}
		seen.add(item.name);
		ordered.push({
			name: item.name,
			entry: path.relative(projectRoot, path.join(hit.webSrc!, "entry.ts")),
			enabled: item.enabled !== false,
		});
	}

	for (const m of web) {
		if (seen.has(m.name))
			continue;
		ordered.push({
			name: m.name,
			entry: path.relative(projectRoot, path.join(m.webSrc!, "entry.ts")),
			enabled: true,
		});
	}
	return ordered;
}

/** 解析模块 entry 的绝对路径 */
export function resolveModuleEntry(projectRoot: string, entryPath: string): string {
	return path.isAbsolute(entryPath) ? entryPath : path.resolve(projectRoot, entryPath);
}
