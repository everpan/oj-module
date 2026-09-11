import path from "node:path";

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { PLAYGROUND_DIST_DIR } from "../helpers/paths";

/**
 * playground 无后端鉴权回归测试（模块与宿主用户体系解耦）。
 *
 * 这是“左侧菜单空白 / 模块页面不可见”缺陷的回归护栏：在 ojm dev 这类纯静态宿主
 * 下没有后端，AuthGuard 的 fetchUserInfo 永远失败，原本 `wholeMenus` 从不被填充、
 * 且未登录会被重定向到登录页，导致菜单空白。
 *
 * 修复后（runtime/module-loader 在 loadAll 完成时即将模块路由注册进 access store；
 * AuthGuard 对“模块路由”跳过登录/授权门槛），即便【不播种任何 auth/user/access
 * store】，模块菜单与模块页面也应正常渲染。本测试即验证此“无登录”链路。
 *
 * 与 playground-e2e.test.tsx 的唯一区别：不播种 useAuthStore/useUserStore/
 * useAccessStore —— 完全依赖 loadAll 的自动注册。
 */

const DEMO_ENTRY = path.join(PLAYGROUND_DIST_DIR, "modules/demo/0.1.0/entry.js");

beforeAll(() => {
	// 与 e2e 相同的 happy-dom 缺口补齐 + 无后端 fetch mock
	const noopFetch = ((_input: unknown, _init?: unknown) =>
		Promise.resolve(
			new Response(JSON.stringify({ data: {}, code: 0 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		)) as unknown as typeof fetch;
	globalThis.fetch = noopFetch;
	if (typeof window !== "undefined") {
		(window as unknown as { fetch: typeof fetch }).fetch = noopFetch;
	}
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
		console.warn("[no-auth] unhandledRejection:", (reason as Error)?.message ?? reason);
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
		catch (e) {
			console.warn("[no-auth] 无法覆盖 localStorage：", (e as Error).message);
		}
	}
});

afterEach(() => {
	cleanup();
});

describe("playground 无后端鉴权", () => {
	it(
		"不播种 auth 也能渲染 demo 菜单与页面（模块与用户体系解耦）",
		async () => {
			try {
				window.history.replaceState(null, "", "/react-antd-admin/privacy-policy");
			}
			catch (e) {
				console.warn("[no-auth] 无法设置初始 URL：", (e as Error).message);
			}

			const { setupI18n } = await import("#src/locales");
			const { loadAll } = await import("#src/module-loader");
			const { router } = await import("#src/router");
			setupI18n();

			const instances = await loadAll({
				modules: [{ name: "demo", entry: DEMO_ENTRY, enabled: true }],
			});
			const demo = instances.find(i => i.definition.name === "demo");
			expect(demo, "demo 模块应加载成功").toBeTruthy();
			expect(demo!.status).toBe("loaded");

			// 关键断言：loadAll 完成后，模块路由应已自动注册进 access store（无需登录）
			const { useAccessStore } = await import("#src/store/access");
			expect(
				useAccessStore.getState().wholeMenus.some(m => m.key === "/demo"),
				"loadAll 应自动把 /demo 注册进 wholeMenus（菜单解耦）",
			).toBe(true);

			// 注意：此处【不】播种 useAuthStore / useUserStore / useAccessStore.setAccessStore，
			// 完全模拟“无后端、未登录”的 ojm dev 场景。

			const { default: App } = await import("#src/app");
			const { TanstackQuery } = await import("#src/components/tanstack-query");

			const root = document.createElement("div");
			root.id = "root";
			document.body.appendChild(root);

			render(
				<TanstackQuery>
					<App />
				</TanstackQuery>,
				{ container: root },
			);

			await waitFor(() => expect(document.querySelector(".ant-app")).toBeTruthy(), {
				timeout: 15000,
			});

			// 未登录直接进模块路由 /demo：AuthGuard 对模块路由应放行（不重定向到登录页）
			await act(async () => {
				await router.navigate("/demo");
			});

			await waitFor(() => {
				expect(document.querySelector("header"), "默认布局应包含 header").toBeTruthy();
				expect(document.querySelector("aside"), "默认布局应包含 sidebar").toBeTruthy();
				expect(document.querySelector(".ant-menu"), "默认布局应包含 antd 菜单").toBeTruthy();
			}, { timeout: 15000 });

			// 菜单项应出现（wholeMenus 已含 /demo）。/demo 自补子路由后变 submenu，
			// index 子路由不再渲染为独立叶子项，匹配面含 submenu 标题（同 e2e T1 校准）
			await waitFor(() => {
				const items = Array.from(document.querySelectorAll(".ant-menu-item, .ant-menu-submenu-title"));
				const el = items.find((n) => {
					const txt = n.textContent ?? "";
					const id = n.getAttribute("data-menu-id") ?? "";
					return /演示模块|Demo Module|demo:menu\.demo/i.test(txt) || /\/demo/i.test(id);
				});
				expect(
					el,
					`未登录时侧边栏应出现 demo 菜单项；当前菜单项=${JSON.stringify(items.map(i => i.textContent))}`,
				).toBeTruthy();
			}, { timeout: 15000 });

			// 模块页面应渲染（不被 AuthGuard 的未授权 null 挡掉）
			await waitFor(
				() => expect(document.querySelector(".ant-card")).toBeTruthy(),
				{ timeout: 20000 },
			);
			expect(document.querySelector("main")?.textContent).toMatch(/模块加载成功|Module loaded/);

			root.remove();
		},
		60000,
	);
});
