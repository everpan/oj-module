import type { AppRouteRecordRaw } from "#src/router/types";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import ContainerLayout from "#src/layout/container-layout";
import { resolveRouteLayouts } from "#src/router/utils/resolve-layout";
import { readModuleDefinition } from "../../packages/cli/src/build";
import { PROJECT_ROOT } from "../helpers/paths";

/**
 * P1：模块工程应当**只含模块**。
 *
 * 这组断言守护「外部工程与框架源码解耦」这一核心目标，
 * 任何把框架内部路径引入模块工程的改动都会在这里失败。
 */

const PLAYGROUND = path.join(PROJECT_ROOT, "apps/playground");
const PLAYGROUND_MODULES = path.join(PLAYGROUND, "modules");

function collectFiles(dir: string): string[] {
	if (!fs.existsSync(dir))
		return [];

	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? collectFiles(full) : [full];
	});
}

describe("模块工程只含模块", () => {
	it("playground 存在且具备最小工程结构（uni-dev 新布局）", () => {
		for (const file of ["package.json", "modules.config.ts"]) {
			expect(fs.existsSync(path.join(PLAYGROUND, file)), `应存在 ${file}`).toBe(true);
		}
		expect(fs.existsSync(PLAYGROUND_MODULES), "应存在 modules/").toBe(true);
		// D11 一次性迁移：modules/src/ 源码目录存在，legacy 的 modules/<name>/ 直挂不存在
		expect(fs.existsSync(path.join(PLAYGROUND_MODULES, "src")), "应存在 modules/src/（新布局）").toBe(true);
		expect(
			fs.existsSync(path.join(PLAYGROUND_MODULES, "demo")),
			"legacy 布局 modules/demo/ 应已删除（D11 迁移）",
		).toBe(false);
	});

	it("playground 内不含框架源码目录", () => {
		for (const dir of ["src", "layout", "router", "store", "components"]) {
			expect(
				fs.existsSync(path.join(PLAYGROUND, dir)),
				`模块工程不应包含框架目录 ${dir}/`,
			).toBe(false);
		}
	});

	it("playground 源码中不出现框架内部路径导入", () => {
		const offenders = collectFiles(PLAYGROUND)
			.filter(file => /\.tsx?$/.test(file))
			.filter(file => /from\s*["']#(?:src|modules)\//.test(fs.readFileSync(file, "utf-8")))
			.map(file => path.relative(PLAYGROUND, file));

		expect(
			offenders,
			`以下文件引入了框架内部路径（应改为 @oj-module/runtime）：${offenders.join(", ")}`,
		).toEqual([]);
	});

	it("package.json 只依赖 runtime 与共享依赖", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(PLAYGROUND, "package.json"), "utf-8"));
		const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
		const runtimeDeps = Object.keys(pkg.dependencies ?? {});

		// 共享依赖由宿主 importmap 提供，模块只在构建期用它们做类型检查（设计文档 C4）
		expect(runtimeDeps, "共享依赖不得出现在 dependencies，只能是 devDependencies").toEqual([]);
		expect(allDeps, "模块工程应依赖 @oj-module/runtime").toContain("@oj-module/runtime");

		const frameworkInternal = allDeps.filter((d: string) => d.startsWith("#"));
		expect(frameworkInternal, "不应依赖框架内部路径").toEqual([]);
	});
});

describe("demo 模块符合模块契约", () => {
	const entryPath = path.join(PLAYGROUND_MODULES, "src", "demo", "entry.ts");

	it("entry.ts 使用 defineModule 声明", () => {
		const content = fs.readFileSync(entryPath, "utf-8");
		expect(content, "应使用 defineModule").toMatch(/defineModule\s*\(/);
		expect(content, "defineModule 应从 @oj-module/runtime 导入").toMatch(
			/from\s*["']@oj-module\/runtime["']/,
		);
	});

	it("声明了 name / version / peerRuntime", () => {
		const content = fs.readFileSync(entryPath, "utf-8");
		expect(content).toMatch(/name:\s*["']demo["']/);
		expect(content).toMatch(/version:\s*["'][^"']+["']/);
		expect(content, "应声明 peerRuntime 供宿主做版本兼容校验").toMatch(/peerRuntime:\s*["'][^"']+["']/);
	});

	it("i18n 资源文件齐全且 menu key 与模块 namespace 一致", () => {
		const localesDir = path.join(PLAYGROUND_MODULES, "src", "demo", "locales");
		for (const locale of ["zh-CN", "en-US"]) {
			const file = path.join(localesDir, `${locale}.json`);
			expect(fs.existsSync(file), `应存在 ${locale}.json`).toBe(true);

			const res = JSON.parse(fs.readFileSync(file, "utf-8"));
			expect(res.menu?.demo, `${locale}.json 应包含 menu.demo`).toBeTruthy();
		}
	});
});

/**
 * 回归：demo 曾把页面组件直接挂在顶层路由上。
 *
 * `resolveRouteLayouts` 只给「无 Component 且有 children」的路由注入布局，
 * 叶子路由直挂 Component 会裸奔（无 header / sidebar / tabbar），
 * 而 KeepAlive 只挂在 ContainerLayout 内，`keepAlive: true` 也随之失效——
 * 两者都不报错，只能靠这条断言拦住。
 */
describe("demo 路由具备布局（回归）", () => {
	it("顶层路由经 resolveRouteLayouts 后被注入 ContainerLayout", async () => {
		const definition = await readModuleDefinition(
			path.join(PLAYGROUND_MODULES, "src", "demo", "entry.ts"),
			PROJECT_ROOT,
		);
		// readModuleDefinition 的返回类型只声明了元信息字段（CLI 只需要那些），
		// 但它实际回传的是完整的 defineModule 入参
		const { routes } = definition as unknown as { routes: AppRouteRecordRaw[] };
		const resolved = resolveRouteLayouts(routes);

		expect(resolved.length, "demo 应至少声明一条路由").toBeGreaterThan(0);
		expect(resolved[0]!.children?.length, "页面应由子路由承载，而非顶层路由直挂 Component").toBeGreaterThan(0);
		expect(resolved[0]!.Component).toBe(ContainerLayout);
	});
});

describe("playground 可独立自查类型（手册 §2）", () => {
	it("自带 typescript 与 @types/react，并提供 typecheck 脚本", () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(PLAYGROUND, "package.json"), "utf-8"));

		// 缺了这两项，工程被复制出去后便无法自查类型
		// （原先只能靠向上查找到 root 的 node_modules 才侥幸通过）
		expect(pkg.devDependencies?.typescript, "应声明 typescript").toBeTruthy();
		expect(pkg.devDependencies?.["@types/react"], "应声明 @types/react").toBeTruthy();
		expect(pkg.scripts?.typecheck, "应提供 typecheck 脚本").toBeTruthy();
	});
});
