import { cleanup, render, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * 回归测试：Error 2（Cannot read properties of undefined (reading 'colorBorder')）。
 *
 * 根因：运行时 `NotificationPopup`（layout-header → ContainerLayout）用
 * `createUseStyles(({ token }) => …)` 读取 react-jss 主题里的 antd token，
 * 而 token 由 `JSSThemeProvider` 注入。但宿主 dev 入口（packages/cli/shell/src/host.tsx）
 * 只挂了裸 `ConfigProvider`，从未挂 `JSSThemeProvider`。当 /demo 路由解析到
 * ContainerLayout（默认布局）时，header 的 NotificationPopup 因 theme 缺失而崩溃。
 *
 * 修复：让运行时布局自洽——`ContainerLayout` 自身用 `JSSThemeProvider` 包裹 chrome，
 * 不再依赖宿主是否挂载 Provider（见 packages/runtime/src/layout/container-layout）。
 *
 * 本测试在「宿主式接线」（仅 ConfigProvider、无外层 JSSThemeProvider）下渲染
 * ContainerLayout，断言其 chrome 能正常渲染、不再抛 colorBorder 崩溃。
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
	process.on("unhandledRejection", (reason) => {
		console.warn("[container-layout-test] unhandledRejection:", (reason as Error)?.message ?? reason);
	});

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
});

describe("containerLayout 自带 JSSThemeProvider（Error 2 回归）", () => {
	it("宿主式接线（无外层 JSSThemeProvider）下渲染 chrome 不抛 colorBorder", async () => {
		const { default: ContainerLayout } = await import("#src/layout/container-layout");

		const root = document.createElement("div");
		document.body.appendChild(root);

		// 关键：只挂裸 ConfigProvider，故意不挂 JSSThemeProvider，
		// 复刻 packages/cli/shell/src/host.tsx 的接线。修复前这里会抛
		// `Cannot read properties of undefined (reading 'colorBorder')`。
		// 用 data router（createMemoryRouter + RouterProvider）提供 react-router
		// 数据路由上下文（ContainerLayout 内部 useMatches / useOutlet 需要）。
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
		render(
			<ConfigProvider>
				<RouterProvider router={router} />
			</ConfigProvider>,
			{ container: root },
		);

		// header 渲染（含通知按钮等 jss 部件）——证明 token 已由 ContainerLayout 自供
		await waitFor(() => {
			expect(document.querySelector("header"), "ContainerLayout 应渲染 header（含 NotificationPopup）").toBeTruthy();
		}, { timeout: 15000 });

		// 不应残留 colorBorder 崩溃：header 内存在 antd 按钮即可
		expect(document.querySelector("header .ant-btn")).toBeTruthy();

		// 单一 chrome 回归：宿主式接线下 ContainerLayout 是唯一布局来源，
		// 必须恰好一个 <header> 与一个 <aside>（侧边栏）。若宿主又叠加自己的
		// Layout chrome（旧 Shell），会出现两个 header/aside —— 即布局混乱。
		expect(
			document.querySelectorAll("header").length,
			"应只有 ContainerLayout 一个 header（无宿主双层嵌套）",
		).toBe(1);
		expect(
			document.querySelectorAll("aside").length,
			"应只有 ContainerLayout 一个侧边栏（无宿主双层嵌套）",
		).toBe(1);

		root.remove();
	}, 30000);
});
