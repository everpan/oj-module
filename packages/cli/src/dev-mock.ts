import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `ojm dev` 工程 mock 约定（docs/prd/202609010056-playground-full-modules-plan.md）。
 *
 * 模块工程根下的 `mock/*.mock.mjs`（或 .mock.js）每个文件 default 导出路由数组：
 *
 *   export default [
 *     { url: "/home/line", method: "post", response: ({ body }) => ({ code: 200, result: [...] }) },
 *   ]
 *
 * dev 服务器将其挂到同源 `/api` 前缀下（url 不含前缀），url+method 精确匹配。
 * 无 mock 目录时零行为变化——mock 是可选的演示能力，ojm 不引入任何运行时依赖。
 */

export interface MockRouteContext {
	/** POST 请求体（JSON 解析失败时为 {}） */
	body: Record<string, unknown>
	/** URL 查询参数 */
	query: URLSearchParams
}

export interface MockRoute {
	method?: string
	url: string
	response: (ctx: MockRouteContext) => unknown
}

const MOCK_SUFFIXES = [".mock.mjs", ".mock.js"];

/**
 * AC-D16：oj 语义——HTTP 状态 = 信封 code（0→200）。
 * 仅对显式正数 code 置状态；无 code / code<=0 维持 200。
 * 评审 F5：手写 mock 的 code 可能是任意业务码（如 10001），Node writeHead
 * 只接受 100–599——越界归 500，不让 dev 进程崩。
 */
export function mockStatusCode(payload: unknown): number {
	const code = (payload as { code?: unknown } | null)?.code;
	if (typeof code !== "number" || code <= 0)
		return 200;
	return code >= 100 && code <= 599 ? code : 500;
}

/** 加载工程 mock 目录下的全部路由；目录不存在返回空数组 */
export async function loadProjectMocks(projectRoot: string): Promise<MockRoute[]> {
	const mockDir = resolve(projectRoot, "mock");
	if (!existsSync(mockDir))
		return [];

	const routes: MockRoute[] = [];
	for (const file of readdirSync(mockDir)) {
		if (!MOCK_SUFFIXES.some(suffix => file.endsWith(suffix)))
			continue;
		const mod = (await import(pathToFileURL(join(mockDir, file)).href)) as {
			default?: unknown
		};
		if (Array.isArray(mod.default))
			routes.push(...(mod.default as MockRoute[]));
	}
	return routes;
}

/** 按 method+path 精确匹配一条 mock 路由；未命中返回 undefined */
export function matchMockRoute(
	routes: MockRoute[],
	method: string,
	apiPath: string,
): MockRoute | undefined {
	return routes.find(
		route =>
			(route.method ?? "get").toLowerCase() === method.toLowerCase()
			&& route.url === apiPath,
	);
}
