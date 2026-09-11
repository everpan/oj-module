/**
 * 生成 client 的 DEV 校验分支引用 import.meta.env.DEV（ojm build 构建期常量替换）。
 * 本工程无 vite 依赖，这里按 vite/client 的最小形态手工声明。
 */
interface ImportMeta {
	readonly env: {
		readonly DEV: boolean
		readonly PROD: boolean
	}
}
