import { TRUSTED_ORIGINS } from "./trust";

/**
 * P6.2 / §4.8：CSP 生成。
 *
 * 静态部署（无服务器动态化）下 nonce 为**构建期随机值**，每次 build
 * 轮换；内联 importmap 与该 nonce 绑定，其余脚本只允许 'self' 与模块
 * CDN 白名单。**不加 'strict-dynamic'**——它会让任意 host 的动态
 * import 合法，反而废掉 moduleOrigins 来源白名单。
 *
 * style-src 'unsafe-inline' 为 antd cssinjs 所必需（§4.8 明示）。
 * frame-ancestors 在 meta 形态下无效，由反向代理/响应头补齐（部署约束）。
 */

/** 构建期随机 nonce（base64，128 位熵） */
export function generateNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** 生成 CSP 策略串；moduleOrigins 复用信任根白名单（P6.1 单一来源） */
export function generateCsp(trustedOrigins: string[], nonce: string): string {
	const cdn = trustedOrigins.join(" ");
	const directives = [
		"default-src 'none'",
		`script-src 'self' ${cdn} 'nonce-${nonce}'`.replace(/\s+/g, " ").trim(),
		"script-src-attr 'none'",
		// P7.4：跨源模块的 fetch 与 CSS <link> 同样需要信任源，
		// 否则脚本可加载而样式/请求被拦（此前只加了 script-src）
		`connect-src 'self' ${cdn}`.replace(/\s+/g, " ").trim(),
		// antd CSS-in-JS 必需（cssinjs 动态插 <style>）
		`style-src 'self' ${cdn} 'unsafe-inline'`.replace(/\s+/g, " ").trim(),
		"img-src 'self' data: https:",
		"font-src 'self' data:",
		// iframe 模块域名白名单（P6.4 同源收敛；与 runtime IFRAME_ALLOWED_HOSTS
		// 保持一致，tests/iframe-whitelist-consistency.test.ts 断言）
		"frame-src https://ant.design https://react.dev https://condorheroblog.github.io",
		"form-action 'none'",
		"base-uri 'none'",
		"object-src 'none'",
		"upgrade-insecure-requests",
	];
	return directives.join(";\n");
}

/** 供构建脚本取默认白名单（TRUSTED_ORIGINS 转发） */
export const defaultTrustedOrigins = TRUSTED_ORIGINS;
