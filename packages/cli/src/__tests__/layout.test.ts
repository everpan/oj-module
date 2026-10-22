// layout spec：三种布局的探测、互斥、模块枚举与 config 落点。
//
// 这些取值是 dev/build/preview/bundle 的共同底座：探测错一次，`ojm build` 会构建 A
// 而 `ojm dev` 预览 B，或产物写进空目录后表现为「health 200、模块 0 个」的假绿。
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	apiSrcOf,
	moduleDir,
	resolveCertDir,
	resolveConfigPath,
	resolveLayout,
	scanModules,
	webSrcOf,
} from "../layout";

function newRoot(): string {
	return mkdtempSync(join(tmpdir(), "ojm-layout-"));
}

function writeFile(root: string, rel: string, content = ""): void {
	const abs = join(root, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf-8");
}

/** 新布局的最小工程：src/wiki/{api/manifest.yaml, web/entry.ts} + 根 config.yaml */
function newModuleRootProject(): string {
	const root = newRoot();
	writeFile(root, "src/wiki/api/manifest.yaml", "name: wiki\nversion: 0.1.0\n");
	writeFile(root, "src/wiki/web/entry.ts", "export default {};\n");
	writeFile(root, "config.yaml", "server:\n  port: 9778\n");
	return root;
}

describe("resolveLayout / module-root", () => {
	it("src/<name>/{api,web} 命中 module-root，产物根语义不变", () => {
		const root = newModuleRootProject();
		const layout = resolveLayout(root);

		expect(layout.kind).toBe("module-root");
		expect(layout.modulesSrc).toBe(join(root, "src"));
		expect(layout.distDir).toBe(join(root, "web", "dist"));
		expect(layout.apiDist).toBe(join(root, "api", "dist"));
		expect(layout.watchTarget).toBe(join(root, "src"));
		// --module-root 取「源码树根目录」（oj 在其子树内递归找 manifest.yaml）
		expect(layout.moduleRoot).toBe(join(root, "src"));
	});

	it("web/dist 存在不会被误判成 flat 布局", () => {
		const root = newModuleRootProject();
		mkdirSync(join(root, "web", "dist", "modules", "wiki", "0.1.0"), { recursive: true });
		expect(resolveLayout(root).kind).toBe("module-root");
	});

	it("枚举真源是标记文件：一侧可缺省，纯后端 / 纯前端各算一个模块", () => {
		const root = newRoot();
		writeFile(root, "src/_platform/api/manifest.yaml", "name: _platform\nversion: 0.1.0\n");
		writeFile(root, "src/auth/api/manifest.yaml", "name: auth\nversion: 0.1.0\n");
		writeFile(root, "src/about/web/entry.ts", "export default {};\n");

		// 按名字排序（不依赖 readdir 顺序，产物才可复现）
		const modules = scanModules(resolveLayout(root));
		expect(modules.map(m => m.name)).toEqual(["_platform", "about", "auth"]);
		expect(modules.map(m => !!m.apiSrc)).toEqual([true, false, true]);
		expect(modules.map(m => !!m.webSrc)).toEqual([false, true, false]);
		expect(modules[0].apiSrc).toBe(join(root, "src", "_platform", "api"));
		expect(modules[1].webSrc).toBe(join(root, "src", "about", "web"));
	});

	it("非模块目录（既无 api/ 也无 web/，如共享库）静默跳过", () => {
		const root = newRoot();
		writeFile(root, "src/wiki/api/manifest.yaml", "name: wiki\nversion: 0.1.0\n");
		writeFile(root, "src/shared/util.ts", "export const x = 1;\n");
		expect(scanModules(resolveLayout(root)).map(m => m.name)).toEqual(["wiki"]);
	});

	it("有 api/ 却缺 manifest.yaml：报错并指名目录（不静默当成非模块）", () => {
		const root = newRoot();
		writeFile(root, "src/wiki/api/manifest.yaml", "name: wiki\nversion: 0.1.0\n");
		writeFile(root, "src/broken/api/index.js", "export {};\n");
		expect(() => resolveLayout(root)).toThrow(/src\/broken\//);
	});

	it("src/ 下没有任何模块标记时不算 module-root（避免把脚本 src/ 当模块树）", () => {
		const root = newRoot();
		mkdirSync(join(root, "src", "scripts"), { recursive: true });
		expect(() => resolveLayout(root)).toThrow(/未发现模块源码/);
	});
});

describe("resolveLayout / 历史布局", () => {
	it("web/src 仍识别为 new，模块根不在 src/ 之下", () => {
		const root = newRoot();
		writeFile(root, "web/src/wiki/entry.ts", "export default {};\n");
		writeFile(root, "api/src/wiki/manifest.yaml", "name: wiki\nversion: 0.1.0\n");

		const layout = resolveLayout(root);
		expect(layout.kind).toBe("new");
		expect(layout.modulesSrc).toBe(join(root, "web", "src"));
		expect(layout.moduleRoot).toBeUndefined();
		expect(apiSrcOf(layout, "wiki")).toBe(join(root, "api", "src", "wiki"));
		expect(webSrcOf(layout, "wiki")).toBe(join(root, "web", "src", "wiki"));
	});

	it("web/<name>/entry.ts 识别为 flat，产物落 build/", () => {
		const root = newRoot();
		writeFile(root, "web/home/entry.ts", "export default {};\n");
		writeFile(root, "web/home/__client/api.ts", "export {};\n");

		const layout = resolveLayout(root);
		expect(layout.kind).toBe("flat");
		expect(layout.modulesSrc).toBe(join(root, "web"));
		expect(layout.distDir).toBe(join(root, "build"));
		expect(webSrcOf(layout, "home")).toBe(join(root, "web", "home"));
	});

	it("历史布局不支持 scanModules（顺序由 web.config.ts 决定）", () => {
		const root = newRoot();
		writeFile(root, "web/src/wiki/entry.ts", "export default {};\n");
		expect(() => scanModules(resolveLayout(root))).toThrow(/只适用于 module-root/);
	});
});

describe("resolveLayout / 互斥与缺省", () => {
	it("两套源码树同时存在时报错，而不是静默选一个", () => {
		const root = newModuleRootProject();
		writeFile(root, "web/src/legacy/entry.ts", "export default {};\n");
		expect(() => resolveLayout(root)).toThrow(/同时存在两套模块源码树/);
	});

	it("什么布局都没有时报错并列出两种合法形状", () => {
		const root = newRoot();
		expect(() => resolveLayout(root)).toThrow(/未发现模块源码/);
	});
});

describe("config 落点", () => {
	it("module-root：config 与证书目录都在仓库根", () => {
		const root = newModuleRootProject();
		expect(resolveConfigPath(root)).toBe(join(root, "config.yaml"));
		expect(resolveCertDir(root)).toBe(join(root, "config"));
	});

	it("module-root 仍把 config 留在 api/ 时报错（回退会让路由静默消失）", () => {
		const root = newRoot();
		writeFile(root, "src/wiki/api/manifest.yaml", "name: wiki\nversion: 0.1.0\n");
		writeFile(root, "api/config.yaml", "server:\n  port: 9778\n");
		expect(() => resolveConfigPath(root)).toThrow(/仍在 api\/ 下/);
	});

	it("历史布局：config 与证书目录仍在 api/ 下", () => {
		const root = newRoot();
		writeFile(root, "web/src/wiki/entry.ts", "export default {};\n");
		writeFile(root, "api/config.yaml", "server:\n  port: 9778\n");
		expect(resolveConfigPath(root)).toBe(join(root, "api", "config.yaml"));
		expect(resolveCertDir(root)).toBe(join(root, "api", "config"));
	});

	it("空目录（init 目标）不报错：落默认位置供脚手架写入", () => {
		const root = newRoot();
		expect(resolveConfigPath(root)).toBe(join(root, "api", "config.yaml"));
	});
});

describe("路径取值函数", () => {
	it("module-root：moduleDir / apiSrcOf / webSrcOf 都在 src/<name>/ 之下", () => {
		const layout = resolveLayout(newModuleRootProject());
		expect(moduleDir(layout, "wiki")).toBe(join(layout.modulesSrc, "wiki"));
		expect(apiSrcOf(layout, "wiki")).toBe(join(layout.modulesSrc, "wiki", "api"));
		expect(webSrcOf(layout, "wiki")).toBe(join(layout.modulesSrc, "wiki", "web"));
	});
});
