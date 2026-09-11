// 前端构建期全局类型（Vite 语义）。
//
// `ojm api` 生成的 client（web/src/<模块>/client/api.ts）会读
// `import.meta.env.DEV` 做开发期响应校验；脚手架不直接依赖 vite，
// 故自带最小声明，避免 `pnpm typecheck` 对生成物报 TS2339
// "Property 'env' does not exist on type 'ImportMeta'"。
interface ImportMetaEnv {
	readonly DEV: boolean
	readonly PROD: boolean
	readonly MODE: string
	readonly BASE_URL: string
	readonly [key: string]: string | boolean | undefined
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}

interface Window {
	/** ant design message instance（runtime antd-app 注入，模块内可直接用） */
	$message?: import("antd/es/message/interface").MessageInstance
}
