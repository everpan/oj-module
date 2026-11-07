import type { RouteDefinitionLike } from "../manifest-routes-derive";
import { describe, expect, it } from "vitest";
import { menuLayoutWarnings } from "../build/module-build";

function route(over: Partial<RouteDefinitionLike["handle"]> = {}): RouteDefinitionLike {
	return {
		path: "/demo",
		handle: { title: "demo:menu.main", order: 200, ...over },
	};
}

describe("menuLayoutWarnings 菜单路由布局守卫（BDD）", () => {
	it("given 菜单路由（title + order≥0）未声明 layout When 检查 Then 警告提示 container", () => {
		const warns = menuLayoutWarnings([route({ layout: undefined })], "demo");
		expect(warns).toHaveLength(1);
		expect(warns[0]).toContain("/demo");
		expect(warns[0]).toContain("container");
	});

	it("given 菜单路由显式 layout none When 检查 Then 警告（菜单进入将全屏）", () => {
		const warns = menuLayoutWarnings([route({ layout: "none" })], "demo");
		expect(warns).toHaveLength(1);
	});

	it("given 菜单路由 layout container When 检查 Then 无警告", () => {
		expect(menuLayoutWarnings([route({ layout: "container" })], "demo")).toHaveLength(0);
	});

	it("given 底部固定区（order<0）layout none When 检查 Then 无警告（login 全屏类属正当）", () => {
		expect(menuLayoutWarnings([route({ order: -100, layout: "none" })], "demo")).toHaveLength(0);
	});

	it("given 无 title 的路由（不进菜单）When 检查 Then 无警告", () => {
		expect(menuLayoutWarnings([route({ title: undefined, layout: "none" })], "demo")).toHaveLength(0);
	});

	it("given 嵌套 children 中的菜单路由 layout none When 检查 Then 递归警告", () => {
		const warns = menuLayoutWarnings([{ path: "/demo", handle: { layout: "container" }, children: [route({ layout: "none" })] }], "demo");
		expect(warns).toHaveLength(1);
	});
});
