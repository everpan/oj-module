import { useAuthStore } from "#src/store/auth";
import { rememberRoute } from "#src/utils/remember-route";
import { resolveSiteBase } from "#src/utils/site-base";

/**
 * 跳转到登录页面
 *
 * 必须带上部署 base（`resolveSiteBase()`）：子路径部署下 `location.href = "/login"`
 * 会跳到宿主机根，而不是 `/oj/login`。不能用 `import.meta.env.BASE_URL`——预构建
 * 产物里它是构建期内联的 `/`。
 *
 * @returns 无返回值
 */
export function goLogin() {
	// 重置登录状态
	useAuthStore.getState().reset();
	// 跳转到登录页面，并带上需要记住的路由信息
	window.location.href = `${resolveSiteBase()}login${rememberRoute()}`;
}
