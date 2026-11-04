import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseBareSpecifiers } from "../../packages/cli/src/esm-exports";
import { generateImportmap, generateShellEntries, isSharedDep, SHARED_DEPS } from "../../packages/cli/src/shared-deps";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * P4.1 / B11 / B12：共享依赖单一常量源。
 * importmap、shell 预构建入口、版本校验表全部由 SHARED_DEPS 生成，
 * 三处手写清单必然漂移（B11 实锤：importmap 15 项 vs runtime 裸导入 24+ 包）。
 */
describe("共享依赖单一常量源（P4.1 / B11）", () => {
	it("isSharedDep 命中主包与深路径", () => {
		expect(isSharedDep("react")).toBe(true);
		expect(isSharedDep("react/jsx-runtime")).toBe(true);
		expect(isSharedDep("antd")).toBe(true);
		expect(isSharedDep("antd/es/modal/confirm")).toBe(true);
		expect(isSharedDep("@dnd-kit/core")).toBe(true);
		expect(isSharedDep("some-random-pkg")).toBe(false);
	});

	it("硬共享含 @tanstack/react-query（B12）与 react 全家", () => {
		for (const specifier of ["react", "react-dom", "react-router", "@tanstack/react-query", "@oj-module/runtime"]) {
			expect(isSharedDep(specifier), specifier).toBe(true);
		}
	});

	it("runtime peerDependencies 全部命中共享表（单一来源对齐）", () => {
		const runtimePkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "packages/runtime/package.json"), "utf-8"));
		const peers = Object.keys(runtimePkg.peerDependencies);
		const missed = peers.filter(dep => !isSharedDep(dep));
		expect(missed, `runtime peer 依赖不在共享表：${missed.join(", ")}`).toEqual([]);
	});

	it("runtime 产物的全部裸说明符都能被 importmap 解析（运行期不崩）", () => {
		const source = fs.readFileSync(path.join(PROJECT_ROOT, "packages/runtime/dist/runtime.js"), "utf-8");
		// 词法扫描（es-module-lexer）：runtime 产物已压缩，行首正则不再成立
		const specifiers = parseBareSpecifiers(source);
		const importmap = generateImportmap();
		const unmapped = specifiers.filter(spec => !(spec in importmap));
		expect(unmapped, `产物裸导入无 importmap 映射：${unmapped.join(", ")}`).toEqual([]);
	});
});

describe("生成器（P4.1）", () => {
	it("shell 预构建入口排除 runtime（由 shell 拷贝其 dist）", () => {
		const entries = generateShellEntries();
		expect(entries.find(e => e.pkg === "@oj-module/runtime")).toBeUndefined();
		expect(entries.length).toBeGreaterThan(10);
	});

	it("importmap 覆盖 shell 全部预构建入口", () => {
		const importmap = generateImportmap();
		for (const entry of generateShellEntries()) {
			expect(importmap[entry.pkg], entry.pkg).toBeTruthy();
		}
	});

	it("vditor 入表但按 bundle 语义不进 importmap（软件共享，模块自带副本兜底）", () => {
		// 主入口（UMD）与 CSS（nprogress 同款样式垫片）都在共享表内，但标了 bundle：
		// 宿主不预构建、不进 importmap，模块 import 时自带副本（省宿主体积）
		expect(isSharedDep("vditor")).toBe(true);
		expect(isSharedDep("vditor/dist/index.css")).toBe(true);
		const importmap = generateImportmap();
		expect(importmap.vditor).toBeUndefined();
		expect(importmap["vditor/dist/index.css"]).toBeUndefined();
		expect(generateShellEntries().find(e => e.pkg === "vditor")).toBeUndefined();
		// 软共享：模块可声明 devDependencies 对齐版本，缺席时兜底而不硬失败（C7）
		const dep = SHARED_DEPS.find(d => d.specifier === "vditor");
		expect(dep?.hard).toBe(false);
		expect(dep?.bundle).toBe(true);
	});

	it("共享表条目均含必要字段", () => {
		for (const dep of SHARED_DEPS) {
			expect(typeof dep.specifier, JSON.stringify(dep)).toBe("string");
			expect(typeof dep.hard, JSON.stringify(dep)).toBe("boolean");
		}
	});
});
