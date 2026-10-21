/**
 * 如果在其他地方用到了路由跳转，将路由的 path 抽离出来，在此方便维护
 * 防止修改 path 时忘记修改其他地方的 path
 */

import { resolveSiteBase } from "#src/utils/site-base";

export const loginPath = "/login";
export const privacyPolicyPath = "/privacy-policy";
export const termsOfServicePath = "/terms-of-service";

export const exceptionPath = "/exception";
export const exception403Path = `${exceptionPath}/403`;
export const exception404Path = `${exceptionPath}/404`;
export const exception500Path = `${exceptionPath}/500`;
export const exceptionUnknownComponentPath = `${exceptionPath}/not-found-component`;

/**
 * 判断 pathname 是否为登录页（basename 感知，P0）。
 *
 * 供 ky hooks 等 React 之外的场景使用：原始 `location.pathname` 含 BASE_URL，
 * 子路径部署（/oj/wiki/...）下直接与 loginPath 比较恒为 false，401 时会重复 goLogin。
 * React 组件内请用 `useLocation()`（react-router 已剥离 basename），无需本函数。
 *
 * @param base 部署 base，恒以 `/` 结尾；缺省取 `resolveSiteBase()`（部署期注入优先，
 * 见 utils/site-base.ts —— runtime 产物里的 `import.meta.env.BASE_URL` 是构建期
 * 内联的 `/`，子路径部署下直接用它恒错）
 */
export function isLoginPathname(pathname: string, base: string = resolveSiteBase()): boolean {
	return pathname === `${base}${loginPath.slice(1)}`;
}
