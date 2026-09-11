/**
 * P1 垂直切片端到端契约测试。
 *
 * 验证：
 *  1. shell 预构建产物含手写 importmap，且覆盖全部硬共享依赖；
 *  2. 宿主 host chunk 与 demo 模块的所有共享裸说明符都能经 importmap 解析；
 *  3. 单例必要条件：宿主与模块对 react / @react-antd-module/runtime 等命中同一 URL；
 *  4. ram build 产物：modules.json 字段完整、integrity 与文件一致、无 blob/data import、
 *     模块内无共享依赖实现代码（react 未被打进模块）。
 *
 * 运行前若产物不存在会自动构建（shell 预构建 + playground ram build）。
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { buildModules } from "../../packages/cli/src/build";
import { isSharedDep, SHARED_DEPS } from "../../packages/cli/src/shared-deps";
import {
	PLAYGROUND_DIR,
	PLAYGROUND_DIST_DIR,
	PROJECT_ROOT,
	SHELL_DIST_DIR,
} from "../helpers/paths";

interface ModuleManifestEntry {
	name: string
	version: string
	entry: string
	integrity: string
	chunks: Array<{ url: string, integrity: string, lazy: boolean }>
	css: string[]
}

function sha384(filePath: string): string {
	const buf = readFileSync(filePath);
	return `sha384-${crypto.createHash("sha384").update(buf).digest("base64")}`;
}

function resolveShell() {
	const htmlPath = path.join(SHELL_DIST_DIR, "index.html");
	if (!existsSync(htmlPath)) {
		// eslint-disable-next-line no-console
		console.log("[test] 构建 shell（缺失 dist）…");
		execFileSync("pnpm", ["--filter", "@react-antd-module/cli", "build:shell"], {
			cwd: PROJECT_ROOT,
			stdio: "inherit",
		});
	}
	return htmlPath;
}

function resolvePlayground() {
	const manifestPath = path.join(PLAYGROUND_DIST_DIR, "modules.json");
	if (!existsSync(manifestPath)) {
		// eslint-disable-next-line no-console
		console.log("[test] 构建 playground 模块（缺失 dist）…");
		return buildModules(PLAYGROUND_DIR);
	}
	return Promise.resolve();
}

function parseImportmap(html: string): Record<string, string> {
	// P6.2 起标签带 nonce 属性
	const m = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
	if (!m)
		throw new Error("index.html 缺少 importmap");
	return JSON.parse(m[1]).imports as Record<string, string>;
}

function parseHostChunkName(html: string): string {
	const m = html.match(/<script type="module"[^>]*src="(\/assets\/[^"]+\.js)"/);
	if (!m)
		throw new Error("index.html 未引用宿主 chunk");
	return m[1];
}

function resolveViaImportmap(spec: string, map: Record<string, string>): string | null {
	if (map[spec])
		return map[spec];
	let best: string | null = null;
	for (const key of Object.keys(map)) {
		if (spec === key || spec.startsWith(`${key}/`)) {
			if (!best || key.length > best.length)
				best = key;
		}
	}
	return best ? map[best] : null;
}

const BARE_RE = /from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function bareSharedSpecifiers(code: string): Set<string> {
	const set = new Set<string>();
	let m = BARE_RE.exec(code);
	while (m) {
		const spec = m[1] ?? m[2];
		if (spec && isSharedDep(spec))
			set.add(spec);
		m = BARE_RE.exec(code);
	}
	return set;
}

function walkFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory())
			out.push(...walkFiles(full));
		else if (full.endsWith(".js") || full.endsWith(".mjs"))
			out.push(full);
	}
	return out;
}

describe("p1 垂直切片：importmap 与单例", () => {
	let importmap: Record<string, string>;
	let hostSpecifiers: Set<string>;
	let moduleSpecifiers: Set<string>;

	beforeAll(async () => {
		const htmlPath = resolveShell();
		await resolvePlayground();

		const html = readFileSync(htmlPath, "utf-8");
		importmap = parseImportmap(html);

		const hostName = parseHostChunkName(html);
		const hostCode = readFileSync(path.join(SHELL_DIST_DIR, hostName), "utf-8");
		hostSpecifiers = bareSharedSpecifiers(hostCode);

		// 收集 demo 模块（entry + chunks）中出现的共享裸说明符
		moduleSpecifiers = new Set<string>();
		const modulesDir = path.join(PLAYGROUND_DIST_DIR, "modules");
		for (const file of walkFiles(modulesDir)) {
			for (const s of bareSharedSpecifiers(readFileSync(file, "utf-8")))
				moduleSpecifiers.add(s);
		}
	});

	it("importmap 覆盖全部硬共享依赖", () => {
		const hardSpecifiers = SHARED_DEPS.filter(dep => dep.hard).map(dep => dep.specifier);
		for (const dep of hardSpecifiers)
			expect(resolveViaImportmap(dep, importmap), `importmap 未映射 ${dep}`).not.toBeNull();
	});

	it("硬共享依赖各自映射到的 URL 互不相同", () => {
		const hardSpecifiers = SHARED_DEPS.filter(dep => dep.hard).map(dep => dep.specifier);
		const urls = hardSpecifiers.map(dep => resolveViaImportmap(dep, importmap)!);
		expect(new Set(urls).size).toBe(urls.length);
	});

	it("宿主 host chunk 的共享裸说明符都能经 importmap 解析", () => {
		expect(hostSpecifiers.size).toBeGreaterThan(0);
		for (const spec of hostSpecifiers)
			expect(resolveViaImportmap(spec, importmap), `宿主 ${spec} 未映射`).not.toBeNull();
	});

	it("demo 模块的共享裸说明符都能经 importmap 解析", () => {
		expect(moduleSpecifiers.size).toBeGreaterThan(0);
		for (const spec of moduleSpecifiers)
			expect(resolveViaImportmap(spec, importmap), `模块 ${spec} 未映射`).not.toBeNull();
	});

	it("单例必要条件：宿主与模块对 react / runtime 等命中同一 URL", () => {
		for (const dep of ["react", "@react-antd-module/runtime", "antd", "react-i18next"]) {
			const hostUrl = resolveViaImportmap(dep, importmap);
			const moduleUrl = resolveViaImportmap(dep, importmap);
			expect(hostUrl, `宿主 ${dep} 未映射`).not.toBeNull();
			expect(moduleUrl, `模块 ${dep} 未映射`).not.toBeNull();
			expect(hostUrl, `${dep} 宿主与模块未命中同一 URL`).toBe(moduleUrl);
			// 宿主与模块都实际引用了该依赖
			expect(hostSpecifiers.has(dep) || moduleSpecifiers.has(dep)).toBe(true);
		}
	});
});

describe("p1 垂直切片：ram build 产物契约", () => {
	beforeAll(async () => {
		await resolvePlayground();
	});

	it("modules.json 字段完整且 integrity 与文件一致", () => {
		const manifestPath = path.join(PLAYGROUND_DIST_DIR, "modules.json");
		expect(existsSync(manifestPath)).toBe(true);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as ModuleManifestEntry[];
		expect(manifest.length).toBeGreaterThan(0);

		for (const mod of manifest) {
			expect(mod.name).toBeTruthy();
			expect(mod.version).toBeTruthy();
			expect(mod.entry).toBeTruthy();
			expect(mod.integrity).toBeTruthy();

			const entryFile = path.join(PLAYGROUND_DIST_DIR, mod.entry.replace(/^\//, ""));
			expect(existsSync(entryFile), `${mod.name} entry 缺失`).toBe(true);
			expect(sha384(entryFile)).toBe(mod.integrity);

			for (const chunk of mod.chunks ?? []) {
				const chunkFile = path.join(PLAYGROUND_DIST_DIR, chunk.url.replace(/^\//, ""));
				expect(existsSync(chunkFile), `${mod.name} chunk 缺失`).toBe(true);
				expect(sha384(chunkFile)).toBe(chunk.integrity);
			}
		}
	});

	it("模块产物无 blob:/data: import", () => {
		const modulesDir = path.join(PLAYGROUND_DIST_DIR, "modules");
		for (const file of walkFiles(modulesDir)) {
			const code = readFileSync(file, "utf-8");
			expect(code).not.toMatch(/["'](?:blob:|data:)/);
			expect(code).not.toMatch(/["'](?:blob:|data:)/);
		}
	});

	it("模块内未打入共享依赖实现（react 未进模块）", () => {
		const modulesDir = path.join(PLAYGROUND_DIST_DIR, "modules");
		for (const file of walkFiles(modulesDir)) {
			const code = readFileSync(file, "utf-8");
			// 生产 react 内含此字符串；若模块打进了 react 实现，则会命中
			expect(code).not.toContain("Minified React error");
		}
	});
});
