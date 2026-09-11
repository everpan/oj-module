/**
 * 自定义 ESM 解析钩子：把 importmap 里登记的裸说明符重定向到
 * shell 构建产物（packages/cli/shell-dist/<url>），让 node 能按浏览器
 * 的 importmap 语义加载「已构建」的宿主资产，从而真实复现生产链路。
 *
 * 仅拦截 importmap 内登记的说明符；其余裸说明符（react 子路径之外的
 * rc-* 等）交由默认解析（node_modules）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHELL_DIST = path.resolve(process.env.SHELL_DIST_DIR ?? "packages/cli/shell-dist");
const html = fs.readFileSync(path.join(SHELL_DIST, "index.html"), "utf8");
const m = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
if (!m)
	throw new Error(`${SHELL_DIST}/index.html 缺少 importmap`);
const importmap = JSON.parse(m[1]).imports;

export async function resolve(specifier, context, nextResolve) {
	if (importmap[specifier]) {
		const fileUrl = pathToFileURL(
			path.join(SHELL_DIST, importmap[specifier].replace(/^\//, "")),
		).href;
		return { url: fileUrl, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}
