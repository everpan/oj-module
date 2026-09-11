import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * 偏差 3（layout e2e 暴露）：vite lib 构建会把 entry 引用的 CSS 抽为
 * dist/runtime.css，但 importmap 消费方只 import runtime.js，CSS 永远不会被
 * 加载。此脚本把产物 CSS 内联回 runtime.js 顶部（style 注入，幂等 marker
 * data-ojm-runtime-css），使产物自包含：任何宿主 import 即得完整样式。
 */
const DIR = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(DIR, "../dist");
const cssPath = path.join(dist, "runtime.css");
const jsPath = path.join(dist, "runtime.js");

if (!existsSync(cssPath)) {
	// 产物自携带样式是冻结契约（tests/runtime-bundle-css.test.ts），CSS 缺失
	// 意味着样式链路断裂，必须响亮失败而不是静默产出裸 JS
	console.error("[inline-css] dist/runtime.css 不存在：产物必须自携带样式（偏差 3 契约），构建中止");
	process.exit(1);
}

const css = readFileSync(cssPath, "utf-8");
const js = readFileSync(jsPath, "utf-8");
const preamble = `/* data-ojm-runtime-css: 产物自携带样式（偏差 3 修复），由 scripts/inline-css.mjs 注入 */
if (typeof document !== "undefined" && !document.querySelector("style[data-ojm-runtime-css]")) {
	const s = document.createElement("style");
	s.setAttribute("data-ojm-runtime-css", "");
	s.textContent = ${JSON.stringify(css)};
	document.head.appendChild(s);
}
`;
writeFileSync(jsPath, `${preamble}${js}`);
rmSync(cssPath);
console.log(`[inline-css] 已内联 ${css.length} 字节 CSS → runtime.js`);
