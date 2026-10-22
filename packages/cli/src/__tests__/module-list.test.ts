// 前端模块清单 spec（设计 D3：扫描为准 + web.config.ts 可选覆盖）。
//
// 关键不变量是**并集而不是替换**：新增一个模块目录后忘了登记，也必须被构建；
// 反过来登记了一个已经不存在的目录，必须报错而不是静默少一个模块。
import { describe, expect, it } from "vitest";

import { mergeModuleList } from "../config";

const ROOT = "/proj";

function scanned(...names: string[]) {
	return names.map(name => ({ name, webSrc: `${ROOT}/src/${name}/web` }));
}

describe("mergeModuleList", () => {
	it("无覆盖时按扫描顺序（layout 已按名字排序）", () => {
		expect(mergeModuleList(scanned("about", "home", "wiki"), undefined, ROOT)).toEqual([
			{ name: "about", entry: "src/about/web/entry.ts", enabled: true },
			{ name: "home", entry: "src/home/web/entry.ts", enabled: true },
			{ name: "wiki", entry: "src/wiki/web/entry.ts", enabled: true },
		]);
	});

	it("覆盖项按声明顺序排前，未登记的按扫描顺序追加（并集）", () => {
		const list = mergeModuleList(scanned("about", "home", "wiki"), [
			{ name: "home", entry: "ignored" },
			{ name: "wiki", entry: "ignored" },
		], ROOT);
		expect(list.map(m => m.name)).toEqual(["home", "wiki", "about"]);
	});

	it("enabled:false 仍生效（覆盖项与未登记项都按自己的声明走）", () => {
		const list = mergeModuleList(scanned("about", "home"), [
			{ name: "home", entry: "x", enabled: false },
		], ROOT);
		expect(list).toEqual([
			{ name: "home", entry: "src/home/web/entry.ts", enabled: false },
			{ name: "about", entry: "src/about/web/entry.ts", enabled: true },
		]);
	});

	it("登记了不存在的模块 → 报错并提示以目录为准", () => {
		expect(() => mergeModuleList(scanned("home"), [
			{ name: "gone", entry: "src/gone/web/entry.ts" },
		], ROOT)).toThrow(/src\/gone\/web\/entry\.ts 不存在/);
	});

	it("纯后端模块（无 web/entry.ts）不进前端清单", () => {
		const list = mergeModuleList([
			{ name: "auth" }, // 纯后端：只有 api/manifest.yaml，扫描结果没有 webSrc
			{ name: "home", webSrc: `${ROOT}/src/home/web` },
		], undefined, ROOT);
		expect(list.map(m => m.name)).toEqual(["home"]);
	});

	it("登记一个纯后端模块也算错（该目录没有前端入口）", () => {
		expect(() => mergeModuleList([
			{ name: "auth" },
		], [{ name: "auth", entry: "x" }], ROOT)).toThrow(/不存在/);
	});

	it("entry 用相对工程根的路径（与 web.config.ts 历史口径一致）", () => {
		const [only] = mergeModuleList(scanned("wiki"), [{ name: "wiki", entry: "/abs/should-be-ignored" }], ROOT);
		expect(only.entry).toBe("src/wiki/web/entry.ts");
	});
});
