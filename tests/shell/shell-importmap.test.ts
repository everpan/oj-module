import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	collectDynamicRequires,
	collectExportGaps,
	collectUnresolvedSpecifiers,
	formatExportGap,
	readShellImportmap,
} from "../../packages/cli/src/esm-exports";
import { SHARED_DEPS } from "../../packages/cli/src/shared-deps";
import { PROJECT_ROOT } from "../helpers/paths";

const SHELL_DIST = path.join(PROJECT_ROOT, "packages/cli/shell-dist");
const RUNTIME_DIST_JS = path.join(PROJECT_ROOT, "packages/runtime/dist/runtime.js");

function readImportmap(): Record<string, string> {
	const html = fs.readFileSync(path.join(SHELL_DIST, "index.html"), "utf-8");
	// P6.2 起标签带 nonce 属性
	const match = html.match(/<script type="importmap"[^>]*>(.*?)<\/script>/s);
	expect(match, "index.html 缺少 importmap").toBeTruthy();
	return JSON.parse(match![1]).imports;
}

/**
 * P4.3：shell 预构建 + importmap 由 cli 的 SHARED_DEPS 单一来源生成，
 * 产物覆盖共享表全量（B11：手写 15 项必然漏配），runtime.js 与包 dist 一致。
 */
describe("shell 产物与 importmap（P4.3 / B11）", () => {
	it("importmap 覆盖共享表全部带 asset 条目", () => {
		const importmap = readImportmap();
		for (const dep of SHARED_DEPS) {
			expect(importmap[dep.specifier], `${dep.specifier} 无 importmap 映射`).toBeTruthy();
		}
	});

	it("每个映射的产物文件真实存在", () => {
		const importmap = readImportmap();
		for (const [specifier, url] of Object.entries(importmap)) {
			const file = path.join(SHELL_DIST, url.replace(/^\//, ""));
			expect(fs.existsSync(file), `${specifier} → ${url} 文件缺失`).toBe(true);
		}
	});

	it("runtime.js 与 runtime 包 dist 完全一致（sha256）", () => {
		const shellRuntime = fs.readFileSync(path.join(SHELL_DIST, "assets/runtime.js"));
		const pkgRuntime = fs.readFileSync(RUNTIME_DIST_JS);
		const h = (buf: string) => createHash("sha256").update(buf).digest("hex");
		expect(h(shellRuntime.toString("utf8"))).toBe(h(pkgRuntime.toString("utf8")));
	});
});

/**
 * 图标子路径默认导出（回归：tabbar 关闭 × 丢失）。
 *
 * antd 6 内部用**默认导入**引用图标：
 *   `import CloseOutlined from "@ant-design/icons/es/icons/CloseOutlined"`
 * 若这类深路径被错映射到父包资产 icons.js，default 会退化成 `@ant-design/icons`
 * 的 default —— 通用 `<Icon />` 壳（无 icon prop），渲染出空的
 * `<span class="anticon">`：关闭 ×、Typography 复制、Tabs 更多菜单等一起消失。
 *
 * 守卫：每个图标深路径必须映射到「按名取父包具名导出修正 default」的独立 shim，
 * 其源码须含该图标名（证明 default 指向具名图标组件而非通用壳）。
 */
describe("图标子路径默认导出（回归守卫）", () => {
	it("图标深路径映射到按名修正 default 的 shim，而非父包 icons.js", () => {
		const importmap = readImportmap();
		const iconEntries = Object.entries(importmap)
			.filter(([spec]) => spec.startsWith("@ant-design/icons/es/icons/"));
		expect(iconEntries.length, "importmap 应包含 antd 使用的图标深路径").toBeGreaterThan(0);
		for (const [spec, url] of iconEntries) {
			expect(url, `${spec} 不得回退到父包 icons.js（其 default 为通用 Icon 壳）`).not.toBe("/assets/icons.js");
			const file = path.join(SHELL_DIST, url.replace(/^\//, ""));
			expect(fs.existsSync(file), `${spec} → ${url} 文件缺失`).toBe(true);
			const name = spec.split("/").pop()!;
			expect(
				fs.readFileSync(file, "utf-8"),
				`${spec} 的 shim 应按名取图标组件修正 default（见 buildIconsSubpathAsset）`,
			).toContain(`["${name}"]`);
		}
	});
});

/**
 * 共享资产可加载性（R14 / A22 / A23）。
 *
 * 产物「看着正常」不等于能加载：文件在、体积对、构建退出码 0，全都不足以证明可用。
 * 实测踩到过两类静默失败，都会让整页白屏：
 *   - A22：`export *` 经 external 子路径退化，产物零具名导出
 *     → 浏览器抛 "does not provide an export named"（如 zustand/create）
 *   - A23：被打包的 CJS 依赖 require 了 external 共享包
 *     → 浏览器抛 "Dynamic require of ... is not supported"（7 个资产加载即崩）
 * 这里与 shell 构建脚本共用同一份判定实现，避免两套正则漂移。
 */
describe("共享资产可加载性（R14 / A22 / A23）", () => {
	it("每个被 import 的具名导出都能在目标资产上静态找到", () => {
		const gaps = collectExportGaps(SHELL_DIST);
		expect(
			gaps.map(formatExportGap),
			"存在浏览器会抛 \"does not provide an export named\" 的资产，"
			+ "常见根因是 export * 经 external 子路径退化（A22），请重新构建 shell",
		).toEqual([]);
	});

	it("不存在未被垫片覆盖的动态 require（A23）", () => {
		const hits = collectDynamicRequires(SHELL_DIST);
		expect(
			hits.map(h => `${h.file} → require("${h.specifier}")`),
			"存在浏览器会抛 \"Dynamic require of ... is not supported\" 的资产，"
			+ "构建期应注入 require 垫片，请重新构建 shell",
		).toEqual([]);
	});

	it("产物引用的裸说明符全部能被 importmap 解析", () => {
		const unresolved = collectUnresolvedSpecifiers(SHELL_DIST);
		expect(
			unresolved.map(g => `${g.file} → "${g.specifier}"`),
			"存在浏览器会抛 \"Failed to resolve module specifier\" 的裸说明符，"
			+ "深路径须在 SHARED_DEPS 中单独成条（importmap 无前缀通配）",
		).toEqual([]);
	});

	it("runtime.js 依赖的共享具名导出全部可解析", () => {
		const importmap = readShellImportmap(SHELL_DIST);
		// 框架产物是最大的消费方，且 A22 的第一例就是它 import 的 zustand/create
		const runtimeSource = fs.readFileSync(path.join(SHELL_DIST, "assets/runtime.js"), "utf-8");
		for (const spec of ["zustand", "react", "react-router", "antd", "react-i18next"]) {
			expect(importmap[spec], `${spec} 无 importmap 映射`).toBeTruthy();
			expect(runtimeSource, `runtime.js 应消费 ${spec}`).toContain(`from "${spec}"`);
		}
	});
});
