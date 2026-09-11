import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectPreloads } from "../../packages/cli/shell/src/preload";
import { PROJECT_ROOT } from "../helpers/paths";

const MODULES = [
	{
		name: "a",
		entry: "a/1.0.0/entry.js",
		integrity: "sha384-AAA",
		css: [],
		chunks: [
			{ url: "a/1.0.0/entry.js", integrity: "sha384-AAA", lazy: false },
			{ url: "a/1.0.0/chunk-XYZ.lazy.js", integrity: "sha384-BBB", lazy: true },
		],
	},
	{
		name: "b",
		entry: "b/1.0.0/entry.js",
		integrity: "sha384-CCC",
		css: [],
		chunks: [
			{ url: "b/1.0.0/entry.js", integrity: "sha384-CCC", lazy: false },
			{ url: "b/1.0.0/entry.js", integrity: "sha384-CCC", lazy: false },
		],
	},
];

/**
 * P5.7 / L2 完整性（设计文档 §4.7）：宿主消费 modules.json 中的
 * chunks[].integrity（sha384，cli 构建期产出），为非 lazy chunk 注入
 * modulepreload + integrity + crossorigin；lazy chunk 跳过（D7 按需）。
 */
describe("host L2 完整性预加载（P5.7）", () => {
	it("非 lazy chunk 进入预载列表并携带 integrity", () => {
		expect(collectPreloads(MODULES)).toEqual([
			{ href: "a/1.0.0/entry.js", integrity: "sha384-AAA" },
			{ href: "b/1.0.0/entry.js", integrity: "sha384-CCC" },
		]);
	});

	it("lazy chunk 不预载（D7：懒加载资源不受 L2 档位保护）", () => {
		const hrefs = collectPreloads(MODULES).map(p => p.href);
		expect(hrefs).not.toContain("a/1.0.0/chunk-XYZ.lazy.js");
	});

	it("重复 URL 只预载一次", () => {
		const hrefs = collectPreloads(MODULES).map(p => p.href);
		expect(hrefs.filter(h => h === "b/1.0.0/entry.js")).toHaveLength(1);
	});

	it("宿主以 modulepreload + integrity + crossorigin 注入", () => {
		const source = await_source();
		expect(source).toContain("modulepreload");
		expect(source).toContain("link.integrity");
		expect(source).toContain("crossOrigin");
	});
});

function await_source(): string {
	return fs.readFileSync(path.join(PROJECT_ROOT, "packages/cli/shell/src/host.tsx"), "utf-8");
}
