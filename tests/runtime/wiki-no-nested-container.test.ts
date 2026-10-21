import type { AppRouteRecordRaw } from "#src/router/types";

import { describe, expect, it } from "vitest";
import ContainerLayout from "#src/layout/container-layout";
import ParentLayout from "#src/layout/parent-layout";
import { resolveRouteLayouts } from "#src/router/utils/resolve-layout";
import { rewriteAdminPaths } from "#src/router/utils/rewrite-admin-paths";

// 真导入 wiki 模块入口（single-root 约定），守住「访问 /wiki/space 不再嵌套 container」的行为回归。
// defineModule 是纯函数（仅返回 definition），入口的页面均 lazy，无导入副作用。
// 注意：该入口位于 monorepo 兄弟包 oj-wiki-solution，路径相对 oj-module 仓库根。
import wikiEntry from "../../../oj-wiki-solution/web/src/wiki/entry.ts";

/** 按相对段路径在路由树中定位一条匹配链（root → leaf），找不到返回 null */
function findChain(
	routes: AppRouteRecordRaw[],
	segments: string[],
): AppRouteRecordRaw[] | null {
	for (const route of routes) {
		if (route.path !== segments[0])
			continue;
		if (segments.length === 1)
			return [route];
		const sub = findChain(route.children ?? [], segments.slice(1));
		if (sub)
			return [route, ...sub];
	}
	return null;
}

/** 一条匹配链中 ContainerLayout（整站 chrome）出现的次数 */
function countContainers(chain: AppRouteRecordRaw[]): number {
	return chain.filter(r => r.Component === ContainerLayout).length;
}

describe("wiki 单根路由：container 不嵌套（回归）", () => {
	const routes = resolveRouteLayouts(wikiEntry.routes);

	it("/wiki 根路由自身是 container（整站 chrome 唯一起点）", () => {
		const wikiRoot = findChain(routes, ["wiki"])![0];
		expect(wikiRoot.Component).toBe(ContainerLayout);
	});

	it("访问 /wiki/space：匹配链里只有一个 container（根），space 分组出口是 parent", () => {
		const chain = findChain(routes, ["wiki", "space"])!;
		expect(chain).toHaveLength(2);
		// space 是嵌套在 /wiki 容器下的分组路由，应渲染 ParentLayout（仅 Outlet），而非再挂一层 container
		expect(chain[1].Component).toBe(ParentLayout);
		expect(countContainers(chain)).toBe(1);
	});

	it("/wiki/status、/wiki/collections 同样不重复挂 container", () => {
		for (const seg of [["wiki", "status"], ["wiki", "collections"]]) {
			const chain = findChain(routes, seg as string[])!;
			expect(countContainers(chain)).toBe(1);
		}
	});

	it("admin 被 rewriteAdminPaths 提升到 /system/wiki/admin 后仍自带 container（顶级 chrome，不丢）", () => {
		// 真实管线：getRoutes 先 resolveRouteLayouts（admin 仍嵌套在 /wiki 下，注入 container），
		// 再由 setAccessStore 的 rewriteAdminPaths hoist 并保留已注入的 container。
		const rewritten = rewriteAdminPaths(resolveRouteLayouts(wikiEntry.routes));
		const chain = findChain(rewritten, ["/system/wiki/admin"])!;
		expect(chain).toHaveLength(1);
		expect(chain[0].Component).toBe(ContainerLayout);
		expect(countContainers(chain)).toBe(1);
	});
});
