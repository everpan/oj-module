import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 布局 A（`src/<name>/{api,web}`）的 tsconfig 覆盖不变量。
 *
 * 单树布局下"前后端分面"只能靠 `exclude` 表达，而负向 glob 最容易踩的坑是命中了
 * **同名的模块目录**：宽 glob（任意层 `web`）会把「模块名就叫 web」的 `src/web/api`
 * 整棵排除（实测漏检 3 个后端文件，`typecheck:api` 依然全绿）；同理任意层 `api`
 * 会连带排除 `src/oj-market/web/api`（只因被 entry 引用才侥幸回到图里）。
 *
 * 所以钉行为而不是钉字面量：两侧 `tsc --listFiles` 的**并集 = src 下全部 TS 源文件**、
 * **交集 = 空**。以后调 exclude、加模块、换布局，只要漏检或重复检都会在这里炸。
 */

const TEMPLATES = path.join(process.cwd(), "packages/cli/templates");

/** eslint/ts 之外的杂项扩展：`.d.ts` 也算 TS 源（如生成的声明），一并要求被覆盖 */
const SOURCE_EXT = /\.(?:ts|tsx|mts|cts)$/;

function listFiles(configRel: string): Set<string> {
	const tsc = path.join(process.cwd(), "node_modules/typescript/bin/tsc");
	const out = execFileSync(process.execPath, [
		tsc,
		"-p",
		path.join(TEMPLATES, configRel),
		"--noEmit",
		"--listFiles",
	], { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
	const files = new Set<string>();
	for (const line of out.split("\n")) {
		const p = line.trim();
		if (!path.isAbsolute(p) || !p.startsWith(TEMPLATES))
			continue;
		const rel = path.relative(TEMPLATES, p).split(path.sep).join("/");
		// 只看 src/：工程根的 global.d.ts / env.d.ts 是两侧共用的环境声明，本来就在两个工程里
		if (rel.startsWith("src/"))
			files.add(rel);
	}
	return files;
}

function allSources(): Set<string> {
	const out = new Set<string>();
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(p);
				continue;
			}
			if (SOURCE_EXT.test(entry.name))
				out.add(path.relative(TEMPLATES, p).split(path.sep).join("/"));
		}
	};
	walk(path.join(TEMPLATES, "src"));
	return out;
}

describe("模板 tsconfig 覆盖不变量（布局 A：src/<name>/{api,web}）", () => {
	it("web/api 两侧 typecheck 的并集覆盖 src 下全部 TS 源文件，且交集为空", () => {
		const web = listFiles("tsconfig.json");
		const api = listFiles("src/tsconfig.json");
		const sources = allSources();

		const covered = new Set([...web, ...api]);
		const missing = [...sources].filter(f => !covered.has(f)).sort();
		const overlap = [...web].filter(f => api.has(f)).sort();

		expect(missing, `这些文件两个 typecheck 工程都没覆盖：\n${missing.join("\n")}`).toEqual([]);
		expect(overlap, `这些文件被两个工程重复检查：\n${overlap.join("\n")}`).toEqual([]);
	}, 120_000);

	/**
	 * 定向回归：模块名与布局分隔符撞名（`web` 模块的后端、`oj-market` 前端里叫 api 的目录）。
	 * 这两个都不是假想形态——模板里就有，且都曾被宽 glob 误伤过。
	 */
	it("同名目录不被对面一侧的排除规则误伤（src/web/api、src/oj-market/web/api）", () => {
		const api = listFiles("src/tsconfig.json");
		const web = listFiles("tsconfig.json");

		expect(api).toContain("src/web/api/user-info/api.ts");
		expect(web).toContain("src/oj-market/web/api/defaultClient.ts");
		// 反向：两侧各只收自己那一面（路径形如 src/<name>/api|web/…）
		expect([...api].filter(f => f.split("/")[2] !== "api")).toEqual([]);
		expect([...web].filter(f => f.split("/")[2] !== "web")).toEqual([]);
	}, 120_000);
});
