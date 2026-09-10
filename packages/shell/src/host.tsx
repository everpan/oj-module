/* eslint-disable react-refresh/only-export-components -- 应用入口（挂载 #root），非可热替换组件模块 */
/**
 * 预构建宿主（shell）入口。
 *
 * 注意：本文件是应用入口（挂载到 #root），并非可被 fast-refresh 热替换的
 * 组件模块，因此关闭 react-refresh/only-export-components。
 *
 * 设计要点（设计文档 §4.4 / §4.7）：
 * - 宿主只负责「加载外部模块 + 渲染容器」，不内置任何业务模块；
 * - 所有共享依赖（react / antd / runtime …）由 importmap 注入，宿主本身
 *   external 这些裸说明符，保证与模块命中同一份实例（单例，D5/D12）；
 * - 模块通过 `loadAll(manifest)` 加载，`getRoutes()` 收集路由后注入 react-router；
 * - 路由根只渲染「容器」（`Outlet`），**整站 chrome（侧边栏 / 顶栏 / 页签）由模块
 *   自带的 `ContainerLayout` 提供**（模块路由默认 layout=container）。宿主刻意不
 *   再叠加自己的 Layout chrome —— 否则会出现「宿主侧栏 + 模块侧栏」双层嵌套的混乱布局；
 * - 本文件编译进 `host.js`，其余共享依赖编译进各自的单入口 ESM（见 scripts/build.mts）。
 */

import type { HostModule } from "./preload";
import { StyleProvider } from "@ant-design/cssinjs";
import {
	getRoutes,
	LayoutEffects,
	loadAll,
	setupI18n,
	useAuthStore,
	usePreferences,
	useUserStore,
} from "@react-antd-module/runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import {
	createBrowserRouter,
	Navigate,
	Outlet,
	RouterProvider,
} from "react-router";
import { extractRuntimeVersion, toLoaderManifest } from "./manifest";
import { collectPreloads } from "./preload";
import { assertTrustedModules } from "./trust";

const queryClient = new QueryClient();

// 免登录演示宿主：无登录流程填充 user store，头像/用户名恒为空兜底
// （UserIcon 人形图标）。播种演示用户（与 App 链 fake 数据一致），
// 保持两链显示同构——playground 显示差异调查
// docs/prd/202609011045-playground-display-parity-plan.md 差异项 3
const DEMO_USER = {
	id: "1",
	avatar: "https://avatars.githubusercontent.com/u/47056890",
	username: "Admin",
	email: "",
	phoneNumber: "",
	description: "manager",
	roles: ["admin"],
};

useUserStore.setState(DEMO_USER);

/**
 * 登录/登出都会经 auth store reset() 清空 user store；宿主链无 AuthGuard
 * 重新拉取 userInfo，播种丢失后头部用户名/角色恒为空。这里在 token 变化
 * 时重播种演示用户（模块路由的重登记由 access store reset() 快照机制负责）。
 */
useAuthStore.subscribe((state, prev) => {
	if (state.token !== prev.token) {
		useUserStore.setState(DEMO_USER);
	}
});

// i18n 由 runtime 的 setupI18n 统一初始化：装载框架 translation 命名空间
// （preferences/common 等）。此前这里以空 resources 自行 init，框架级文案
// 全部裸奔成 key（e2e 基线偏差 2）。模块命名空间仍由 loadAll 合并。
let i18nReady = false;

function ensureI18n() {
	if (!i18nReady) {
		setupI18n();
		i18nReady = true;
	}
}

function Boot() {
	const [router, setRouter] = useState<ReturnType<typeof createBrowserRouter> | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				ensureI18n(); // setupI18n 为同步初始化，无需等待

				// 模块清单与宿主版本矩阵并行拉取（versions.json 提供
				// peerRuntime 校验所需的宿主 runtime 版本，P7.6；404 容忍——
				// 拿不到则跳过版本校验并告警，不阻断启动）。
				// 必须基于 BASE_URL 取绝对路径：相对 "./" 在深链接（如
				// /demo/detail 直接刷新）下会解析成 /demo/modules.json → 404
				// （layout e2e M3 深链接用例暴露）
				const base = import.meta.env.BASE_URL ?? "/";
				const [res, versionsRes] = await Promise.all([
					fetch(`${base}modules.json`),
					fetch(`${base}versions.json`).catch(() => null),
				]);
				if (!res.ok)
					throw new Error(`modules.json 加载失败：HTTP ${res.status}`);
				const list: HostModule[] = await res.json();
				const runtimeVersion = versionsRes?.ok
					? extractRuntimeVersion(await versionsRes.json())
					: undefined;
				if (!runtimeVersion)
					console.warn("[shell] 未获取到宿主 runtime 版本（versions.json 缺失），peerRuntime 校验跳过");

				// P6.1 / D10 信任根：来源白名单校验在 CSS/预载/加载之前
				assertTrustedModules(list);

				// P4.6 / Spike B：外部模块的 tailwind/css 产物由模块侧构建、
				// 宿主侧 <link> 注入（在 loadAll 之前，避免样式闪断）
				for (const mod of list) {
					// P7.7 / US-9：enabled:false 的模块连 CSS 都不注入
					if (mod.enabled === false)
						continue;
					for (const href of mod.css ?? []) {
						if (!document.querySelector(`link[href="${href}"]`)) {
							const link = document.createElement("link");
							link.rel = "stylesheet";
							link.href = href;
							// R16 / §4.9 硬约束：模块 CSS 必须在宿主 CSS 之前注入——
							// 模块 CSS 必含 theme 层（A19），同 layer 后声明者胜出
							const firstStyle = document.head.querySelector("link[rel=\"stylesheet\"], style");
							if (firstStyle)
								document.head.insertBefore(link, firstStyle);
							else
								document.head.appendChild(link);
						}
					}
				}

				// P5.7 / L2 完整性：非 lazy chunk 预载时携带构建期产出的
				// sha384 integrity，浏览器加载前校验（在 loadAll 之前生效）
				for (const { href, integrity } of collectPreloads(list)) {
					if (document.querySelector(`link[rel="modulepreload"][href="${href}"]`))
						continue;
					const link = document.createElement("link");
					link.rel = "modulepreload";
					link.href = href;
					link.integrity = integrity;
					link.crossOrigin = "anonymous";
					document.head.appendChild(link);
				}

				// P7.7：清单字段原样透传（enabled/dependencies/peerRuntime），
				// loader 侧已有全部消费逻辑；裁剪曾导致 US-5/US-9 双双失效
				const manifest = toLoaderManifest(list, runtimeVersion);

				// 并发加载、拓扑排序、生命周期、i18n 合并（见 runtime module-loader）
				await loadAll(manifest);

				if (cancelled)
					return;

				setRouter(
					createBrowserRouter([
						{
						// 路由根只渲染容器（Outlet），整站 chrome 由模块自带的
						// ContainerLayout 提供；宿主不叠加自己的 Layout chrome，
						// 避免「宿主侧栏 + 模块侧栏」双层嵌套（布局混乱）。
							path: "/",
							// 全局副作用与 <Outlet /> 并列挂载：LayoutEffects 不含
							// AuthGuard（宿主免登录），但暗色类/动态标题/NProgress
							// 必须与 App 链路同源（偏差 4）
							element: (
								<>
									<LayoutEffects />
									<Outlet />
								</>
							),
							// 落地 `/` 时跳到首个模块路由，确保模块 ContainerLayout 立即渲染
							// （否则根 Outlet 无匹配子路由会空白）。等同全量 App 的
							// `/` → VITE_BASE_HOME_PATH 重定向语义。
							children: [
								{ index: true, element: <Navigate to={getRoutes()[0]?.path ?? "/"} replace /> },
								...getRoutes(),
							],
						},
					]),
				);
			}
			catch (e) {
				if (!cancelled)
					setError(e instanceof Error ? e.message : String(e));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	if (error) {
		return (
			<div style={{ padding: 24 }}>
				模块加载失败：
				{error}
			</div>
		);
	}
	if (!router)
		return <div style={{ padding: 24 }}>宿主初始化中…</div>;

	return <RouterProvider router={router} />;
}

/**
 * 主题边界：ConfigProvider 响应 preferences 的暗黑/主色/圆角，与 App 链
 * app.tsx 的 theme 计算同源同值（customAntd* 主题均为空对象，无需复制）。
 * 此前硬编码 defaultAlgorithm——切暗黑后侧栏（tailwind dark: 类）变暗而
 * antd 组件仍亮色，顶栏图标白色融进白底「消失」——playground 全量模块
 * 暗黑对比（docs/prd/202609010056-playground-full-modules-plan.md）暴露。
 */
function HostProviders() {
	const { isDark, themeColorPrimary, themeRadius, sideCollapsedWidth } = usePreferences();
	return (
		<StyleProvider layer hashPriority="high">
			<ConfigProvider
				theme={{
					cssVar: {},
					hashed: false,
					algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
					token: {
						borderRadius: themeRadius,
						colorPrimary: themeColorPrimary,
					},
					components: {
						Menu: {
							darkItemBg: "#141414",
							itemBg: "#fff",
							collapsedWidth: sideCollapsedWidth,
						},
					},
				}}
			>
				<AntdApp>
					<QueryClientProvider client={queryClient}>
						<Boot />
					</QueryClientProvider>
				</AntdApp>
			</ConfigProvider>
		</StyleProvider>
	);
}

const rootElement = document.getElementById("root");
if (rootElement) {
	createRoot(rootElement).render(<HostProviders />);
}
