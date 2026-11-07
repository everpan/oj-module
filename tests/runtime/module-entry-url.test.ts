// BDD：modules.json 条目 entry 的根绝对路径契约（2026-11-07 hotfix）。
// 浏览器 module-loader 裸 import(entry.entry)：条目必须是根绝对路径
// （`/modules/...`，同源码树构建 module-build.ts 产物形态）。安装器链历史产出
// 无前导斜杠形态（preflight C2-27 的包内相对路径透传），浏览器端
// `Failed to resolve module specifier` 致已装方案（含出厂即装 oj-market）
// 无菜单/页面——HTTP 探活（entry.js 200）不可见，只有浏览器加载面暴露。
// resolveModuleEntryUrl = 加载前归一：无斜杠补根斜杠；http(s)/// 外部 URL 原样。
import { describe, expect, it } from "vitest";

import { resolveModuleEntryUrl } from "#src/module-loader";

describe("resolveModuleEntryUrl（条目 URL 归一契约）", () => {
	it("无前导斜杠的条目补根斜杠（安装器 legacy 形态即刻愈合）", () => {
		expect(resolveModuleEntryUrl("modules/oj-market/0.2.0/entry.js"))
			.toBe("/modules/oj-market/0.2.0/entry.js");
	});

	it("已合规的根绝对路径原样返回", () => {
		expect(resolveModuleEntryUrl("/modules/app/0.1.0/entry.js"))
			.toBe("/modules/app/0.1.0/entry.js");
	});

	it("外部 URL（http/https/file: 等带 scheme 与 protocol-relative）不做根斜杠改写", () => {
		expect(resolveModuleEntryUrl("https://cdn.example.com/m/1.0.0/entry.js"))
			.toBe("https://cdn.example.com/m/1.0.0/entry.js");
		expect(resolveModuleEntryUrl("//cdn.example.com/m/1.0.0/entry.js"))
			.toBe("//cdn.example.com/m/1.0.0/entry.js");
		expect(resolveModuleEntryUrl("file:///fixtures/m/1.0.0/entry.tsx"))
			.toBe("file:///fixtures/m/1.0.0/entry.tsx");
	});
});
