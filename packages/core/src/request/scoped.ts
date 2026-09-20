import type { ModuleRequest } from "../types";

/**
 * 模块专用 scoped request（v1 P6.3/D11/P7.2 直蒸，底层实例宿主注入）：
 * URL 须命中登记的任一 apiPrefix（段边界匹配 + ../ 折叠），越界即拒；
 * 剥离逐请求 prefix/prefixUrl（防凭据外泄）。前缀惰性求值，可先登记后请求。
 */
export function createScopedRequest(
	moduleName: string,
	getPrefix: () => string | readonly string[] | undefined,
	underlying: ModuleRequest,
): ModuleRequest {
	function guard(rawUrl: string): void {
		const registered = getPrefix();
		const prefixes = (Array.isArray(registered) ? registered : [registered]).filter(
			(prefix): prefix is string => typeof prefix === "string" && prefix.length > 0,
		);
		if (prefixes.length === 0) {
			throw new Error(
				`[module] 模块 "${moduleName}" 尚未登记 API 前缀：请先在生命周期中调用 `
				+ "ctx.register.apiPrefix(\"/your-prefix\") 再发起请求。",
			);
		}
		// 先 URL 归一化（折叠 ../），再段边界匹配——裸 startsWith 会放行兄弟前缀（/sys → /sysadmin）
		let pathname: string;
		try {
			pathname = new URL(rawUrl, "http://scoped.local").pathname;
		}
		catch {
			pathname = rawUrl;
		}
		const allowed = prefixes.some((prefix) => {
			const boundary = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
			return pathname === boundary || pathname.startsWith(`${boundary}/`);
		});
		if (!allowed) {
			throw new Error(
				`[module] 模块 "${moduleName}" 请求越界：${rawUrl} 不在其登记前缀 ${prefixes.join("、")} 内。`
				+ "请调整接口路径，或登记正确前缀。",
			);
		}
	}

	// 剥离逐请求 prefix/prefixUrl——否则 { prefix: "https://evil.com" } 会带凭据打到任意外域
	function sanitize(options?: unknown): unknown {
		if (!options || typeof options !== "object")
			return options;
		const { prefix: _prefix, prefixUrl: _prefixUrl, ...rest } = options as Record<string, unknown>;
		return rest;
	}

	const scoped = ((url: string | URL, options?: unknown) => {
		guard(String(url));
		return underlying(url as string, sanitize(options));
	}) as ModuleRequest;

	for (const method of ["get", "post", "put", "patch", "delete", "head"] as const) {
		scoped[method] = ((url: string | URL, options?: unknown) => {
			guard(String(url));
			return (underlying[method] as (u: string | URL, o?: unknown) => Promise<unknown>)(url as string, sanitize(options));
		}) as ModuleRequest[typeof method];
	}

	return scoped;
}
