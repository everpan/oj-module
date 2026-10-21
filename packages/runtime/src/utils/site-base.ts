/**
 * 站点部署 base 的唯一取值口（子路径部署支持，2026-10-21）。
 *
 * 背景：runtime 作为**预构建产物**分发（`dist/runtime.js`），`import.meta.env.BASE_URL`
 * 在 `packages/runtime/vite.config.ts` 的构建期就被内联成 `"/"`。于是当站点被部署到
 * 宿主机子路径（如 oj 的 `mounts: [{ prefix: /oj, web: dist, spa: true }]`）时：
 *
 * - `createBrowserRouter({ basename: "/" })` 剥不掉 `/oj`，深链刷新一律 404 兜底页；
 * - `goLogin()` / `must-change` 拼出 `/login`，落在宿主机根而不是 `/oj/login`；
 * - `isLoginPathname(location.pathname)` 恒为 false，401 会重复跳登录。
 *
 * 解法：真正的 base 只有**部署期**才知道（构建产物被挂到哪个前缀，由 oj 的 config
 * 决定），所以由宿主在 index.html 里注入 `window.__OJ_BASE__`（`ojm build` 按
 * `web.config.ts` 的 `siteBase` 写入），runtime 运行期优先读它，读不到再回退到
 * 构建期值。这样：
 *
 * - 根路径部署（绝大多数工程，以及 `ojm dev` / `ojm preview` 默认）行为完全不变；
 * - 子路径部署只需改一个配置项，无需重新构建 runtime。
 *
 * 契约：
 * - 返回值**恒以 `/` 结尾**（`import.meta.env.BASE_URL` 的既有约定，`isLoginPathname`
 *   的字符串拼接依赖它），根路径恒为 `"/"`；
 * - 只处理「站点 base」，**不要**拿它拼 API 前缀——API 前缀是 `VITE_API_BASE_URL`
 *   与模块 scoped request 的职责，两者互相独立；
 * - React 组件内不要用它拼跳转，`navigate` / `<Link to>` 走的是**路由空间**
 *   （basename 已被 react-router 剥离），拼上 base 反而会变成 `/oj/oj/wiki`。
 */

const ROOT_BASE = "/";

/**
 * 宿主注入的全局形状：`<script nonce>window.__OJ_BASE__ = "/oj/"</script>`
 * （`ojm build` 按 `web.config.ts` 的 `siteBase` 写入 index.html）。
 */
interface OjBaseGlobal {
	__OJ_BASE__?: string
}

/**
 * 归一化为「以 `/` 开头且以 `/` 结尾」的形式。
 *
 * 接受 `oj` / `/oj` / `/oj/` / `oj/` 四种写法（配置手写极易带或不带斜杠），
 * 空值与 `"/"` 一律归为根路径。
 */
export function normalizeSiteBase(raw: string | null | undefined): string {
	if (!raw)
		return ROOT_BASE;
	const trimmed = raw.trim();
	if (!trimmed || trimmed === ROOT_BASE)
		return ROOT_BASE;
	const withLeading = trimmed.startsWith(ROOT_BASE) ? trimmed : `${ROOT_BASE}${trimmed}`;
	return withLeading.endsWith(ROOT_BASE) ? withLeading : `${withLeading}${ROOT_BASE}`;
}

/**
 * 当前站点的部署 base（恒以 `/` 结尾）。
 *
 * 优先级：`window.__OJ_BASE__`（部署期注入）> `import.meta.env.BASE_URL`（构建期值）。
 *
 * 每次调用都重新读取——不做模块级缓存。原因：测试需要在不重启模块的情况下模拟
 * 不同部署前缀（`vi.stubGlobal`），而字符串归一化的成本可忽略。
 */
export function resolveSiteBase(): string {
	const injected = (globalThis as OjBaseGlobal).__OJ_BASE__;
	if (typeof injected === "string")
		return normalizeSiteBase(injected);
	return normalizeSiteBase(import.meta.env.BASE_URL);
}

/**
 * 把站内绝对路径（`/assets/x.js`）拼到站点 base 上（`/oj/assets/x.js`）。
 *
 * 已带 base 的路径幂等；`http(s)://`、`//cdn`、`data:` 等一切非站内绝对路径原样返回
 * （模块 entry 允许是 CDN 绝对域，见 `web.config.ts` 的 `baseUrl`）。
 */
export function withSiteBase(url: string, base: string = resolveSiteBase()): string {
	if (!url.startsWith(ROOT_BASE) || url.startsWith("//"))
		return url;
	const normalized = normalizeSiteBase(base);
	if (normalized === ROOT_BASE || url.startsWith(normalized))
		return url;
	return `${normalized.slice(0, -1)}${url}`;
}
