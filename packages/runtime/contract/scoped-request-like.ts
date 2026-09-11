/**
 * 生成 client 对 request 实例的最小结构类型（ISP——不依赖 ky/runtime 类型，
 * 任何满足该形状的对象（runtime 全局 request、模块 scoped client、测试 stub）
 * 都可 bindRequest 注入）。
 */

/** ky ResponsePromise 的最小结构：既是 Promise<Response>（raw 通道）又有 .json() */
export interface ResponsePromiseLike extends Promise<Response> {
	json: <T>() => Promise<T>
}

export interface RequestCall {
	(url: string, options?: {
		/** 与 ky SearchParamsOption 的 Record 形态对齐——宽于它则真 ky 实例无法赋给本接口 */
		searchParams?: Record<string, string | number | boolean>
		json?: unknown
		ignoreLoading?: boolean
	}): ResponsePromiseLike
}

export interface ScopedRequestLike {
	get: RequestCall
	post: RequestCall
	put: RequestCall
	delete: RequestCall
	patch: RequestCall
	head: RequestCall
}
