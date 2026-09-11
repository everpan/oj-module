import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { isSharedDep } from "../../packages/cli/src/shared-deps";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * P1：`ojm build` 的产出契约。
 *
 * 核心验证三件事：
 *   1. 共享依赖被 external，产物里只剩裸说明符（设计文档 D2）
 *   2. 单文件产物：无相对 chunk 引用（P7.x 契约，取代 P1/D6 的 code splitting）
 *   3. modules.json 的 integrity 正确，可供宿主做 L2 完整性校验（D7）
 */

const PLAYGROUND = path.join(PROJECT_ROOT, "apps/playground");
const DIST = path.join(PLAYGROUND, "web", "dist");
const MODULE_DIR = path.join(DIST, "modules/demo/0.1.0");

function sha384(file: string): string {
	return `sha384-${crypto.createHash("sha384").update(fs.readFileSync(file)).digest("base64")}`;
}

function jsFiles(): string[] {
	return fs.readdirSync(MODULE_DIR).filter(f => f.endsWith(".js"));
}

function specifiersOf(file: string): string[] {
	const src = fs.readFileSync(file, "utf-8");
	return [...src.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/g)]
		.map(m => m[1])
		.filter(s => !s.startsWith(".") && !s.startsWith("/"));
}

describe("ojm build 产出模块 chunk", () => {
	// modules.json 单条清单（只含本测试消费的字段）
	interface ModuleManifest {
		name: string
		version: string
		enabled: boolean
		peerRuntime: string
		entry: string
		integrity: string
		chunks: Array<{ url: string, integrity: string }>
		css: string[]
	}

	function readManifest(): ModuleManifest[] {
		return JSON.parse(fs.readFileSync(path.join(DIST, "modules.json"), "utf-8")) as ModuleManifest[];
	}

	beforeAll(() => {
		execFileSync("./node_modules/.bin/ojm", ["build"], { cwd: PLAYGROUND, stdio: "pipe" });
	}, 120_000);

	it("生成 modules.json 且字段完整", () => {
		const manifestPath = path.join(DIST, "modules.json");
		expect(fs.existsSync(manifestPath), "应生成 modules.json").toBe(true);

		// playground 登记全量仓库模块（docs/prd/202609010056）：8 个仓库模块 + demo。
		// 断言锚定 demo 模块本身而非 manifest 首项（首项随登记顺序变化）
		const mods = readManifest();
		expect(mods.length, "应包含全部登记模块").toBeGreaterThanOrEqual(9);
		expect(mods.some(m => m.name === "home"), "仓库 home 模块应在列").toBe(true);

		const mod = mods.find(m => m.name === "demo") as ModuleManifest;
		expect(mod.version).toBe("0.1.0");
		expect(mod.enabled).toBe(true);
		expect(mod.peerRuntime, "应声明 peerRuntime 供宿主校验").toBeTruthy();
		expect(mod.entry).toBe("/modules/demo/0.1.0/entry.js");
		expect(mod.integrity, "应带 sha384 完整性值").toMatch(/^sha384-/);
		expect(Array.isArray(mod.chunks), "应声明 chunks 供 L2 完整性校验").toBe(true);
		expect(Array.isArray(mod.css)).toBe(true);
	});

	it("entry 与每个 chunk 的 integrity 与文件内容一致", () => {
		const mod = readManifest().find(m => m.name === "demo") as ModuleManifest;

		expect(sha384(path.join(MODULE_DIR, "entry.js"))).toBe(mod.integrity);

		for (const chunk of mod.chunks) {
			const file = path.join(MODULE_DIR, path.basename(chunk.url));
			expect(fs.existsSync(file), `chunk 文件应存在：${chunk.url}`).toBe(true);
			expect(sha384(file), `chunk integrity 应匹配：${chunk.url}`).toBe(chunk.integrity);
		}
	});

	it("产物只保留共享裸说明符，其余全部 external", () => {
		for (const file of jsFiles()) {
			const bare = specifiersOf(path.join(MODULE_DIR, file));
			const notShared = bare.filter(s => !isSharedDep(s));
			expect(notShared, `${file} 含非共享裸说明符：${notShared.join(", ")}`).toEqual([]);
		}
	});

	it("产物不含共享依赖的实现代码", () => {
		const all = jsFiles().map(f => fs.readFileSync(path.join(MODULE_DIR, f), "utf-8")).join("\n");
		for (const marker of ["createRoot", "ant-btn", "QueryClientProvider", "react-dom.production"]) {
			expect(all, `产物不应包含 ${marker} 的实现`).not.toContain(marker);
		}
	});

	// 契约变更（P7.x）：模块产物为**单文件**（rolldownOptions.output.codeSplitting:
	// false，见 packages/cli/src/build.ts）——拆分 chunk 在非 HTTP 加载上下文无法
	// 经 import.meta.url 解析，且 lazy chunk 逃逸 L2 完整性保护；单文件整包受
	// modulepreload+integrity 覆盖。本用例由 P1 的「多 chunk + 相对路径引用」
	// 反转为「单文件 + 无相对 chunk 引用」（layout e2e 审查期发现契约过期）。
	it("单文件产物：仅 entry.js 且无相对 chunk 引用", () => {
		expect(jsFiles(), "模块产物应为单文件 entry.js").toEqual(["entry.js"]);

		const entry = fs.readFileSync(path.join(MODULE_DIR, "entry.js"), "utf-8");
		// 动态 import（lazy 页面、i18n）必须被内联，不得产出运行时相对 chunk 引用
		const relativeImports = [
			...entry.matchAll(/from\s*["'](\.[^"']+)["']/g),
			...entry.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g),
		].map(m => m[1]);
		expect(relativeImports, "产物不应引用相对 chunk").toEqual([]);
	});

	it("产物中不出现 blob: 或 data: 形式的 import", () => {
		const all = jsFiles().map(f => fs.readFileSync(path.join(MODULE_DIR, f), "utf-8")).join("\n");
		expect(all).not.toMatch(/from\s*["'](blob|data):/);
	});
});
