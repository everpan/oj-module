import type { ComponentType } from "react";

import { Outlet } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import ContainerLayout from "#src/layout/container-layout";
import FullscreenLayout from "#src/layout/fullscreen-layout";
import {
	registerLayout,
	unregisterLayouts,
} from "#src/layout/layout-registry";
import ParentLayout from "#src/layout/parent-layout";
import { resolveLayoutComponent, resolveRouteLayouts } from "#src/router/utils/resolve-layout";

// 布局注册表（G1）：与 api-provider 同构——模块作用域、先到先得、按模块卸载清理。
// BDD 5.1 七用例；注册表是模块级 Map，用例间以独立模块名 + unregister 复位避免串扰。
const ModA = vi.fn() as unknown as ComponentType;
const ModB = vi.fn() as unknown as ComponentType;

afterEach(() => {
	unregisterLayouts("mod-a");
	unregisterLayouts("mod-b");
});

describe("layout-registry（G1，BDD 5.1）", () => {
	it("5.1#1 无模块登记：内建名回落内建组件，未声明回落 Outlet", () => {
		expect(resolveLayoutComponent({ layout: "container" })).toBe(ContainerLayout);
		expect(resolveLayoutComponent({ layout: "parent" })).toBe(ParentLayout);
		expect(resolveLayoutComponent({ layout: "fullscreen" })).toBe(FullscreenLayout);
		expect(resolveLayoutComponent()).toBe(Outlet);
		expect(resolveLayoutComponent({})).toBe(Outlet);
	});

	it("5.1#2 模块登记后可覆盖内建名与注册新名", () => {
		registerLayout("mod-a", "container", ModA);
		registerLayout("mod-a", "pro", ModA);
		expect(resolveLayoutComponent({ layout: "container" })).toBe(ModA);
		expect(resolveLayoutComponent({ layout: "pro" })).toBe(ModA);
		// 覆盖不影响未登记者回落
		expect(resolveLayoutComponent({ layout: "parent" })).toBe(ParentLayout);
	});

	it("5.1#3 先到先得：重复登记同名被警告忽略", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		registerLayout("mod-a", "container", ModA);
		registerLayout("mod-b", "container", ModB);
		expect(resolveLayoutComponent({ layout: "container" })).toBe(ModA);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]![0]).toContain("mod-b");
		warn.mockRestore();
	});

	it("5.1#4 覆盖内建名也属先到先得", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		registerLayout("mod-a", "fullscreen", ModA);
		registerLayout("mod-b", "fullscreen", ModB);
		expect(resolveLayoutComponent({ layout: "fullscreen" })).toBe(ModA);
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("5.1#5 卸载后回落内建（再解析语义；运行中已注入路由不热回落见设计文档 §7）", () => {
		registerLayout("mod-a", "container", ModA);
		expect(resolveLayoutComponent({ layout: "container" })).toBe(ModA);
		unregisterLayouts("mod-a");
		expect(resolveLayoutComponent({ layout: "container" })).toBe(ContainerLayout);
	});

	it("5.1#6 卸载按模块隔离：不影响其他模块的登记", () => {
		registerLayout("mod-a", "container", ModA);
		registerLayout("mod-b", "pro", ModB);
		unregisterLayouts("mod-a");
		expect(resolveLayoutComponent({ layout: "container" })).toBe(ContainerLayout);
		expect(resolveLayoutComponent({ layout: "pro" })).toBe(ModB);
	});

	it("5.1#7 未知名（拼写错误）warn-once 一次并回落 Outlet", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(resolveLayoutComponent({ layout: "contaienr" })).toBe(Outlet);
		expect(resolveLayoutComponent({ layout: "contaienr" })).toBe(Outlet);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0]![0]).toContain("contaienr");
		warn.mockRestore();
	});

	it("resolveRouteLayouts 走同一注册表（有 Component 的节点不受影响）", () => {
		registerLayout("mod-a", "container", ModA);
		const Page = vi.fn() as unknown as ComponentType;
		const routes = resolveRouteLayouts([
			{
				path: "/x",
				handle: { layout: "container", title: "x" },
				children: [{ path: "y", Component: Page, handle: { title: "y" } }],
			},
		]);
		expect(routes[0]!.Component).toBe(ModA);
		expect(routes[0]!.children![0]!.Component).toBe(Page);
	});
});
