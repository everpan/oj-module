/**
 * 宿主 shell 侧的站点 base 解析（子路径部署，2026-10-21）。
 *
 * shell 产物（`shell-dist/index.html` + `assets/*`）里的 URL 一律是**站点根绝对路径**
 * （`/assets/react.js`）。`ojm build` 合并全站时按 `web.config.ts` 的 `siteBase`
 * 重写 index.html 并注入 `window.__OJ_BASE__`，运行期这里读它把 modules.json
 * 里的入口 / CSS / 预载 URL 补齐——否则站点挂在 `/oj` 时资源全部 404（首页白屏）。
 *
 * 为什么 shell 不直接 import runtime 的同名工具：本文件被 vitest 直接加载做纯函数
 * 断言，而 runtime 主入口会拉进 antd/react 整棵树。规则与
 * `packages/runtime/src/utils/site-base.ts` 逐条一致，由
 * `tests/cli/site-base.test.ts` 用同一张用例表对撞防漂移。
 */

const ROOT_BASE = "/";

/** 归一化为「以 `/` 开头且以 `/` 结尾」；空值与 `"/"` 归为根路径 */
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
 * 当前站点部署 base（恒以 `/` 结尾）。
 *
 * 优先级：`window.__OJ_BASE__`（`ojm build` 按 siteBase 注入）> `import.meta.env.BASE_URL`
 * （shell 构建期固定为 `"/"`，仅在未注入时兜底，即根路径部署与 `ojm dev`）。
 */
export function resolveSiteBase(): string {
	const injected = (globalThis as { __OJ_BASE__?: string }).__OJ_BASE__;
	if (typeof injected === "string")
		return normalizeSiteBase(injected);
	return normalizeSiteBase(import.meta.env.BASE_URL);
}

/** 站内绝对路径（`/modules/x/entry.js`）→ 带部署 base；已带 base 的幂等，绝对域原样 */
export function withSiteBase(url: string, base: string = resolveSiteBase()): string {
	if (!url.startsWith(ROOT_BASE) || url.startsWith("//"))
		return url;
	const normalized = normalizeSiteBase(base);
	if (normalized === ROOT_BASE || url.startsWith(normalized))
		return url;
	return `${normalized.slice(0, -1)}${url}`;
}
