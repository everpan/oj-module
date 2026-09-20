import type { AppRouteRecordRaw } from "../src/router/types";

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLayout, unregisterLayouts } from "../src/layout/layout-registry";
import { resolveLayoutComponent, resolveRouteLayouts } from "../src/router/utils/resolve-layout";

const HostLayout = () => null;
const Page = () => null;

afterEach(() => unregisterLayouts("host"));

function bootstrap() {
	registerLayout("host", "container", HostLayout);
	registerLayout("host", "parent", HostLayout);
}

describe("resolve-layout 纯注册表解析（core 不引 v1 布局）", () => {
	it("已登记名命中宿主布局；未声明回落 Outlet", () => {
		bootstrap();
		expect(resolveLayoutComponent({ layout: "container" })).toBe(HostLayout);
		expect(resolveLayoutComponent({ title: "x" })).toBe(resolveLayoutComponent(undefined));
	});

	it("未知名 warn-once 回落 Outlet（去重不刷屏）", () => {
		bootstrap();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		resolveLayoutComponent({ layout: "ghost" });
		resolveLayoutComponent({ layout: "ghost" });
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

describe("resolveRouteLayouts：U7 叶子/嵌套/无 layout 三形态", () => {
	it("形态 1（U7 修复核心）：直挂 Component 的叶子路由 handle.layout 生效", () => {
		bootstrap();
		const routes = [
			{ path: "/settings", Component: Page, handle: { title: "s", layout: "container" } },
		] as unknown as AppRouteRecordRaw[];
		const [wrapped] = resolveRouteLayouts(routes) as unknown as Array<{
			path?: string
			Component?: unknown
			children?: Array<{ index?: boolean, Component?: unknown }>
		}>;

		// 包裹层：原 path + 宿主布局；叶子降为 index（渲染于原 path）
		expect(wrapped.path).toBe("/settings");
		expect(wrapped.Component).toBe(HostLayout);
		expect(wrapped.children).toHaveLength(1);
		expect(wrapped.children![0]!.index).toBe(true);
		expect(wrapped.children![0]!.Component).toBe(Page);
	});

	it("形态 2（v1 同形）：无 Component 的父级路由注入布局", () => {
		bootstrap();
		const routes = [
			{
				path: "/dash",
				handle: { title: "d", layout: "parent" },
				children: [{ path: "a", Component: Page, handle: { title: "a" } }],
			},
		] as unknown as AppRouteRecordRaw[];
		const [parent] = resolveRouteLayouts(routes) as unknown as Array<{
			Component?: unknown
			children?: unknown[]
		}>;
		expect(parent.Component).toBe(HostLayout);
		expect(parent.children).toHaveLength(1);
	});

	it("形态 3：layout none/未声明不包裹；已有 Component 的布局路由不动", () => {
		bootstrap();
		const routes = [
			{ path: "/plain", Component: Page, handle: { title: "p" } },
			{ path: "/off", Component: Page, handle: { title: "o", layout: "none" } },
			{
				path: "/own",
				Component: HostLayout,
				handle: { title: "w", layout: "container" },
				children: [{ path: "c", Component: Page, handle: { title: "c" } }],
			},
		] as unknown as AppRouteRecordRaw[];
		const out = resolveRouteLayouts(routes) as unknown as Array<Record<string, any>>;
		expect(out[0]!.children).toBeUndefined(); // 无 layout 叶子原样
		expect(out[1]!.children).toBeUndefined(); // none 原样
		expect(out[2]!.children).toHaveLength(1); // Component+children 不动
		expect(out[2]!.children![0]).toMatchObject({ path: "c" });
	});

	it("纯函数：不修改输入树", () => {
		bootstrap();
		const routes = [
			{ path: "/x", Component: Page, handle: { title: "x", layout: "container" } },
		] as unknown as AppRouteRecordRaw[];
		const snapshot = JSON.stringify(routes);
		resolveRouteLayouts(routes);
		expect(JSON.stringify(routes)).toBe(snapshot);
	});

	it("handle 保留在包裹层（flatten 键 = 原 path，keepAlive 语义不变）", () => {
		bootstrap();
		const routes = [
			{ path: "/k", Component: Page, handle: { title: "k", layout: "container", keepAlive: false } },
		] as unknown as AppRouteRecordRaw[];
		const [wrapped] = resolveRouteLayouts(routes) as unknown as Array<{ handle?: { keepAlive?: boolean } }>;
		expect(wrapped.handle?.keepAlive).toBe(false);
	});
});
