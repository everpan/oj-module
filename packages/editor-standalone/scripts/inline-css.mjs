import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * @plane/editor 共享资产：把编辑器 CSS 内联回 dist/editor.js 顶部。
 *
 * 与 packages/runtime/scripts/inline-css.mjs 同思路（偏差 3 的既有惯例）：
 * importmap 消费方只会 `import "@plane/editor"` 一个说明符，产物若把样式留在
 * 旁边的 editor.css，那份 CSS 永远不会被加载 —— 编辑器能渲染但全无样式。
 * 内联后资产自包含：任何宿主/模块 import 即得完整样式，且 importmap 无需为
 * CSS 单开条目（对比：nprogress/nprogress.css 那种独立 CSS 资产要占一个键）。
 *
 * 幂等靠 marker 属性 data-ojm-editor-css：宿主与多个模块各自 import 同一份
 * 资产（importmap 单例），只有第一次会插入 <style>。
 *
 * 输入约定（由 oj-app/scripts/install-ojm.sh 串起）：
 *   dist/editor.js   ← plane 侧 tools/editor-spike 的 dist-standalone/entry.js
 *   dist/editor.css  ← 同目录的 editor.css
 * 本脚本消费掉 CSS 后删除它，故 dist/ 里只留一个 editor.js（入库的那份）。
 */
const DIR = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(DIR, "../dist");
const cssPath = path.join(dist, "editor.css");
const jsPath = path.join(dist, "editor.js");

if (!existsSync(cssPath)) {
	// 与 runtime 同哲学：样式自携带是冻结契约，CSS 缺失意味着链路断裂，
	// 必须响亮失败而不是静默产出无样式资产
	console.error(
		"[inline-css] dist/editor.css 不存在：产物必须自携带样式，构建中止。"
		+ "（正常路径是先由 install-ojm.sh 从 plane 侧拷入 editor.js + editor.css）",
	);
	process.exit(1);
}

const css = readFileSync(cssPath, "utf-8");
const js = readFileSync(jsPath, "utf-8");
const preamble = `/* data-ojm-editor-css: 产物自携带样式（与 runtime 的 inline-css 同惯例），由 scripts/inline-css.mjs 注入 */
if (typeof document !== "undefined" && !document.querySelector("style[data-ojm-editor-css]")) {
	const s = document.createElement("style");
	s.setAttribute("data-ojm-editor-css", "");
	s.textContent = ${JSON.stringify(css)};
	document.head.appendChild(s);
}
`;
writeFileSync(jsPath, `${preamble}${js}`);
rmSync(cssPath);
console.log(`[inline-css] 已内联 ${css.length} 字节 CSS → dist/editor.js`);
