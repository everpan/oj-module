import { describe, expect, it } from "vitest";

import { resolveModuleUrls } from "../../packages/cli/shell/src/manifest";
import { collectPreloads } from "../../packages/cli/shell/src/preload";

/**
 * 子路径部署（2026-10-21）：modules.json 是**构建期**产物，URL 恒为站点根的
 * `/modules/...`；真实前缀只有运行期知道（`window.__OJ_BASE__`）。宿主拿到清单
 * 后必须一次性归一，后续 CSS 注入 / modulepreload / loader entry 才都正确。
 *
 * 漏改任一字段的后果都是**首页白屏**（entry 404）或**样式全丢**（css 404），
 * 所以这里逐字段断言。
 */
describe("resolveModuleUrls：清单 URL 补部署前缀", () => {
	const list = [
		{
			name: "wiki",
			version: "0.1.3",
			entry: "/modules/wiki/0.1.3/entry.js",
			enabled: true,
			css: ["/modules/wiki/0.1.3/entry.css"],
			chunks: [
				{ url: "/modules/wiki/0.1.3/entry.js", integrity: "sha384-a", lazy: false },
			],
		},
	];

	it("entry / css / chunks[].url 全部加前缀", () => {
		const [mod] = resolveModuleUrls(list, "/oj/");
		expect(mod.entry).toBe("/oj/modules/wiki/0.1.3/entry.js");
		expect(mod.css).toEqual(["/oj/modules/wiki/0.1.3/entry.css"]);
		expect(mod.chunks?.[0].url).toBe("/oj/modules/wiki/0.1.3/entry.js");
		// integrity 是内容哈希，不参与 URL 拼接
		expect(mod.chunks?.[0].integrity).toBe("sha384-a");
	});

	it("base 为 /（根路径部署）时清单逐字段不变", () => {
		expect(resolveModuleUrls(list, "/")).toEqual(list);
	});

	it("cDN 绝对域模块原样保留（web.config.ts 的 baseUrl）", () => {
		const [mod] = resolveModuleUrls(
			[{ name: "cdn", entry: "https://cdn.example.com/modules/cdn/1.0.0/entry.js" }],
			"/oj/",
		);
		expect(mod.entry).toBe("https://cdn.example.com/modules/cdn/1.0.0/entry.js");
	});

	it("归一后的 chunks 直接喂 collectPreloads 即为最终 href", () => {
		const preloads = collectPreloads(resolveModuleUrls(list, "/oj/"));
		expect(preloads).toEqual([
			{ href: "/oj/modules/wiki/0.1.3/entry.js", integrity: "sha384-a" },
		]);
	});
});
