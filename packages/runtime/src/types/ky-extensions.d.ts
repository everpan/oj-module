import "ky";

/**
 * 扩展 `ky` 的 `Options` 类型
 * 使用 `ignoreLoading` 设置是否忽略加载动画
 * 使用 `silentError` 让调用方自行消化错误体，不弹全局错误 toast
 * 使用 `skipAuthRefresh` 标记「本请求 401 时不得再触发 token 刷新」（刷新端点自身 + 刷新后的重放）
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
		/**
		 * 401 时跳过 token 刷新，直接走登录跳转。
		 * 两类请求必须带此标记：① auth/refresh 自身（否则刷新失败会重入刷新链自等待死锁）；
		 * ② 刷新后的重放请求（否则原接口持续 401 会无限刷新重放，页面永远 loading）。
		 * 用显式标记而非 URL endsWith 判定——查询串/尾斜杠/部署前缀都会让字符串匹配失效。
		 */
		skipAuthRefresh?: boolean
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
		/**
		 * 401 时跳过 token 刷新，直接走登录跳转（详见 Options 同名注释）
		 */
		skipAuthRefresh?: boolean
	}
}
