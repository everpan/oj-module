import { cleanup, render, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import ContainerLayout from "#src/layout/container-layout";
import { createModuleContext } from "#src/module-loader";
import {
	getPortalContainer,
	isPortalContainerMounted,
	MODULE_PORTAL_Z_INDEX,
	mountPortalContainer,
} from "#src/module-loader/portal-container";

/**
 * P4b / Q7 回归：portal 挂载点由壳持有，经 ctx.register.portalContainer() 暴露。
 *
 * 关注三件事：
 * 1. 稳定节点——模块生命周期早于布局挂载，getter 任意时刻返回同一节点；
 * 2. 壳接入——container layout 挂载时接入 DOM、卸载时摘除，且不吃点击；
 * 3. 对其他模块零影响——不调用本 API 的模块行为不变（ctx 只是多一个只读方法）。
 */

beforeAll(() => {
	const noopFetch = ((_input: unknown, _init?: unknown) =>
		Promise.resolve(
			new Response(JSON.stringify({ data: {}, code: 0 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		)) as unknown as typeof fetch;
	globalThis.fetch = noopFetch;

	if (!("ResizeObserver" in globalThis)) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
			dispatchEvent() {
				return false;
			},
		})) as unknown as typeof window.matchMedia;
	}
	if (!("IntersectionObserver" in globalThis)) {
		globalThis.IntersectionObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
		} as unknown as typeof IntersectionObserver;
	}
	window.scrollTo = (() => {}) as typeof window.scrollTo;

	const mem = new Map<string, string>();
	const ls = {
		get length() {
			return mem.size;
		},
		key: (_i: number) => null,
		getItem: (k: string) => (mem.has(String(k)) ? mem.get(String(k))! : null),
		setItem: (k: string, v: string) => {
			mem.set(String(k), String(v));
		},
		removeItem: (k: string) => {
			mem.delete(String(k));
		},
		clear: () => mem.clear(),
	};
	for (const target of [globalThis, globalThis.window].filter(Boolean)) {
		try {
			Object.defineProperty(target, "localStorage", {
				value: ls,
				configurable: true,
				writable: true,
			});
		}
		catch {
			/* ignore */
		}
	}
});

afterEach(() => {
	cleanup();
	// 把稳定节点从任意宿主摘回，避免跨用例串扰
	getPortalContainer().remove();
});

describe("壳持 portal 挂载点（P4b / Q7）", () => {
	it("getter 稳定：任意时刻、任意次数返回同一节点，带 data-oj-portal 与独立 z-index 栈", () => {
		const first = getPortalContainer();
		expect(getPortalContainer()).toBe(first);
		expect(first.getAttribute("data-oj-portal")).toBe("");
		expect(first.style.position).toBe("fixed");
		expect(first.style.zIndex).toBe(String(MODULE_PORTAL_Z_INDEX));
		expect(MODULE_PORTAL_Z_INDEX).toBeGreaterThan(150); // 壳 overlay
		expect(MODULE_PORTAL_Z_INDEX).toBeLessThan(999999999); // View Transition
		// 全屏层不吃点击，子节点由内联 style 规则恢复命中
		expect(first.style.pointerEvents).toBe("none");
		expect(first.querySelector("style")?.textContent).toContain("pointer-events: auto");
	});

	it("mountPortalContainer 接入宿主、返回幂等清理函数；重复 mount 不产生双份", () => {
		const host = document.createElement("section");
		document.body.appendChild(host);

		const unmount = mountPortalContainer(host);
		expect(host.querySelectorAll("[data-oj-portal]").length).toBe(1);
		expect(isPortalContainerMounted()).toBe(true);
		// 重复 mount：同一节点被移动到同宿主，不新增
		const unmount2 = mountPortalContainer(host);
		expect(host.querySelectorAll("[data-oj-portal]").length).toBe(1);

		unmount();
		unmount2();
		unmount(); // 幂等
		expect(host.querySelector("[data-oj-portal]")).toBeNull();
		expect(isPortalContainerMounted()).toBe(false);

		host.remove();
	});

	it("ctx.register.portalContainer() 返回壳挂载点——模块生命周期早于布局挂载也拿到非 null", () => {
		const ctx = createModuleContext(
			{ name: "m-portal", description: "", version: "0.0.0", routes: [] },
			"m-portal",
		);
		const target = ctx.register.portalContainer();
		expect(target).toBe(getPortalContainer());
		expect(target).toBeInstanceOf(HTMLElement);
		// 注册面是只读追加：不调用也不影响 ctx 其余能力
		expect(typeof ctx.register.layout).toBe("function");
		expect(typeof ctx.registerSlot).toBe("function");
	});
});

describe("containerLayout 接入壳挂载点", () => {
	it("布局挂载时 section 内出现 data-oj-portal，卸载时摘除", async () => {
		const root = document.createElement("div");
		document.body.appendChild(root);

		const router = createMemoryRouter(
			[
				{
					path: "/",
					element: <ContainerLayout />,
					children: [{ path: "/", element: <div>page content</div> }],
				},
			],
			{ initialEntries: ["/"] },
		);
		const view = render(
			<ConfigProvider>
				<RouterProvider router={router} />
			</ConfigProvider>,
			{ container: root },
		);

		await waitFor(() => {
			expect(document.querySelector("section [data-oj-portal]"), "ContainerLayout 应把挂载点接入 section").toBeTruthy();
		}, { timeout: 15000 });

		const portal = document.querySelector("section [data-oj-portal]") as HTMLElement;
		expect(portal.style.zIndex).toBe(String(MODULE_PORTAL_Z_INDEX));
		expect(portal.style.pointerEvents).toBe("none");

		view.unmount();
		expect(document.querySelector("section [data-oj-portal]")).toBeNull();

		root.remove();
	}, 30000);
});
