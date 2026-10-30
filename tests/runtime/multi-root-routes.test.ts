import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getHostRoutes, getModuleRoutePrefix, getRoutes, loadAll, unloadModule } from "#src/module-loader";

import { PROJECT_ROOT } from "../helpers/paths";

function fixture(name: string): string {
	return pathToFileURL(`${PROJECT_ROOT}/tests/fixtures/${name}`).href;
}

/**
 * 需求一（0.2.44）多根树回归：entry.ts 的 routes 数组 length > 1 时，每个根各自
 * 注册为一级菜单；routePrefix 退化为命名空间（多根没有「唯一根段」可当挂载点）。
 *
 * 这里钉的是容易被漏掉的一半：**相对声明的根**仍必须挂到命名空间下。此前
 * getHostRoutes 对多根模块整体跳过改写，相对根会直接散落到站点根（/crm、/wiki）——
 * 既可能撞宿主自有路由，也会与另一个相对声明的多根模块抢同一条路径，后者静默覆盖前者。
 * 绝对路径那一半必须保持原样（「顶层绝对即权威」，与 addRouteIdByPath 同口径）。
 */
describe("多根树路由（需求一）", () => {
	beforeAll(async () => {
		await unloadModule("multi-root-fixture");
		await loadAll({ modules: [{ name: "multi-root-fixture", entry: fixture("multi-root-entry.tsx") }] });
	});

	afterAll(async () => {
		await unloadModule("multi-root-fixture");
	});

	it("getRoutes() 保持声明原样：三个根都在，相对的相对、绝对的绝对", () => {
		const paths = getRoutes().map(r => r.path);
		expect(paths).toEqual(["crm", "wiki", "/ops"]);
	});

	it("getHostRoutes() 给相对根加命名空间，绝对根原样保留", () => {
		const paths = getHostRoutes().map(r => r.path);
		expect(paths).toEqual(["multi-root-fixture/crm", "multi-root-fixture/wiki", "/ops"]);
	});

	it("routePrefix 在多根下回落模块名，作为命名空间而非挂载点", () => {
		expect(getModuleRoutePrefix("multi-root-fixture")).toBe("multi-root-fixture");
	});
});
