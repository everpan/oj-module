import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_DIR } from "../helpers/paths";

/**
 * 递归收集 runtime 源码中所有 .ts/.tsx 文件
 */
function collectRuntimeSources(): Map<string, string> {
	const files = new Map<string, string>();

	function walk(dir: string) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
			}
			else if (/\.tsx?$/.test(entry.name)) {
				files.set(path.relative(RUNTIME_DIR, fullPath), fs.readFileSync(fullPath, "utf-8"));
			}
		}
	}

	walk(RUNTIME_DIR);
	return files;
}

describe("框架内置兜底页（切断 framework → modules 反向依赖）", () => {
	it("runtime 源码中不得出现对 #web/exception 的引用", () => {
		const offenders: string[] = [];

		for (const [relativePath, content] of collectRuntimeSources()) {
			if (content.includes("#web/exception")) {
				offenders.push(relativePath);
			}
		}

		expect(
			offenders,
			`runtime 不应依赖 exception 模块（应使用框架内置兜底页）：${offenders.join(", ")}`,
		).toEqual([]);
	});

	it("框架内置 NotFound / UnknownComponent 组件必须存在且提供默认导出", () => {
		for (const componentDir of ["components/not-found", "components/unknown-component"]) {
			const entryPath = path.join(RUNTIME_DIR, componentDir, "index.tsx");
			expect(fs.existsSync(entryPath), `缺少框架内置组件 ${componentDir}/index.tsx`).toBe(true);

			const content = fs.readFileSync(entryPath, "utf-8");
			expect(
				/export default \w+/.test(content),
				`${componentDir}/index.tsx 需要默认导出以支持 lazy() 加载`,
			).toBe(true);
		}
	});

	it("兜底路由与未知组件必须指向框架内置组件", () => {
		const fallback = fs.readFileSync(path.join(RUNTIME_DIR, "router/routes/core/fallback.ts"), "utf-8");
		expect(fallback).toContain("#src/components/not-found");

		const generate = fs.readFileSync(path.join(RUNTIME_DIR, "router/utils/generate-routes-from-backend.ts"), "utf-8");
		expect(generate).toContain("#src/components/unknown-component");
	});

	it("框架 locale 必须自带兜底页所需的 exception.* 文案", () => {
		const requiredKeys = [
			"notFoundTitle",
			"notFoundSubTitle",
			"unknownComponentTitle",
			"unknownComponentSubTitle",
			// page-error 组件原本引用 t("exception.pageErrorTitle")，此前该 key 只存在于
			// exception 模块的 namespace 中（t("exception:pageErrorTitle")），属于缺失 key
			"pageErrorTitle",
		];

		for (const lang of ["zh-CN", "en-US"]) {
			const localePath = path.join(RUNTIME_DIR, "locales", lang, "exception.json");
			expect(fs.existsSync(localePath), `缺少框架 locale ${lang}/exception.json`).toBe(true);

			const locale = JSON.parse(fs.readFileSync(localePath, "utf-8"));
			for (const key of requiredKeys) {
				expect(locale[key], `${lang}/exception.json 缺少 key: ${key}`).toBeTruthy();
			}
		}
	});
});

describe("exception 模块降级为可选覆盖", () => {
	it("exception 模块仍可独立提供 /exception/* 演示路由（仅使用相对引用）", () => {
		const entry = fs.readFileSync(
			path.join(RUNTIME_DIR, "../../../web/exception/entry.ts"),
			"utf-8",
		);

		// 模块只能通过相对路径引用自己的页面，不得反向被框架硬引用
		expect(entry).toContain("./pages/404");
		expect(entry).toContain("./pages/unknown-component");
	});
});
