import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	extractImportmap,
	findRuntimeChunk,
	parseExportNames,
	rewriteImportmapBase,
} from "../../scripts/inject-importmap";

const shellHtml = `<!doctype html><html><head>
<script type="importmap">{"imports":{"react":"/assets/react.js","antd":"/assets/antd.js"}}</script>
</head><body></body></html>`;

describe("extractImportmap", () => {
	it("t1: 从 html 提取 imports", () => {
		expect(extractImportmap(shellHtml)).toEqual({
			react: "/assets/react.js",
			antd: "/assets/antd.js",
		});
	});
	it("t2: 无 importmap 时抛错", () => {
		expect(() => extractImportmap("<html><head></head></html>")).toThrow(/importmap/);
	});
});

describe("rewriteImportmapBase", () => {
	it("t3: /assets/ 前缀改写为部署 base", () => {
		expect(rewriteImportmapBase({ react: "/assets/react.js" }, "/react-antd-admin/"))
			.toEqual({ react: "/react-antd-admin/assets/react.js" });
	});
	it("t4: 根部署不改写", () => {
		expect(rewriteImportmapBase({ react: "/assets/react.js" }, "/"))
			.toEqual({ react: "/assets/react.js" });
	});
});

describe("parseExportNames", () => {
	it("t5: 解析 minify 产物 export 段的 as 别名与裸标识符", () => {
		const src = "import{a as x}from\"react\";export{a as getRoutes,b as loadAll,plain};";
		expect(parseExportNames(src)).toEqual(new Set(["getRoutes", "loadAll", "plain"]));
	});
	it("t6: 无导出返回空集", () => {
		expect(parseExportNames("import\"react\";")).toEqual(new Set());
	});
});

describe("findRuntimeChunk", () => {
	const dir = join(tmpdir(), "ojm-test-runtime-chunk");

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("t7: 命中含冻结出口的 runtime-*.js", () => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "runtime-AbC123.js"), "import{a}from\"c\";export{a as loadAll,x as getRoutes};");
		writeFileSync(join(dir, "index-XYZ.js"), "export{b as loadAll};");
		expect(findRuntimeChunk(dir)).toBe("runtime-AbC123.js");
	});
	it("t8: 缺关键出口的 runtime-*.js 不算数（tree-shake 防线）", () => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "runtime-empty.js"), "export{c as small};");
		expect(findRuntimeChunk(dir)).toBeNull();
	});
	it("t9: 目录不存在返回 null", () => {
		expect(findRuntimeChunk(join(dir, "missing"))).toBeNull();
	});
});
