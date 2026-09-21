import type http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadHtmlTransform } from "../../packages/cli/src/html-transform";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * web.config.ts 的 `htmlTransform`（站点 HTML 变换模块）加载器。
 *  - 未配置 / 无 web.config.ts → undefined（零行为变化）
 *  - 相对工程根的路径 → 动态 import，default 导出即变换函数
 *  - 模块缺失 / default 非函数 → 人话报错 fail-fast，不静默降级
 */

const FIXTURE_ROOT = path.join(PROJECT_ROOT, ".tmp-fx");

function makeProject(configBody: string | null): string {
	fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
	const root = fs.mkdtempSync(path.join(FIXTURE_ROOT, "html-transform-"));
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx-proj", type: "module" }));
	if (configBody !== null)
		fs.writeFileSync(path.join(root, "web.config.ts"), configBody);
	return root;
}

const MODULES = "[{ name: \"fx\", entry: \"./web/src/fx/entry.ts\" }]";

afterAll(() => {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe("loadHtmlTransform", () => {
	it("无 web.config.ts → undefined", async () => {
		const root = makeProject(null);
		expect(await loadHtmlTransform(root)).toBeUndefined();
	});

	it("有 web.config.ts 但未配 htmlTransform → undefined", async () => {
		const root = makeProject(`export default { baseUrl: "", modules: ${MODULES} };\n`);
		expect(await loadHtmlTransform(root)).toBeUndefined();
	});

	it("相对工程根的模块被加载；path 已解码且 html 原样透传，返回值形状不变", async () => {
		const root = makeProject(`export default { baseUrl: "", modules: ${MODULES}, htmlTransform: "./html-transform.ts" };\n`);
		fs.writeFileSync(path.join(root, "html-transform.ts"), [
			"export default async function (reqPath, html) {",
			"  if (reqPath === \"/share/中文\")",
			"    return { html: html.replace(\"FRESH\", \"SHARED\"), cacheControl: \"public, max-age=60\" };",
			"  return html.replace(\"FRESH\", \"PLAIN\");",
			"}",
			"",
		].join("\n"));

		const transform = await loadHtmlTransform(root);
		expect(transform).toBeTypeOf("function");

		const req = { url: "/share/%E4%B8%AD%E6%96%87?utm=1" } as http.IncomingMessage;
		expect(await transform!(req, "<html>FRESH</html>")).toEqual({
			html: "<html>SHARED</html>",
			cacheControl: "public, max-age=60",
		});

		const plain = { url: "/other" } as http.IncomingMessage;
		expect(await transform!(plain, "<html>FRESH</html>")).toBe("<html>PLAIN</html>");
	});

	it("模块缺失 → 报错且带上 spec 与路径（不静默降级）", async () => {
		const root = makeProject(`export default { baseUrl: "", modules: ${MODULES}, htmlTransform: "./missing-transform.ts" };\n`);
		await expect(loadHtmlTransform(root)).rejects.toThrowError(/无法加载 htmlTransform 模块 "\.\/missing-transform\.ts"/);
	});

	it("default 非函数 → 报错（fail-fast）", async () => {
		const root = makeProject(`export default { baseUrl: "", modules: ${MODULES}, htmlTransform: "./not-a-fn.ts" };\n`);
		fs.writeFileSync(path.join(root, "not-a-fn.ts"), "export default { nope: true };\n");
		await expect(loadHtmlTransform(root)).rejects.toThrowError(/必须 default 导出一个函数/);
	});

	it("包名解析失败 → 报错指向工程根解析", async () => {
		const root = makeProject(`export default { baseUrl: "", modules: ${MODULES}, htmlTransform: "no-such-ojm-transform-pkg-xyz" };\n`);
		await expect(loadHtmlTransform(root)).rejects.toThrowError(/无法从工程根解析 htmlTransform 模块 "no-such-ojm-transform-pkg-xyz"/);
	});
});
