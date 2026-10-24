/**
 * 站点部署 base（子路径部署，2026-10-21）。
 *
 * 问题：`ojm build` 产出的全站（shell-dist 拷来的 index.html + assets/）里，
 * 所有 URL 都是**站点根绝对路径**（`/assets/react.js`、`/favicon.ico`）。站点
 * 只要不挂在域名根（oj `mounts: [{ prefix: /oj, web: dist, spa: true }]`），
 * 浏览器就会去宿主机根取资源 → 全部 404 → 首页白屏；同时 react-router 的
 * basename 也必须是 `/oj`，否则深链刷新匹配不到任何路由。
 *
 * 解法（两件事，都在构建期一次性完成）：
 *   1. 重写 index.html 里的站内绝对 URL，统一加上 `web.config.ts` 的 `siteBase`；
 *   2. 注入 `window.__OJ_BASE__`，供 runtime 与 shell 在运行期取真值
 *      （`@oj-module/runtime` 的 `resolveSiteBase()`，见其 utils/site-base.ts）。
 *
 * 为什么不用 `<base href>`：shell 的 CSP 含 `base-uri 'none'`（P6.2），
 * 而且 `<base>` 会连带改变所有相对 URL 的解析，语义过宽。
 *
 * 为什么不用运行期改写：oj 只做静态直出（web 挂载），没有 HTML 模板层；
 * 构建期是唯一能同时改 HTML 与 URL 的时点。
 *
 * 未配置 `siteBase`（默认）时本模块**逐字节返回原 HTML**——根路径部署的产物
 * 与 0.2.16 完全一致，零回归风险。
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

/** 站内绝对路径加 base（已加过的幂等；`//host`、`http(s)://` 等原样返回） */
export function withSiteBase(url: string, base: string): string {
	if (!url.startsWith(ROOT_BASE) || url.startsWith("//"))
		return url;
	const normalized = normalizeSiteBase(base);
	if (normalized === ROOT_BASE || url.startsWith(normalized))
		return url;
	return `${normalized.slice(0, -1)}${url}`;
}

/** importmap 里所有映射值加 base（保留 JSON 值类型与顺序） */
function rewriteImportmap(html: string, base: string): string {
	return html.replace(
		/(<script type="importmap"[^>]*>)([\s\S]*?)(<\/script>)/,
		(full, open: string, body: string, close: string) => {
			let parsed: { imports?: Record<string, string> };
			try {
				parsed = JSON.parse(body);
			}
			catch {
				// 不是合法 JSON：宁可让构建失败，也不静默产出会白屏的 HTML
				throw new Error("[ojm] index.html 的 importmap 不是合法 JSON，无法按 siteBase 重写");
			}
			if (!parsed.imports)
				return full;
			const imports: Record<string, string> = {};
			for (const [specifier, url] of Object.entries(parsed.imports))
				imports[specifier] = withSiteBase(url, base);
			return `${open}${JSON.stringify({ ...parsed, imports }, null, 2)}${close}`;
		},
	);
}

/**
 * 重写全站 index.html：
 * - importmap 映射值、`<script src>`、`<link href>` 统一加 `siteBase`；
 * - `<head>` 内注入 `window.__OJ_BASE__` / `window.__OJ_API_BASE__`
 *   （**复用 importmap 的 nonce**，CSP 是 `script-src 'self' … 'nonce-xxx'`，
 *   无 nonce 的内联脚本会被直接拦掉）。
 *
 * 两者独立：siteBase 非根才重写 URL；apiBase 配了就注入（API 挂载前缀是
 * 部署期事实，与站点位置正交）。都不涉及 → 逐字节原样返回（零回归）。
 */
export function rewriteIndexHtml(html: string, siteBase: string | undefined, apiBase?: string): string {
	const base = normalizeSiteBase(siteBase);
	const api = apiBase?.trim();
	// 根路径部署且未配 API 前缀：原样返回（保持与既有产物逐字节一致）
	if (base === ROOT_BASE && !api)
		return html;

	const nonce = html.match(/<script type="importmap"[^>]*\snonce="([^"]*)"/)?.[1];
	if (!nonce) {
		throw new Error(
			"[ojm] 站点 index.html 缺少带 nonce 的 importmap，无法注入 window.__OJ_BASE__ / window.__OJ_API_BASE__"
			+ "（CSP 会拦掉无 nonce 的内联脚本，子路径部署下路由 basename 会退化成 \"/\"）。"
			+ "请确认 shell-dist 是最新构建产物（pnpm build:shell）。",
		);
	}

	const globals: string[] = [];
	let out = html;
	if (base !== ROOT_BASE) {
		out = rewriteImportmap(out, base);
		// 属性值：只要以单个 "/" 开头（排除 "//host"）。importmap 是脚本正文、非属性，
		// 上一步已处理，二者不重叠。
		out = out.replace(/(\b(?:href|src)=")(\/[^/"][^"]*|\/")/g, (_m, attr: string, url: string) =>
			`${attr}${withSiteBase(url, base)}`);
		globals.push(`window.__OJ_BASE__=${JSON.stringify(base)};`);
	}
	if (api) {
		// 归一为不以 / 结尾（ky v2 的 prefix 自剥尾斜杠，这里归一保证注入值确定）
		globals.push(`window.__OJ_API_BASE__=${JSON.stringify(api.replace(/\/+$/, ""))};`);
	}

	const injected = `<script nonce="${nonce}">${globals.join("")}</script>`;
	// 注入点选在 importmap 之前：importmap 本身必须在任何 module script 之前，
	// 而内联 classic script 是解析期同步执行，因此宿主 main 与模块 entry 读
	// `window.__OJ_BASE__` 时它一定已经在位。
	return out.replace("<script type=\"importmap\"", `${injected}\n\t\t<script type="importmap"`);
}
