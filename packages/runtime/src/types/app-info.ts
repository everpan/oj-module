/**
 * 构建时注入的应用元信息类型。
 *
 * 该对象由宿主在构建期通过 Vite `define` 注入为全局 `__APP_INFO__`，
 * 框架内部**唯一**允许读取该全局的地方是 `getAppInfo()`（见 `utils/get-app-info`）。
 * 模块工程应通过 `import { getAppInfo } from "@oj-module/runtime"` 获取，
 * 不得直接依赖全局 `__APP_INFO__`，否则每个模块工程都要复制同样的 define 配置（设计文档 B9）。
 */
export interface AppInfo {
	pkg: {
		name: string
		version: string
		license: string
		author: string
		dependencies: Record<string, string>
	}
	lastBuildTime: string
}
