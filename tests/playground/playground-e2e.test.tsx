import path from "node:path";

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { PLAYGROUND_DIST_DIR } from "../helpers/paths";

/**
 * playground e2e（happy-dom 集成）。
 *
 * 模拟「宿主加载模块 → 挂载框架 App → 进入页面」的完整链路，覆盖用户要求的：
 *   1. runtime 可以加载
 *   2. 默认 layout 可以加载
 *   3. demo 菜单可以加载
 *   4. demo 页面可以切换
 *   5. 主题 / 图标等正常
 *
 * 关键约束：
 * - loadAll / setupI18n / 各 store 必须【动态】导入——其模块图会触发 preferences
 *   store（zustand persist）在求值期捕获 localStorage；若用顶层静态 import，求值发生在
 *   beforeAll 覆盖 localStorage 之前，会命中 happy-dom 那个拦截 setItem 的 Proxy。
 * - 框架的路由渲染被 AuthGuard 门控（isLogin + isAuthorized + isAccessChecked），
 *   且模块路由经 useAccessStore.setAccessStore() → router.patchRoutes 注入；
 *   故测试中为等价“已登录用户”播种这三个 store，再导航到 /demo。
 * - loadAll 的动态 import 带 @vite-ignore，无法直接 import .ts，故指向**已构建**
 *   的模块产物（plain JS）——既能在 vitest 内解析，又顺带验证了真实 artifact 与 runtime 的集成。
 */

const DEMO_ENTRY = path.join(PLAYGROUND_DIST_DIR, "modules/demo/0.1.0/entry.js");

/**
 * 失败现场自描述：本 flake 家族的历史症状是「vitest 只剩一句 timeout」
 * （如 18826ms 撞满 15s waitFor，连是哪一步超时都看不出来），缺现场信息致
 * 两轮排查均靠猜（19:05 修复轮、19:17 复报轮，见
 * docs/plans/20261023-1905-playground-e2e-flake.md）。任一断言失败时先把
 * URL / DOM 状态抖出再抛，下次复现即可直接定位卡点与 pathname 竞态终态
 * （keepalive 缓存命中 /demo vs index 重定向 /demo/todos）。
 * 读 window.location 而非 router.state：后者在测试体动态 import 作用域内，
 * 而 browser history 下二者等价（basename 前缀以窗口 URL 原样呈现）。
 */
function withFailureDump(fn: () => Promise<void>) {
	return async () => {
		try {
			await fn();
		}
		catch (e) {
			const has = (selector: string) => Boolean(document.querySelector(selector));
			const menuTexts = Array.from(
				document.querySelectorAll(".ant-menu-item, .ant-menu-submenu-title"),
			).map(node => node.textContent);
			console.error(
				`[e2e] 失败现场：location=${window.location.pathname}${window.location.search}`
				+ `，ant-app=${has(".ant-app")}，header=${has("header")}，aside=${has("aside")}`
				+ `，main=${has("main")}，menu=${has(".ant-menu")}，card=${has(".ant-card")}`
				+ `，icon=${has(".anticon")}，菜单项=${JSON.stringify(menuTexts)}`,
			);
			throw e;
		}
	};
}

// happy-dom 缺口补齐：antd Menu / Layout 依赖 ResizeObserver / matchMedia / IntersectionObserver
beforeAll(() => {
	// 测试环境无后端，所有 fetch 一律返回 200 空 JSON，避免 ECONNREFUSED 的
	// 未捕获 rejection 干扰渲染（通知轮询、版本检查、用户信息等均与模块化验证无关）
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

	// 测试环境无后端，fetch 已被上方 mock 为 200；残留的未捕获 rejection 多为
	// antd / happy-dom 内部噪音。仅告警不抛出——在 handler 内 throw 会中断 worker，
	// 造成用例非确定性崩溃。
	process.on("unhandledRejection", (reason) => {
		console.warn("[e2e] unhandledRejection:", (reason as Error)?.message ?? reason);
	});

	// happy-dom 的 localStorage 是个会拦截 setItem 的 Proxy，zustand persist 因此抛错。
	// 用可用实现整体替换 window.localStorage（与 globalThis.localStorage 同源）。
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
			console.warn("[e2e] 无法覆盖 localStorage：", (e as Error).message);
		}
	}
});

afterEach(() => {
	cleanup();
});

describe("playground e2e", () => {
	it(
		"runtime 加载 + 默认 layout + demo 菜单 + 页面切换 + 主题/图标",
		withFailureDump(async () => {
			// 初始 URL 指向一个“不触发守卫重定向”的静态路由（/privacy-policy 在白名单内）。
			// 不能直接以 /demo 作为首屏入口（实测会导致侧边栏菜单不渲染），也不能以 "/"
			// 作为入口（守卫会把 "/" 重定向到首页，与后续 navigate("/demo") 竞态）。
			// 挂载后再 navigate("/demo") 是验证过的稳定路径。
			// 注意：happy-dom 下 `window.location.href =` 赋值偶发被拒，改用同步可靠的
			// history.replaceState 设置初始入口。
			try {
				window.history.replaceState(null, "", "/react-antd-admin/privacy-policy");
			}
			catch (e) {
				console.warn("[e2e] 无法设置初始 URL：", (e as Error).message);
			}

			// 框架启动顺序：先 i18n，再加载模块（合并 i18n 资源 + 注册路由）
			const { setupI18n } = await import("#src/locales");
			const { loadAll, getRoutes } = await import("#src/module-loader");
			const { router } = await import("#src/router");
			setupI18n();

			const instances = await loadAll({
				modules: [{ name: "demo", entry: DEMO_ENTRY, enabled: true }],
			});
			// 模块必须真正加载成功（pro-components 等 CJS 依赖若出问题会在此失败）
			const demo = instances.find(i => i.definition.name === "demo");
			expect(demo, "demo 模块应加载成功（entry 可解析、依赖可读）").toBeTruthy();
			expect(demo!.status, `demo 模块加载状态应为 loaded，实际 ${demo!.status}`).toBe("loaded");

			// 回归：getRoutes() 必须自带按 path 生成的 id——菜单选中态（LayoutMenu
			// getSelectedKeys）依赖 useMatches 的 match.id；host.tsx 链路不经
			// auth-guard 的 addRouteIdByPath，缺 id 时菜单无高亮（e2e M2 暴露）
			// id 是 react-router 运行时属性，AppRouteRecordRaw 声明面未含，故收窄断言
			expect((getRoutes()[0] as unknown as { id?: string }).id).toBe("/demo");

			// 播种“已登录用户”三个 store：AuthGuard 门控 + 模块路由经
			// useAccessStore.setAccessStore() → router.patchRoutes 注入。
			const { useAuthStore } = await import("#src/store/auth");
			const { useUserStore } = await import("#src/store/user");
			const { useAccessStore } = await import("#src/store/access");
			useAuthStore.setState({ token: "e2e-token" });
			useUserStore.setState({ id: "1", roles: ["*"] });
			// 将已加载模块的路由注入运行时路由树（等价于 AuthGuard 登录后所做的 patchRoutes）
			useAccessStore.getState().setAccessStore(getRoutes());

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

			// 1) runtime 可以加载：挂载不抛错（antd ConfigProvider/AntdApp 始终渲染 .ant-app，
			//    无 IconContext.Provider 之类崩溃即证明 runtime 已加载）
			await waitFor(() => expect(document.querySelector(".ant-app")).toBeTruthy(), {
				timeout: 15000,
			});

			// 进入 demo 路由：运行时 App 的布局是“按路由”挂载的（ContainerLayout），
			// 初始 "/" 不渲染布局，需导航到 /demo 才出现默认布局 + 侧边栏菜单。
			await act(async () => {
				await router.navigate("/demo");
			});

			// 2) 默认 layout 可以加载：ContainerLayout 渲染自定义 chrome
			//    （<header> / <aside> / <main>），以及 antd 菜单容器 .ant-menu
			await waitFor(() => {
				expect(document.querySelector("header"), "默认布局应包含 header").toBeTruthy();
				expect(document.querySelector("aside"), "默认布局应包含 sidebar").toBeTruthy();
				expect(document.querySelector("main"), "默认布局应包含内容区 main").toBeTruthy();
				expect(document.querySelector(".ant-menu"), "默认布局应包含 antd 菜单").toBeTruthy();
			}, { timeout: 15000 });

			// 3) demo 菜单可以加载：侧边栏出现 demo 菜单项。
			//    以路由 key（data-menu-id 含 /demo）为主、文本案兜底（翻译前 key 或中英文案），
			//    避免因 i18n 时序导致只匹配不到翻译后文本。失败时打印全部菜单项便于定位。
			//    demo 模块自补 detail/about 子路由后 /demo 变 submenu，index 子路由不再
			//    渲染为独立叶子项（e2e T1 校准的同一事实），故匹配面含 submenu 标题。
			await waitFor(() => {
				const items = Array.from(document.querySelectorAll(".ant-menu-item, .ant-menu-submenu-title"));
				const el = items.find((n) => {
					const txt = n.textContent ?? "";
					const id = n.getAttribute("data-menu-id") ?? "";
					return /演示模块|Demo Module|demo:menu\.demo/i.test(txt) || /\/demo/i.test(id);
				});
				expect(
					el,
					`侧边栏应出现 demo 菜单项；当前菜单项=${JSON.stringify(items.map(i => i.textContent))}`,
				).toBeTruthy();
			}, { timeout: 15000 });

			// 4) demo 页面可以切换：
			//    先确认 demo 页面已渲染（模块内容 + i18n 生效），
			//    再离开到非 demo 路由，点击菜单切回，验证“菜单驱动切换”。
			//    注意：KeepAlive 层带 transition，happy-dom 不派发 transitionend，
			//    故页面节点需稍候才进入活动缓存（与真实浏览器 300ms 过渡同效，
			//    只是这里走 keepalive 的兜底定时器），直接等 .ant-card 最稳。
			await waitFor(
				() => expect(document.querySelector(".ant-card")).toBeTruthy(),
				{ timeout: 20000 },
			);
			expect(document.querySelector("main")?.textContent).toMatch(/模块加载成功|Module loaded/);

			// 离开 demo：切到不会触发重定向的静态路由（/ 会被守卫重定向到首页，
			// 与随后的 navigate("/demo") 竞态，导致 location 停留在 /home）
			await act(async () => {
				await router.navigate("/privacy-policy");
			});
			await waitFor(
				() => expect(router.state.location.pathname).not.toBe("/demo"),
				{ timeout: 15000 },
			);

			// 通过菜单点击切回 demo：验证“菜单驱动切换”（keepalive 命中缓存即时显示）。
			// 注意：happy-dom 无法触发 antd rc-menu 的 onClick（pointer/事件委托限制），
			// 而菜单项的 handleMenuSelect 最终就是调用 navigate(key)。这里用等价路由跳转
			// 验证「模块路由可被切回并重新渲染」这一模块化能力本身（菜单渲染见上方 point 3）。
			await act(async () => {
				await router.navigate("/demo");
			});
			// demo 模块的 index 子路由是 <Navigate replace to="/demo/todos">（entry 声明的
			// 直达重定向），但 keepalive 对 todos 页有缓存：二次进入 /demo 时，缓存命中路径
			// 会直出缓存页（旁路 index 的 Navigate，pathname 停在 /demo）；缓存未命中路径则
			// 先落 /demo 再重定向到 /demo/todos。两条路径都合法，断言稳定终态集合，
			// 页面内容断言（下方 .ant-card）锁定「模块路由可切回并渲染」这一能力本身。
			await waitFor(
				() => expect(["/demo", "/demo/todos"]).toContain(router.state.location.pathname),
				{ timeout: 15000 },
			);
			await waitFor(
				() => expect(document.querySelector(".ant-card")).toBeTruthy(),
				{ timeout: 15000 },
			);

			// 5) 主题 + 图标正常
			//    · antd ConfigProvider cssVar 注入主题变量（证明主题生效，且 IconContext 路径未崩）
			const appEl = document.querySelector(".ant-app") as HTMLElement;
			const primaryFromInline = appEl.style.getPropertyValue("--ant-color-primary");
			const primaryFromComputed = getComputedStyle(appEl).getPropertyValue("--ant-color-primary");
			expect(
				primaryFromInline || primaryFromComputed,
				"antd 主题 CSS 变量 --ant-color-primary 应已注入",
			).toBeTruthy();
			//    · @ant-design/icons 的 HomeOutlined 渲染为 .anticon（证明 IconContext 修复、图标可渲染）
			await waitFor(() => expect(document.querySelector(".anticon")).toBeTruthy(), {
				timeout: 15000,
			});

			root.remove();
		}),
		60000,
	);
});
