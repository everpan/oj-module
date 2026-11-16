import { useAuthStore } from "#src/store/auth";
import { rememberRoute } from "#src/utils/remember-route";
import { resolveSiteBase } from "#src/utils/site-base";
import { globalProgress } from "./global-progress";

/**
 * 跳转到登录页面
 *
 * 必须带上部署 base（`resolveSiteBase()`）：子路径部署下 `location.href = "/login"`
 * 会跳到宿主机根，而不是 `/oj/login`。不能用 `import.meta.env.BASE_URL`——预构建
 * 产物里它是构建期内联的 `/`。
 */
export function goLogin() {
	// 清掉可能泄漏的全局 loading 计数：刷新失败/会话吊销时，被中断的请求 afterResponse
	// 不保证触发（ky 超时/导航中止），计数残留会让页面一直转圈。跳登录前统一归零。
	globalProgress.forceFinish();
	// 重置登录状态
	useAuthStore.getState().reset();
	// 跳转到登录页面，并带上需要记住的路由信息
	window.location.href = `${resolveSiteBase()}login${rememberRoute()}`;
}
