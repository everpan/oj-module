import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeSiteBase, resolveSiteBase, withSiteBase } from "#src/utils/site-base";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * 站点部署 base（子路径部署，2026-10-21）。
 *
 * 这组断言守的是「子路径部署下三个必然出错的点」：
 *  1. `createBrowserRouter({ basename })` 取不到真实前缀 → 深链刷新 404；
 *  2. `goLogin()` / 改密跳转拼出 `/login` → 跳出站点；
 *  3. runtime 产物里的 `import.meta.env.BASE_URL` 是**包构建期**内联的 `/`。
 * 因此真实值只能来自部署期注入的 `window.__OJ_BASE__`。
 */

const GLOBAL_KEY = "__OJ_BASE__";

function setInjectedBase(value: string | undefined) {
	const g = globalThis as unknown as Record<string, unknown>;
	if (value === undefined)
		delete g[GLOBAL_KEY];
	else
		g[GLOBAL_KEY] = value;
}

afterEach(() => {
	setInjectedBase(undefined);
});

describe("normalizeSiteBase：手写配置的四种写法归一到同一结果", () => {
	it.each([
		[undefined, "/"],
		[null, "/"],
		["", "/"],
		["   ", "/"],
		["/", "/"],
		["oj", "/oj/"],
		["/oj", "/oj/"],
		["/oj/", "/oj/"],
		["/oj/ ", "/oj/"],
		["/a/b", "/a/b/"],
		["/a/b/", "/a/b/"],
	])("%s → %s", (raw, expected) => {
		expect(normalizeSiteBase(raw)).toBe(expected);
	});
});

describe("resolveSiteBase：部署期注入优先于构建期 BASE_URL", () => {
	it("无注入时回退构建期值（根路径部署，行为与 0.2.16 一致）", () => {
		expect(resolveSiteBase()).toBe("/");
	});

	it("注入 `/oj` → 归一为 `/oj/`（basename 与 URL 拼接都要求尾斜杠）", () => {
		setInjectedBase("/oj");
		expect(resolveSiteBase()).toBe("/oj/");
	});

	it("注入值每次重新读取（不做模块级缓存，便于宿主热改 / 测试切换）", () => {
		setInjectedBase("/oj");
		expect(resolveSiteBase()).toBe("/oj/");
		setInjectedBase("/other");
		expect(resolveSiteBase()).toBe("/other/");
		setInjectedBase(undefined);
		expect(resolveSiteBase()).toBe("/");
	});
});

describe("withSiteBase：站内绝对路径加前缀", () => {
	it.each([
		["/assets/react.js", "/oj/", "/oj/assets/react.js"],
		["/favicon.ico", "/oj/", "/oj/favicon.ico"],
		["/oj/assets/react.js", "/oj/", "/oj/assets/react.js"],
		["/assets/react.js", "/", "/assets/react.js"],
		// 非站内绝对路径一律原样：CDN 模块、协议相对、data URL、相对路径
		["https://cdn.example.com/m/entry.js", "/oj/", "https://cdn.example.com/m/entry.js"],
		["//cdn.example.com/m/entry.js", "/oj/", "//cdn.example.com/m/entry.js"],
		["modules/x/entry.js", "/oj/", "modules/x/entry.js"],
	])("%s @ %s → %s", (url, base, expected) => {
		expect(withSiteBase(url, base)).toBe(expected);
	});
});

/**
 * 源码扫描：`import.meta.env.BASE_URL` 只允许出现在 site-base.ts。
 *
 * runtime 是**预构建**分发的——包构建期 vite 会把 `import.meta.env.BASE_URL`
 * 替换成构建时的 base（当前为 `/`），任何新代码再读它都会在子路径部署下静默
 * 取到错值。这条扫描就是那道门。
 */
describe("源码扫描：BASE_URL 单点", () => {
	const SRC = path.join(PROJECT_ROOT, "packages/runtime/src");
	const ALLOW = new Set(["utils/site-base.ts"]);

	function walk(dir: string, out: string[] = []): string[] {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, out);
				continue;
			}
			if (/\.(?:ts|tsx)$/.test(entry.name))
				out.push(full);
		}
		return out;
	}

	it("除 site-base.ts 外无 import.meta.env.BASE_URL 取值", () => {
		const hits: string[] = [];
		for (const file of walk(SRC)) {
			const rel = path.relative(SRC, file).split(path.sep).join("/");
			if (ALLOW.has(rel))
				continue;
			const code = fs.readFileSync(file, "utf-8")
				// 注释里提到 BASE_URL 是文档，不是取值
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/\/\/.*$/gm, "");
			if (code.includes("import.meta.env.BASE_URL"))
				hits.push(rel);
		}
		expect(hits, "子路径部署下这些位置会取到构建期错值，请改走 resolveSiteBase()").toEqual([]);
	});
});
