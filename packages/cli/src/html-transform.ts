/**
 * 站点 HTML 变换模块加载器（web.config.ts 的 `htmlTransform` 字段）。
 *
 * 动机：模块联邦站点每条路由都出**同一份** index.html，逐路由的
 * `<title>` / OpenGraph 无从表达——IM（微信/Slack/飞书）链接预览与非 JS
 * 爬虫只会看到默认 title。给静态层一个 content 级变换口子即可表达。
 *
 * 约定形状（default 导出，唯一入口）：
 *
 *   export default async function (path: string, html: string) {
 *     return html.replace("<title>oj</title>", "<title>分享 · oj</title>");
 *   }
 *
 * - `path`：解码后的请求路径（如 `/share/abc`），查询串已剥离；
 * - `html`：宿主 index.html 原文（reload 注入**之前**，故 dev 工具链不受影响）；
 * - 返回：新 HTML 字符串，或 `{ html, cacheControl? }`（逐响应 Cache-Control）；
 * - 该函数对 `/`、`/index.html` 与 SPA 回落的深链接一律生效；
 *   抛错或返回非字符串 → 静态层回退原文（站点不 500）。
 *
 * 解析规则：以 `.` 开头或绝对路径 → 相对工程根解析；否则按包名从工程根
 * 的 node_modules 解析（CLI 自身依赖不代答）。
 */

import type { HtmlTransform, HtmlTransformResult } from "./static-handler";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadModulesConfig } from "./config";
import { decodeReqPath } from "./static-handler";

/** 变换模块的 default 导出形状（比 handler 的 transform 少了原始 req） */
export type HtmlTransformModule = (
	path: string,
	html: string,
) => HtmlTransformResult | Promise<HtmlTransformResult>;

/** 解析 htmlTransform 配置的模块 URL（相对工程根 / 包名） */
function resolveTransformUrl(projectRoot: string, spec: string): string {
	if (spec.startsWith(".") || path.isAbsolute(spec))
		return pathToFileURL(path.resolve(projectRoot, spec)).href;

	const require = createRequire(path.join(projectRoot, "package.json"));
	try {
		return pathToFileURL(require.resolve(spec)).href;
	}
	catch (error) {
		throw new Error(
			`[ojm] 无法从工程根解析 htmlTransform 模块 "${spec}"（应为相对工程根的路径，或已安装的包名）：${(error as Error).message}`,
			{ cause: error },
		);
	}
}

/**
 * 读取工程 `web.config.ts` 的 `htmlTransform` 并加载为静态层 transform。
 * 未配置（或工程根本没有 web.config.ts）→ undefined（零行为变化）；
 * 配置了但模块缺失 / default 不是函数 → 抛人话错（fail-fast，不静默降级）。
 */
export async function loadHtmlTransform(projectRoot: string): Promise<HtmlTransform | undefined> {
	if (!existsSync(path.join(projectRoot, "web.config.ts")))
		return undefined;

	const config = await loadModulesConfig(projectRoot);
	const spec = config.htmlTransform;
	if (!spec)
		return undefined;

	const url = resolveTransformUrl(projectRoot, spec);
	let mod: { default?: unknown };
	try {
		mod = await import(url) as { default?: unknown };
	}
	catch (error) {
		throw new Error(
			`[ojm] 无法加载 htmlTransform 模块 "${spec}"（${url}）：${(error as Error).message}`,
			{ cause: error },
		);
	}

	const fn = mod.default;
	if (typeof fn !== "function") {
		throw new TypeError(
			`[ojm] htmlTransform 模块 "${spec}" 必须 default 导出一个函数 `
			+ `(path, html) => string | { html, cacheControl? }，实际拿到 ${fn === null ? "null" : typeof fn}`,
		);
	}

	const transform = fn as HtmlTransformModule;
	return (req, html) => transform(decodeReqPath(req.url ?? "/") ?? "/", html);
}
