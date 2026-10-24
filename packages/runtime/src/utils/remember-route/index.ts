import { loginPath } from "#src/router/extra-info";
import { resolveSiteBase } from "#src/utils/site-base";

/**
 * 回跳参数取**路由空间**路径（剥掉站点 base）。
 *
 * 消费端（login 模块 `navigate(getRedirectPath(search))`）走的是 react-router
 * navigate——basename 会被再补一次。这里若直接用 `window.location.pathname`
 * （URL 空间，含 `/oj` 前缀），子路径部署下登录后落 `/oj/oj/home`（base 双拼，
 * 2026-10 子路径部署实测回归）。goLogin 的硬跳转负责补 base，本函数只管剥。
 */
export function rememberRoute() {
	const { pathname, search } = window.location;
	const base = resolveSiteBase();
	const routePath = base === "/" ? pathname : `/${pathname.slice(base.length)}`;
	if (routePath.length > 1 && routePath !== loginPath) {
		return `?redirect=${routePath}${search}`;
	}
	return "";
}
