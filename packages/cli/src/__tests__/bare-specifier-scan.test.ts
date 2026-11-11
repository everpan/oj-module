import { describe, expect, it } from "vitest";
import { collectBareSpecifiersFromSource } from "../build/module-build";

/**
 * 回归：产物 chunk 是压缩/混淆文本，字符串里的 import 字样不得被当成语句捕获
 *  （曾把压缩源码片段当「共享表外三方库名」打印——issue 2026-11 ojm build 告警乱码）。
 */
describe("collectBareSpecifiersFromSource 裸说明符扫描（BDD）", () => {
	it("真实 ESM import/export/动态导入的说明符被提取（含紧缩 minify 形态）", () => {
		const src = [
			"import { z } from \"zod\";",
			"import{q as r}from\"antd\";",
			"import\"polydock\";",
			"export{util as u}from\"./util.js\";",
			"const schemas = await import(\"./api.schemas\");",
			"import { x } from \"dayjs/plugin/utc\";",
		].join("\n");
		expect(collectBareSpecifiersFromSource(src).sort()).toEqual(
			["antd", "dayjs/plugin/utc", "polydock", "zod"].sort(),
		);
	});

	it("字符串内容里的 import 字样（…import\"、import 'zod' 示例文案）不产生捕获", () => {
		const src = [
			"console.warn(\"跨模块请勿直接动态 import\");",
			"let n = await t.post(\"auth/login\", { json: e }).json();",
			"if (typeof n.code == \"number\" && n.code !== 0) throw new Ve(n.code, n.msg ?? \"业务错误\");",
			"const tip = \"请改用 import 'zod' 懒加载\";",
		].join("\n");
		const specs = collectBareSpecifiersFromSource(src);
		expect(specs).toEqual([]);
		for (const s of specs) expect(s).not.toMatch(/[({;]\s|\n/);
	});

	it("注释与模板字符串中的 import 语句不产生捕获；import.meta 不是导入", () => {
		const src = [
			"// import x from \"fake-comment\";",
			"/* from \"fake-block\" */",
			"const s = `see import \"zod\" in template`;",
			"if (import.meta.env.DEV) { const { schemas } = await import(\"./api.schemas\"); }",
			"const url = import.meta.url;",
		].join("\n");
		expect(collectBareSpecifiersFromSource(src)).toEqual([]);
	});

	it("相对/绝对/# 说明符不入集（C8 只关心三方裸说明符）", () => {
		const src = [
			"import { a } from \"./api.schemas\";",
			"import b from \"/abs/path\";",
			"import c from \"#internals\";",
			"const d = await import(\"@oj-module/runtime/contract/errors\");",
		].join("\n");
		expect(collectBareSpecifiersFromSource(src)).toEqual(["@oj-module/runtime/contract/errors"]);
	});
});
