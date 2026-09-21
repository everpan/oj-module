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
	modules: ModuleConfigEntry[]
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

const DEFAULT_CONFIG: Required<Pick<ModulesConfig, "baseUrl">> = {
	baseUrl: "",
};

/**
 * 加载模块工程的 web.config.ts。
 *
 * 用 tsx 真实 import，而不是正则解析——这样配置文件里可以写注释、
 * 用变量、做条件判断，且类型错误会直接暴露（B10 的正则方案做不到）。
 */
export async function loadModulesConfig(projectRoot: string): Promise<ModulesConfig & { baseUrl: string }> {
	const configPath = path.join(projectRoot, "web.config.ts");

	let mod: { default?: ModulesConfig };
	try {
		mod = await import(pathToFileURL(configPath).href);
	}
	catch (error) {
		throw new Error(`无法加载 ${configPath}：${(error as Error).message}`, { cause: error });
	}

	const config = mod.default;
	if (!config?.modules?.length) {
		throw new Error(`${configPath} 未导出有效的 modules 列表`);
	}

	return { ...DEFAULT_CONFIG, ...config };
}

/** 解析模块 entry 的绝对路径 */
export function resolveModuleEntry(projectRoot: string, entryPath: string): string {
	return path.isAbsolute(entryPath) ? entryPath : path.resolve(projectRoot, entryPath);
}
