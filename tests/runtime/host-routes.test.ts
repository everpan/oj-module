import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getHostRoutes, getRoutes, loadAll, unloadModule } from "#src/module-loader";

import { PROJECT_ROOT } from "../helpers/paths";

function fixture(name: string): string {
	return pathToFileURL(`${PROJECT_ROOT}/tests/fixtures/${name}`).href;
}

/**
 * 宿主建表取口回归（2026-10 oj-wiki admin/contacts 404）：
 * 0.2.17 起 admin 类路由被菜单管线真重写为 /system/<模块根>/*，宿主 shell 若直接用
 * getRoutes() 建表，渲染路由表停留在 /wiki/admin/* 而菜单指向 /system/wiki/admin/*
 * → 方案管理页菜单点击必 404（此前 cli/shell host.tsx 正是漏网处）。
 * 契约：getHostRoutes() 必须 hoist，getRoutes() 必须保持原样（access store 登记前自会重写）。
 */
describe("getHostRoutes（宿主建表与菜单管线同源）", () => {
	beforeAll(async () => {
		await unloadModule("host-routes-fixture");
		await loadAll({ modules: [{ name: "host-routes-fixture", entry: fixture("host-routes-entry.tsx") }] });
	});

	afterAll(async () => {
		await unloadModule("host-routes-fixture");
	});

	it("getRoutes() 不重写：admin 仍在模块根下（access store 语义）", () => {
		const wiki = getRoutes().find(r => r.path === "wiki");
		expect(wiki?.children?.map(c => c.path)).toContain("admin");
	});

	it("getHostRoutes() hoist：/system/wiki/admin(/contacts) 顶级可达", () => {
		const hoisted = getHostRoutes().find(r => r.path === "/system/wiki/admin");
		expect(hoisted, "admin 子树未提升到 /system/<root>/*").toBeDefined();
		expect(hoisted?.children?.map(c => c.path ?? "(index)")).toEqual(["(index)", "contacts"]);
	});

	it("getHostRoutes() 不动普通路由：collections 仍在 wiki 根下", () => {
		const wiki = getHostRoutes().find(r => r.path === "wiki");
		expect(wiki?.children?.map(c => c.path)).toContain("collections");
		expect(wiki?.children?.map(c => c.path)).not.toContain("admin");
	});
});
