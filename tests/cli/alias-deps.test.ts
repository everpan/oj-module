/**
 * 跨模块引用必须走 oj 原生别名 `#/<模块名>/…`，且消费方 `manifest.yaml` 的 `deps` 声明齐全。
 *
 * 为什么钉成测试而不是靠 `oj build`：`oj build` 的 S008 只在**构建时**报错，而日常改动
 * 走的是 `tsc`/vitest——两条链路口径不一致时，最典型的坏形态是「TS 侧绿、打包炸」。
 * 三条不变量一次说清：
 *   1. api 侧不得再有跨模块**相对**引用（目录一搬就断，且别名才不会随深度漂移）；
 *   2. 每个 `#/<模块名>/…` 的目标模块存在且消费方已声明 `deps`（S008 的同一口径）；
 *   3. 别名**能落到真实文件**（后缀探针 `.ts` → `/index.ts` 与 oj 的 resolve_relative 同序）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const TEMPLATES = path.join(process.cwd(), "packages/cli/templates");
const SRC = path.join(TEMPLATES, "src");

interface Module {
	/** 目录名（`src/<dir>/api`）；别名替换值的口径 */
	dir: string
	/** oj 的模块身份（manifest `name`）；别名首段的口径 */
	name: string
	deps: string[]
}

/** 枚举 `src/<dir>/api/manifest.yaml` 的模块（与 layout.ts 的判定同源） */
function modules(): Module[] {
	const out: Module[] = [];
	for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith("."))
			continue;
		const manifest = path.join(SRC, entry.name, "api", "manifest.yaml");
		if (!fs.existsSync(manifest))
			continue;
		const doc = parse(fs.readFileSync(manifest, "utf-8")) as
			{ name?: string, deps?: Record<string, string> } | null;
		out.push({
			dir: entry.name,
			name: doc?.name?.trim() || entry.name,
			deps: Object.keys(doc?.deps ?? {}),
		});
	}
	return out;
}

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules")
				walk(abs, out);
		}
		else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) {
			out.push(abs);
		}
	}
	return out;
}

/** 全部 import/export 说明符（含副作用导入） */
function specifiers(file: string): string[] {
	const text = fs.readFileSync(file, "utf-8");
	const specs = new Set<string>();
	for (const m of text.matchAll(/\bfrom\s*["']([^"']+)["']/g))
		specs.add(m[1]);
	for (const m of text.matchAll(/\bimport\s*["']([^"']+)["']/g))
		specs.add(m[1]);
	return [...specs];
}

/** 别名后缀探针：与 oj 的 resolve_relative 同序（`.ts` → `.js` → `/index.ts` → `/index.js`） */
function resolvesToFile(base: string): boolean {
	return [".ts", ".js", "/index.ts", "/index.js"]
		.some(suffix => fs.existsSync(base + suffix) && fs.statSync(base + suffix).isFile());
}

const MODULES = modules();

describe("跨模块引用走 oj 原生别名（#/<模块名>/…）", () => {
	it("api 侧没有跨模块相对引用", () => {
		const offenders: string[] = [];
		for (const mod of MODULES) {
			for (const file of walk(path.join(SRC, mod.dir, "api"))) {
				for (const spec of specifiers(file)) {
					if (!spec.startsWith("."))
						continue;
					const target = path.resolve(path.dirname(file), spec);
					const rel = path.relative(SRC, target).split(path.sep);
					// 目标不在本模块目录下 ⇒ 跨模块
					if (rel[0] !== mod.dir)
						offenders.push(`${path.relative(TEMPLATES, file)} → ${spec}`);
				}
			}
		}
		expect(offenders, `改用 #/<模块名>/<模块内路径>：\n${offenders.join("\n")}`).toEqual([]);
	});

	it("别名首段是已存在的模块，且消费方 manifest.deps 已声明", () => {
		const byName = new Map(MODULES.map(m => [m.name, m]));
		const problems: string[] = [];
		for (const mod of MODULES) {
			for (const file of walk(path.join(SRC, mod.dir, "api"))) {
				for (const spec of specifiers(file)) {
					if (!spec.startsWith("#/"))
						continue;
					const target = spec.slice(2).split("/")[0];
					const where = `${path.relative(TEMPLATES, file)} → ${spec}`;
					if (!byName.has(target)) {
						problems.push(`${where}：首段 ${target} 不是模块名（现有：${
							[...byName.keys()].sort().join(", ")}）`);
						continue;
					}
					if (target !== mod.name && !mod.deps.includes(target))
						problems.push(`${where}：${mod.dir}/api/manifest.yaml 缺 deps.${target}`);
				}
			}
		}
		expect(problems, problems.join("\n")).toEqual([]);
	});

	it("别名都能落到真实文件（后缀探针与 oj 同序）", () => {
		const byName = new Map(MODULES.map(m => [m.name, m]));
		const dead: string[] = [];
		for (const mod of MODULES) {
			for (const file of walk(path.join(SRC, mod.dir, "api"))) {
				for (const spec of specifiers(file)) {
					if (!spec.startsWith("#/"))
						continue;
					const [head, ...tail] = spec.slice(2).split("/");
					const target = byName.get(head);
					if (!target)
						continue; // 上一用例负责报「不是模块」
					const base = path.join(SRC, target.dir, "api", ...tail);
					if (!resolvesToFile(base))
						dead.push(`${path.relative(TEMPLATES, file)} → ${spec}`);
				}
			}
		}
		expect(dead, `别名指向不存在的文件（oj build 会以 S008 拒绝）：\n${dead.join("\n")}`).toEqual([]);
	});
});
