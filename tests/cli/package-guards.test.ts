import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SHARED_DEPS } from "../../packages/cli/src/shared-deps";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * P4 守卫（设计 §8.2 落地）：把「双包 + 改名」的隐式契约钉成断言，
 * 防止后续改动把已消除的风险重新引入（R5/R6/R9 + bin 双入口）。
 */

const CLI_DIR = path.join(PROJECT_ROOT, "packages/cli");
const SHELL_DIST = path.join(CLI_DIR, "shell-dist");
const RUNTIME_PKG = path.join(PROJECT_ROOT, "packages/runtime/package.json");

function readJson<T = any>(p: string): T {
	return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

const cliPkg = readJson(`${CLI_DIR}/package.json`);

describe("cli↔runtime 依赖钉版（R9）", () => {
	it("dependencies 声明 @oj-module/runtime（仓内 workspace:*，发布转精确版本）", () => {
		const spec = cliPkg.dependencies?.["@oj-module/runtime"];
		expect(spec, "cli 必须直接依赖 runtime").toBeTruthy();
		// 仓内是 workspace:*（pnpm 发布时改写为精确版本）；显式 ^/~ 会允许漂移，禁止。
		// 「发布产物里不得残留 workspace:」由 release-manifest.test.ts 真跑 pnpm pack 守护。
		expect(spec).not.toMatch(/^[\^~]/);
		expect(spec).toMatch(/^(?:workspace:\*|\d+\.\d+\.\d+)/);
	});

	it("宿主 runtime 版本 == packages/runtime 版本（D12 lockstep）", () => {
		const runtimeVersion = readJson<{ version: string }>(RUNTIME_PKG).version;
		const versions = readJson<Record<string, string>>(path.join(SHELL_DIST, "versions.json"));
		expect(versions["@oj-module/runtime"]).toBe(runtimeVersion);
		expect(versions["@oj-module/runtime/contract"]).toBe(runtimeVersion);
		expect(versions["@oj-module/runtime/contract/errors"]).toBe(runtimeVersion);
	});
});

describe("cli bin 双入口（R1）", () => {
	it("bin 同时提供 ojm 主入口与弃用 ram 别名，且文件存在", () => {
		expect(cliPkg.bin.ojm).toBe("./bin/ojm.mjs");
		expect(cliPkg.bin.ram).toBe("./bin/ram.mjs");
		expect(fs.existsSync(path.join(CLI_DIR, cliPkg.bin.ojm))).toBe(true);
		expect(fs.existsSync(path.join(CLI_DIR, cliPkg.bin.ram))).toBe(true);
	});

	it("ram shim 打印更名警告并转发到 ojm", () => {
		const shim = fs.readFileSync(path.join(CLI_DIR, cliPkg.bin.ram), "utf-8");
		expect(shim).toContain("已更名为");
		expect(shim).toContain("./ojm.mjs");
	});
});

describe("宿主产物矩阵（§8.2）", () => {
	it("shell-dist/versions.json 存在且覆盖共享表已安装项", () => {
		expect(fs.existsSync(path.join(SHELL_DIST, "versions.json"))).toBe(true);
		const versions = readJson<Record<string, string>>(path.join(SHELL_DIST, "versions.json"));
		// 硬共享（破坏即崩溃）必须逐条落进矩阵，缺一条即版本门禁失真
		for (const dep of SHARED_DEPS.filter(d => d.hard))
			expect(versions[dep.specifier], `版本矩阵缺硬共享 ${dep.specifier}`).toBeTruthy();
	});
});

describe("发布内容守卫（R8 / US-7）", () => {
	it("runtime files 只含 dist（不含 src/contract 源），dist 内无 .ts 源", () => {
		const pkg = readJson<{ files: string[] }>(RUNTIME_PKG);
		expect(pkg.files).toEqual(["dist"]);
		const dist = path.join(PROJECT_ROOT, "packages/runtime/dist");
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				// .d.ts 是声明产物；裸 .ts/.tsx 源不得进发布包
				if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
					offenders.push(path.relative(dist, full));
			}
		};
		walk(dist);
		expect(offenders, `runtime dist 含 .ts 源：${offenders.join(", ")}`).toEqual([]);
	});

	it("cli files 含内置宿主 shell-dist 与 bin，且排除 shell-dist 的 sourcemap", () => {
		expect(cliPkg.files).toEqual(expect.arrayContaining(["bin", "shell-dist", "src", "templates", "vendor"]));
		// sourcemap 仅供内部栈解析不发版；npm 的 files 白名单无法被 .npmignore 排除，
		// 必须用取反模式，且 **npm 按顺序应用、后者优先** → 取反须排在 shell-dist 之后
		expect(cliPkg.files).toContain("!shell-dist/**/*.map");
		expect(cliPkg.files.indexOf("!shell-dist/**/*.map")).toBeGreaterThan(cliPkg.files.indexOf("shell-dist"));
	});

	it("runtime 的 imports 不逃出包边界（只留 #src/*）", () => {
		const pkg = readJson<{ imports?: Record<string, string> }>(RUNTIME_PKG);
		// #modules/*、#manifest.json 曾指向 ../../（包外路径），已迁到仓库 vite 配置解析
		expect(Object.keys(pkg.imports ?? {})).toEqual(["#src/*"]);
	});
});

describe("cli 的 Node/浏览器边界（R6 硬分区）", () => {
	const NODE_ONLY = [".", "./build", "./shared-deps", "./esm-exports", "./config", "./manifest", "./info"];

	it("node-only 子路径挂 browser 守护条件，shell-dist 浏览器资产不加", () => {
		for (const key of NODE_ONLY) {
			const entry = cliPkg.exports[key];
			expect(entry, `${key} 缺 browser 条件`).toMatchObject({ browser: "./src/browser-guard.ts" });
			expect(String(entry.default), `${key} 的 default 应指向 src 源码`).toMatch(/^\.\/src\/.+\.ts$/);
		}
		// shell-dist/* 就是浏览器资产（经 HTTP 路径消费），不应被拦
		expect(cliPkg.exports["./shell-dist/*"]).toBe("./shell-dist/*");
		expect(fs.existsSync(path.join(CLI_DIR, "src/browser-guard.ts"))).toBe(true);
	});

	it("浏览器条件指向的守护模块确实抛错（误用即刻可见）", async () => {
		await expect(import("../../packages/cli/src/browser-guard.ts")).rejects.toThrow(/Node 工具链包/);
	});
});

describe("模块源码不得 import cli（R6）", () => {
	const moduleRoots = [
		path.join(PROJECT_ROOT, "apps/playground/modules/src"),
		path.join(PROJECT_ROOT, "apps/playground-oj/modules/src"),
		// 根 App 链自己的模块目录（架构评审：vite alias 也把它当模块树，此前漏检）
		path.join(PROJECT_ROOT, "modules/src"),
		path.join(CLI_DIR, "templates/modules/src"),
	];

	function collect(dir: string): string[] {
		if (!fs.existsSync(dir))
			return [];
		return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const full = path.join(dir, entry.name);
			return entry.isDirectory() ? collect(full) : [full];
		});
	}

	it("零 import @oj-module/cli/*（Node 工具链面不得进浏览器产物）", () => {
		const offenders: string[] = [];
		for (const root of moduleRoots) {
			for (const file of collect(root).filter(f => /\.(?:ts|tsx|js|jsx|mjs)$/.test(f))) {
				const src = fs.readFileSync(file, "utf-8");
				if (/["'`]@oj-module\/cli[/"'`]/.test(src))
					offenders.push(path.relative(PROJECT_ROOT, file));
			}
		}
		expect(offenders, `模块源码不得 import cli：${offenders.join(", ")}`).toEqual([]);
	});
});

describe("旧 scope 零残留（R7）", () => {
	// 允许留旧名的例外：历史归档（下方跳过 docs/archive）、记录本次迁移的设计文档与手册，
	// 以及本测试自身（断言里含旧 scope 字面量）
	const EXEMPT = new Set([
		path.join(PROJECT_ROOT, "docs/prd/202609110947-oj-module-two-package-consolidation-design.md"),
		path.join(PROJECT_ROOT, "docs/prd/framework-development-guide.md"),
		path.join(PROJECT_ROOT, "tests/cli/package-guards.test.ts"),
	]);
	const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "shell-dist", "coverage", "analyzer", ".e2e-legacy", "playwright-report", "test-results"]);
	const TEXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|md|html|txt|sql|css)$/;

	function walk(dir: string, hit: string[]): void {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name))
					continue;
				// docs/archive 保留历史改名痕迹，不回写
				if (path.relative(PROJECT_ROOT, full) === "docs/archive")
					continue;
				walk(full, hit);
				continue;
			}
			if (!TEXT.test(entry.name) || EXEMPT.has(full))
				continue;
			if (fs.readFileSync(full, "utf-8").includes("@react-antd-module"))
				hit.push(path.relative(PROJECT_ROOT, full));
		}
	}

	it("全仓零 @react-antd-module（docs/archive 与迁移设计文档除外）", () => {
		const offenders: string[] = [];
		walk(PROJECT_ROOT, offenders);
		expect(offenders, `旧 scope 残留：${offenders.join(", ")}`).toEqual([]);
	});
});
