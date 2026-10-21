import { describe, expect, it } from "vitest";

import { normalizeSiteBase as shellNormalize, withSiteBase as shellWithBase } from "../../packages/cli/shell/src/site-urls";
import { normalizeSiteBase as cliNormalize, withSiteBase as cliWithBase, rewriteIndexHtml } from "../../packages/cli/src/site-base";
import { normalizeSiteBase as runtimeNormalize, withSiteBase as runtimeWithBase } from "../../packages/runtime/src/utils/site-base";

/**
 * 站点部署 base（子路径部署，2026-10-21）。
 *
 * 三处实现同规则（runtime 运行期取值 / shell 宿主解析清单 / cli 构建期重写 HTML），
 * 但它们分属三个构建单元，无法共享代码：runtime 是预构建 npm 产物、shell 由 esbuild
 * 单独打包、cli 跑在 Node 侧。这里用**同一张用例表**对撞三份实现，任何一处改动
 * 不同步都会红。
 */

const BASE_CASES: Array<[string | null | undefined, string]> = [
	[undefined, "/"],
	[null, "/"],
	["", "/"],
	["   ", "/"],
	["/", "/"],
	["oj", "/oj/"],
	["/oj", "/oj/"],
	["/oj/", "/oj/"],
	["/a/b", "/a/b/"],
];

const URL_CASES: Array<[string, string, string]> = [
	["/assets/react.js", "/oj/", "/oj/assets/react.js"],
	["/favicon.ico", "/oj/", "/oj/favicon.ico"],
	["/oj/assets/react.js", "/oj/", "/oj/assets/react.js"],
	["/assets/react.js", "/", "/assets/react.js"],
	["https://cdn.example.com/m/entry.js", "/oj/", "https://cdn.example.com/m/entry.js"],
	["//cdn.example.com/m/entry.js", "/oj/", "//cdn.example.com/m/entry.js"],
	["modules/x/entry.js", "/oj/", "modules/x/entry.js"],
];

describe("三份 normalizeSiteBase 实现逐条一致", () => {
	it.each(BASE_CASES)("%s → %s", (raw, expected) => {
		expect(runtimeNormalize(raw)).toBe(expected);
		expect(shellNormalize(raw)).toBe(expected);
		expect(cliNormalize(raw)).toBe(expected);
	});
});

describe("三份 withSiteBase 实现逐条一致", () => {
	it.each(URL_CASES)("%s @ %s → %s", (url, base, expected) => {
		expect(runtimeWithBase(url, base)).toBe(expected);
		expect(shellWithBase(url, base)).toBe(expected);
		expect(cliWithBase(url, base)).toBe(expected);
	});
});

/** 与 `packages/cli/shell-dist/index.html` 同形的裁剪版 fixture */
function fixtureHtml(nonce = "abc123=="): string {
	return [
		"<!doctype html>",
		"<html lang=\"zh-CN\">",
		"\t<head>",
		"\t\t<meta charset=\"UTF-8\" />",
		"\t\t<link rel=\"icon\" href=\"/favicon.ico\" />",
		`\t\t<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'nonce-${nonce}'; base-uri 'none'" />`,
		// prettier-ignore
		`\t\t<script type="importmap" nonce="${nonce}">${JSON.stringify({ imports: {
			"react": "/assets/react.js",
			"react-dom/client": "/assets/react-dom-client.js",
			"@oj-module/runtime": "/assets/runtime.js",
			"@plane/kit": "https://cdn.example.com/kit.js",
		} }, null, 2)}</script>`,
		"\t\t<script type=\"module\" crossorigin src=\"/assets/index-CLdhl3Qd.js\"></script>",
		"\t</head>",
		"\t<body>",
		"\t\t<div id=\"root\"></div>",
		"\t</body>",
		"</html>",
	].join("\n");
}

describe("rewriteIndexHtml：构建期把全站 URL 挪到部署前缀", () => {
	it("未配置 siteBase 时逐字节不变（根路径部署零回归）", () => {
		const html = fixtureHtml();
		expect(rewriteIndexHtml(html, "")).toBe(html);
		expect(rewriteIndexHtml(html, "/")).toBe(html);
		expect(rewriteIndexHtml(html, undefined)).toBe(html);
	});

	it("siteBase=/oj：importmap / script src / link href 全部带前缀", () => {
		const out = rewriteIndexHtml(fixtureHtml(), "/oj");

		const importmap = JSON.parse(out.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/)![1]).imports;
		expect(importmap.react).toBe("/oj/assets/react.js");
		expect(importmap["react-dom/client"]).toBe("/oj/assets/react-dom-client.js");
		expect(importmap["@oj-module/runtime"]).toBe("/oj/assets/runtime.js");
		// CDN 绝对域是模块产物前缀（web.config.ts baseUrl），不能动
		expect(importmap["@plane/kit"]).toBe("https://cdn.example.com/kit.js");

		expect(out).toContain("<script type=\"module\" crossorigin src=\"/oj/assets/index-CLdhl3Qd.js\"></script>");
		expect(out).toContain("<link rel=\"icon\" href=\"/oj/favicon.ico\" />");
	});

	it("注入 window.__OJ_BASE__，且复用 importmap 的 nonce（否则被 CSP 拦掉）", () => {
		const out = rewriteIndexHtml(fixtureHtml("n0nce=="), "/oj");
		expect(out).toContain("<script nonce=\"n0nce==\">window.__OJ_BASE__=\"/oj/\";</script>");
		// 位置：importmap 之前 → 必然早于任何 module script 求值（含宿主 main 与模块 entry）
		expect(out.indexOf("window.__OJ_BASE__")).toBeGreaterThan(out.indexOf("<head>"));
		expect(out.indexOf("window.__OJ_BASE__")).toBeLessThan(out.indexOf("type=\"importmap\""));
		expect(out.indexOf("window.__OJ_BASE__")).toBeLessThan(out.indexOf("type=\"module\""));
	});

	it("不留裸站内绝对 URL、不产生双斜杠", () => {
		const out = rewriteIndexHtml(fixtureHtml(), "/oj/");
		expect(out).not.toMatch(/(?:href|src)="\/(?!oj\/)/);
		expect(out).not.toContain("/oj//");
	});

	it("幂等：对已重写过的 HTML 再跑一次不会二次加前缀", () => {
		const once = rewriteIndexHtml(fixtureHtml(), "/oj");
		const twice = rewriteIndexHtml(once, "/oj");
		const count = (s: string) => s.split("/oj/assets/react.js").length;
		expect(count(twice)).toBe(count(once));
		expect(twice).not.toContain("/oj/oj");
	});

	it("缺带 nonce 的 importmap 时 fail-closed（不产出会被 CSP 拦掉的内联脚本）", () => {
		const broken = "<html><head></head><body></body></html>";
		expect(() => rewriteIndexHtml(broken, "/oj")).toThrow(/缺少带 nonce 的 importmap/);
	});
});
