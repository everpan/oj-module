import "ky";

/**
 * 扩展 `ky` 的 `Options` 类型
 * 使用 `ignoreLoading` 设置是否忽略加载动画
 * 使用 `silentError` 让调用方自行消化错误体，不弹全局错误 toast
 */
declare module "ky" {
	interface Options {
		/**
		 * 设置忽略全局加载动画
		 */
		ignoreLoading?: boolean
		/**
		 * 设置忽略全局错误提示（错误体由调用方自行消化，如「未配置市场地址」这类预期空态）
		 */
		silentError?: boolean
	}
	interface NormalizedOptions {
		/**
		 * 设置忽略全局加载动画
		 */
		ignoreLoading?: boolean
		/**
		 * 设置忽略全局错误提示（错误体由调用方自行消化，如「未配置市场地址」这类预期空态）
		 */
		silentError?: boolean
	}
}
