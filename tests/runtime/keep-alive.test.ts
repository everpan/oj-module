import type { AppRouteRecordRaw } from "#src/router/types";
import { describe, expect, it } from "vitest";

import { collectAllRoutePaths, collectKeepAliveExcludes } from "#src/module-loader/keep-alive";

function route(path: string, keepAlive?: boolean): AppRouteRecordRaw {
	return { path, handle: { keepAlive } } as AppRouteRecordRaw;
}

describe("keep-alive 聚合（P2.1）", () => {
	it("collectAllRoutePaths 收集全部路由 key，与 flattenRoutes 键一致", () => {
		const routes = [route("/demo"), { path: "/nested", children: [route("/nested/child")] } as AppRouteRecordRaw];
		expect(collectAllRoutePaths(routes).sort()).toEqual(["/demo", "/nested", "/nested/child"].sort());
	});

	it("collectKeepAliveExcludes 只收集 keepAlive === false 的 key", () => {
		const routes = [
			route("/demo", true),
			route("/system", false),
			{ path: "/nested", children: [route("/nested/child", false)] } as AppRouteRecordRaw,
		];
		expect(collectKeepAliveExcludes(routes).sort()).toEqual(["/nested/child", "/system"].sort());
	});

	it("默认（未声明 keepAlive）不进入 exclude", () => {
		const routes = [route("/demo"), route("/system", false)];
		expect(collectKeepAliveExcludes(routes)).toEqual(["/system"]);
	});
});

describe("keep-alive exclude key 绝对化（相对声明回归）", () => {
	// 解决方案模块一律相对路径声明（安装时 prefix 加在顶层）；wiki 形状：
	// wiki > collections > index{keepAlive:false}
	const wikiShape = (keepAliveOn: "index" | "parent"): AppRouteRecordRaw[] => [
		{
			path: "wiki",
			children: [
				keepAliveOn === "parent"
					? { path: "collections", handle: { keepAlive: false } } as AppRouteRecordRaw
					: {
						path: "collections",
						children: [{ index: true, handle: { keepAlive: false } } as AppRouteRecordRaw],
					} as AppRouteRecordRaw,
			],
		} as AppRouteRecordRaw,
	];

	it("相对声明模块（wiki > collections > index{keepAlive:false}）收集绝对 key", () => {
		expect(collectKeepAliveExcludes(wikiShape("index"))).toEqual(["/wiki/collections"]);
	});

	it("keepAlive:false 挂分组父路由（非 index）同样收集绝对 key", () => {
		expect(collectKeepAliveExcludes(wikiShape("parent"))).toEqual(["/wiki/collections"]);
	});

	it("绝对声明子路由（path:\"/wiki/collections\"）原样收集（框架模块不回退）", () => {
		const routes = [
			{
				path: "wiki",
				children: [{ path: "/wiki/collections", handle: { keepAlive: false } } as AppRouteRecordRaw],
			} as AppRouteRecordRaw,
		];
		expect(collectKeepAliveExcludes(routes)).toEqual(["/wiki/collections"]);
	});

	it("安装 prefix 加在顶层绝对路径时，相对子层仍拼出正确绝对 key", () => {
		const routes = [
			{
				path: "/solutions/wiki",
				children: [
					{
						path: "collections",
						children: [{ index: true, handle: { keepAlive: false } } as AppRouteRecordRaw],
					} as AppRouteRecordRaw,
				],
			} as AppRouteRecordRaw,
		];
		expect(collectKeepAliveExcludes(routes)).toEqual(["/solutions/wiki/collections"]);
	});

	it("index 路由 key 无尾斜杠（≠ /wiki/collections/）", () => {
		const excludes = collectKeepAliveExcludes(wikiShape("index"));
		expect(excludes).toEqual(["/wiki/collections"]);
		expect(excludes).not.toContain("/wiki/collections/");
	});

	it("collectAllRoutePaths 同口径且去重（index 折叠为父层 key）", () => {
		expect(collectAllRoutePaths(wikiShape("index"))).toEqual(["/wiki", "/wiki/collections"]);
	});
});
