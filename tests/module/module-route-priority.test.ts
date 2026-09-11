import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES_DIR, RUNTIME_DIR } from "../helpers/paths";

const AUTH_GUARD_PATH = path.join(RUNTIME_DIR, "router/guard/auth-guard.tsx");
const BACKEND_ROUTE_GEN_PATH = path.join(RUNTIME_DIR, "router/utils/generate-routes-from-backend.ts");

function getModuleNames(): string[] {
	return fs.readdirSync(MODULES_DIR, { withFileTypes: true })
		.filter(d => d.isDirectory())
		.map(d => d.name);
}

describe("模块路由优先级", () => {
	it("模块路由消费必须在后端路由生成之前执行（auth-guard 代码顺序）", () => {
		const content = fs.readFileSync(AUTH_GUARD_PATH, "utf-8");

		// P5.5/O5：加载已上移到应用启动（index.tsx），守卫只消费 getModuleRoutes()
		const moduleRoutesMatch = content.match(/getModuleRoutes\(\)/);
		const backendRouteMatch = content.match(/await\s+generateRoutesFromBackend\(/);
		const frontendRouteMatch = content.match(/generateRoutesByFrontend\([\s\S]*?\)/);

		expect(moduleRoutesMatch, "auth-guard 中应包含 getModuleRoutes() 消费调用").not.toBeNull();

		const moduleRoutesIndex = moduleRoutesMatch!.index!;

		if (backendRouteMatch) {
			expect(
				moduleRoutesIndex,
				"模块路由消费 (getModuleRoutes) 必须在后端路由生成 (generateRoutesFromBackend) 之前",
			).toBeLessThan(backendRouteMatch.index!);
		}

		if (frontendRouteMatch) {
			expect(
				moduleRoutesIndex,
				"模块路由消费 (getModuleRoutes) 必须在前端路由生成 (generateRoutesByFrontend) 之前",
			).toBeLessThan(frontendRouteMatch.index!);
		}
	});

	it("后端路由生成不得直接收录模块页面（只能经 manifest + defineModule 进入）", () => {
		const content = fs.readFileSync(BACKEND_ROUTE_GEN_PATH, "utf-8");

		const globMatch = content.match(/import\.meta\.glob\(\[([^\]]+)\]\)/);
		expect(globMatch, "应包含 import.meta.glob 定义").not.toBeNull();

		const globPatterns = globMatch![1];
		expect(globPatterns, "应搜索框架自身 /src/pages/ 目录").toContain("/src/pages/");
		expect(globPatterns, "框架不得直接 glob 收录模块页面 /web/").not.toContain("/web/");
	});

	it("每个模块的 entry.ts 中引用的页面组件文件必须存在", () => {
		const errors: string[] = [];

		for (const moduleName of getModuleNames()) {
			const entryPath = path.join(MODULES_DIR, moduleName, "entry.ts");
			if (!fs.existsSync(entryPath))
				continue;
			const content = fs.readFileSync(entryPath, "utf-8");

			const lazyImports = content.matchAll(/lazy\(\(\)\s*=>\s*import\(["']\.\/(pages\/[^"']+)["']\)\)/g);
			for (const match of lazyImports) {
				const pageRelPath = match[1];
				const pageFullPath = path.join(MODULES_DIR, moduleName, pageRelPath);
				const exists = [
					`${pageFullPath}.tsx`,
					`${pageFullPath}.ts`,
					path.join(pageFullPath, "index.tsx"),
					path.join(pageFullPath, "index.ts"),
				].some(p => fs.existsSync(p));
				if (!exists) {
					errors.push(`${moduleName}/${pageRelPath} 文件不存在`);
				}
			}
		}

		expect(errors, errors.join("\n")).toEqual([]);
	});
});

describe("removeDuplicateRoutes 行为验证", () => {
	it("auth-guard 中 routes.push 的顺序确保模块路由优先", () => {
		const content = fs.readFileSync(AUTH_GUARD_PATH, "utf-8");

		const pushPositions: Array<{ index: number, text: string }> = [];
		const pushPattern = /routes\.push\(/g;
		let currentMatch: RegExpExecArray | null;
		// eslint-disable-next-line no-cond-assign
		while ((currentMatch = pushPattern.exec(content)) !== null) {
			const start = currentMatch.index;
			const line = content.substring(start, start + 80);
			pushPositions.push({ index: start, text: line });
		}

		const modulePush = pushPositions.find(p => p.text.includes("moduleRoutes"));
		const frontendPush = pushPositions.find(p => p.text.includes("generateRoutesByFrontend"));

		expect(modulePush, "应有 moduleRoutes 的 push 调用").toBeDefined();

		if (frontendPush) {
			expect(
				modulePush!.index,
				"模块路由 push 必须在前端路由 push 之前",
			).toBeLessThan(frontendPush.index);
		}
	});
});
