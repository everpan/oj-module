import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "../helpers/paths";

const RUNTIME_DIST = path.join(PROJECT_ROOT, "packages/runtime/dist");

describe("runtime 声明产物（P3.5 载体）", () => {
	it("dist/index.d.ts 存在（d.ts 生成未被 TS2883/TS4023 阻断）", () => {
		expect(fs.existsSync(path.join(RUNTIME_DIST, "index.d.ts"))).toBe(true);
	});

	it("入口声明导出 getAppInfo（出口冻结载体包含 P2.6 API）", () => {
		const dts = fs.readFileSync(path.join(RUNTIME_DIST, "index.d.ts"), "utf-8");
		expect(dts).toContain("getAppInfo");
	});

	it("package.json exports 的 types 指向真实存在的声明文件", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "packages/runtime/package.json"), "utf-8"));
		const typesPath = pkg.exports["."].types.replace("./", "");
		expect(fs.existsSync(path.join(PROJECT_ROOT, "packages/runtime", typesPath))).toBe(true);
	});
});

/**
 * P3.5 收尾：取消 private、包元数据定稿。
 * 出口树裁剪 = exports 只开主入口（"."），dist 内其余目录（layout/router 内部
 * 模块等）不作为子路径出口暴露；内部性由不导出保证，而非额外标注。
 */
describe("runtime 包元数据定稿（P3.5）", () => {
	function readRuntimePkg() {
		return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "packages/runtime/package.json"), "utf-8"));
	}

	it("取消 private: true（具备发版资格）", () => {
		expect(readRuntimePkg().private).toBeUndefined();
	});

	it("files 含 dist 且 exports 开放主入口 + contract 子路径（P1 契约并入）", () => {
		const pkg = readRuntimePkg();
		expect(pkg.files).toContain("dist");
		expect(Object.keys(pkg.exports)).toEqual([".", "./contract", "./contract/errors"]);
	});

	it("contract 子路径产物齐全（dist/contract，US-7：包内无 .ts 源）", () => {
		for (const rel of ["contract/index.js", "contract/index.d.ts", "contract/errors.js", "contract/errors.d.ts"])
			expect(fs.existsSync(path.join(RUNTIME_DIST, rel)), `缺少 ${rel}`).toBe(true);
		expect(fs.existsSync(path.join(PROJECT_ROOT, "packages/runtime/contract/index.ts"))).toBe(true); // 源仍在仓内
	});

	it("peerDependencies 覆盖 dist/runtime.js 全部 bare 外部导入（防漂移）", () => {
		const pkg = readRuntimePkg();
		const peers = new Set(Object.keys(pkg.peerDependencies ?? {}));

		const source = fs.readFileSync(path.join(PROJECT_ROOT, "packages/runtime/dist/runtime.js"), "utf-8");
		// 仅匹配 import/export 语句（jsdoc 注释文本里的 "#src/..." 示例不算导入）
		const specifiers = [...source.matchAll(/^\s*(?:import|export)[^;]*?from\s*"([^"]+)"/gm)]
			.map(m => m[1])
			.filter(spec => !spec.startsWith(".") && !spec.startsWith("/"));
		// bare 说明符归一为包名：react/jsx-runtime → react，@dnd-kit/core 保持
		// 自引用子路径（@oj-module/runtime/contract/errors）由本包 exports
		// 提供，不属于 peerDependencies（不能声明自己）
		const packages = new Set(
			specifiers
				.map(spec => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0])
				.filter(name => name !== "@oj-module/runtime"),
		);

		const uncovered = [...packages].filter(name => !peers.has(name));
		expect(uncovered, `产物裸导入未声明进 peerDependencies：${uncovered.join(", ")}`).toEqual([]);
	});
});
