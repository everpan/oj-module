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
 * - 模块通过 `loadAll(manifest)` 加载，`getHostRoutes()` 收集路由后注入 react-router；
 * - 路由根只渲染「容器」（`Outlet`），**整站 chrome（侧边栏 / 顶栏 / 页签）由模块
 *   自带的 `ContainerLayout` 提供**（模块路由默认 layout=container）。宿主刻意不
 *   再叠加自己的 Layout chrome —— 否则会出现「宿主侧栏 + 模块侧栏」双层嵌套的混乱布局；
 * - 本文件编译进 `host.js`，其余共享依赖编译进各自的单入口 ESM（见 scripts/build.mts）。
 */

import type { RouteObject } from "react-router";

import type { HostModule } from "./preload";
import { StyleProvider } from "@ant-design/cssinjs";
import { enUSIntl, ProConfigProvider, zhCNIntl } from "@ant-design/pro-components";
import {
	ANT_DESIGN_LOCALE,
	AntdApp,
	ErrorBoundary,
	getHostRoutes,
	getRoutes,
	LayoutEffects,
	loadAll,
	PageError,
	resolveApiBase,
	setupI18n,
	useAccessStore,
	useAuthStore,
	useGlobalStore,
	usePreferences,
	useUserStore,
} from "@oj-module/runtime";
import {
	MutationCache,
	QueryCache,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { ConfigProvider, theme } from "antd";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";

import {
	createBrowserRouter,
	Navigate,
	Outlet,
	RouterProvider,
} from "react-router";
import { extractRuntimeVersion, resolveModuleUrls, toLoaderManifest } from "./manifest";
import { collectPreloads } from "./preload";
import { resolveSiteBase } from "./site-urls";
import { assertTrustedModules } from "./trust";

/**
 * 全局失败收敛（框架层唯一构造点）。
 *
 * 宿主是唯一构造 QueryClient 的地方：模块页面的 useQuery/useQueryClient 上下文
 * 都来自此处，`ojm build` 对 shell-dist 全量合并，工程侧没有注入 defaults 的缝隙。
 * 原先裸 `new QueryClient()` 走 TanStack 默认 `retry: 3`，导致「必然失败也白等 3 次
 * 重试 + 请求层逐次弹 toast 刷屏」。
 *
 * 这里两处收敛：
 * - `retry: 1`：保留一次瞬时抖动重试，去掉默认 3 次的无效等待（mutations 默认不重试）；
 * - `QueryCache/MutationCache` onError：请求层 {@link handleErrorResponse} 已对
 *   HTTP 错误体弹 toast，此处只兜底「请求层未触达」的失败（网络中断 / 解析异常 /
 *   非响应错误），避免与其重复弹窗。
 */
function isHttpError(error: unknown): boolean {
	const maybe = error as { response?: { status?: unknown } } | null;
	return Boolean(maybe?.response && typeof maybe.response.status === "number");
}

function surfaceQueryError(error: unknown): void {
	if (isHttpError(error))
		return; // 请求层已弹 toast，避免重复
	const message = error instanceof Error && /fetch|network|timeout/i.test(error.message)
		? "网络异常，请检查网络连接后重试"
		: error instanceof Error
			? error.message
			: "请求失败";
	window.$message?.error(message);
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
		},
		mutations: {
			retry: 0,
		},
	},
	queryCache: new QueryCache({ onError: surfaceQueryError }),
	mutationCache: new MutationCache({ onError: surfaceQueryError }),
});

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

/**
 * 定角色：宿主链**没有 AuthGuard**（免登录演示能力绕开 LayoutRoot），没有任何
 * 机制拉 `/web/user-info`，于是 user store 的 roles 恒为演示值或空——而模块路由
 * 的角色过滤（B16，`config.requiredRoles`）与 superadmin 类前端判断都读它。
 * 后果实测：seed 的 admin 账号（roles=["superadmin"]）被 `["admin"]` 挡在
 * /system 路由外（404），成员资格入口也判不出来。
 *
 * - 有 token = 真实登录链 → 拉真实角色（must_change 悬挂期该端点仍返回 200）；
 *   失败则清空，不让演示角色冒充真实权限（401 由请求层兜底跳登录）；
 * - 无 token = 演示态 → 播种 DEMO_USER（与 App 链 fake 数据一致，两链显示同构）。
 */
async function hydrateUser(): Promise<void> {
	if (!useAuthStore.getState().token) {
		useUserStore.setState(DEMO_USER);
		return;
	}
	try {
		await useUserStore.getState().getUserInfo();
	}
	catch (e) {
		console.warn("[shell] /web/user-info 拉取失败，角色置空", e);
		useUserStore.getState().reset();
	}
}

/**
 * 登录/登出都会经 auth store reset() 清空 user store（宿主链无 AuthGuard 重新
 * 拉取），token 变化即重新定角色。
 */
useAuthStore.subscribe((state, prev) => {
	if (state.token !== prev.token) {
		void hydrateUser().then(() => {
			// 角色就位后按新角色重登记路由/菜单（B16）：Boot 期登记用的是当时的
			// 角色（无 token = 演示 admin / user-info 失败 = 空），SPA 登录后不重登
			// 记会沿用旧表——admin 看不到 /system、viewer 反而看得到，硬刷新才纠正。
			// Boot 早期 token 漂移时模块未加载，登记 base 子集，loadAll 尾部会覆盖。
			useAccessStore.getState().setAccessStore(getRoutes());
			repatchShellRoutes();
		});
	}
});

/**
 * 宿主路由根 id：patchRoutes 重登记的 parentId（与 runtime 的 ROOT_ROUTE_ID
 * 同名无碍——各自作用于各自 router 实例）。
 */
const SHELL_ROOT_ID = "shell-root";

/** Boot 建表后持有的宿主 router 实例；token 变化时按新角色快照重登记其路由表。 */
let shellRouter: ReturnType<typeof createBrowserRouter> | null = null;

/**
 * 宿主路由表 children：index 重定向 + 模块路由（getHostRoutes 同源重写）+
 * catch-all 兜底。Boot 建表与登录后重登记共用同一构建口，保证两处同源。
 */
function buildShellChildren() {
	const hostRoutes = getHostRoutes();
	return [
		{ index: true, element: <Navigate to={hostRoutes[0]?.path ?? "/"} replace /> },
		...hostRoutes,
		// 风险项 §9.1：非管理员直达角色受限路由（如 /system/*）时，
		// B16 过滤后该路由不在 getRoutes() 内 → React Router 无匹配。
		// 补 catch-all 渲染框架兜底页（替代默认「Unexpected Application
		// Error!」），title 取框架 404 文案（exception.notFoundTitle）。
		// 后端 403 仍是权限硬兜底，此页仅改善直链观感，不构成权限判断。
		{ path: "*", element: <CatchAll /> },
	];
}

/**
 * 按当前角色快照重登记宿主路由表（B16 回归，2026-10-24）。
 *
 * setAccessStore 内部的 router.patchRoutes 打的是 runtime 单例 router，而宿主
 * 渲染的是本文件 Boot 里自建的 router——仅调 setAccessStore 只会更新菜单
 * （access store），路由表保持 Boot 期快照。后果：Boot 期 user-info 失败
 * （后端闪断/过期 token 刷新失败）→ 角色空 → requiredRoles 门禁模块被过滤出
 * 路由表；随后 SPA 登录（不刷新页面）菜单回来了，但 /system/* 仍不在路由表里，
 * 直达恒落 catch-all 404「返回首页」，须硬刷新才恢复。
 */
/**
 * 宿主路由根（Boot 建表与登录后重登记共用同一形状，children 按当前角色快照生成）。
 *
 * 路由根只渲染容器（Outlet），整站 chrome 由模块自带的 ContainerLayout 提供；
 * 宿主不叠加自己的 Layout chrome，避免「宿主侧栏 + 模块侧栏」双层嵌套。
 * element 里同时挂 LayoutEffects（暗色类/动态标题/NProgress，与 App 链同源，偏差 4）
 * 与页面级 ErrorBoundary（模块路由不经 runtime LayoutRoot，缺它时渲染抛错整页白屏）。
 */
function buildShellRoot(): RouteObject {
	return {
		path: "/",
		id: SHELL_ROOT_ID,
		element: (
			<ErrorBoundary FallbackComponent={PageError}>
				<LayoutEffects />
				<Outlet />
			</ErrorBoundary>
		),
		children: buildShellChildren(),
	};
}

function repatchShellRoutes(): void {
	if (!shellRouter)
		return;
	// patchRoutes 只增不删：Boot 期按演示角色（admin）登记的 /system 已存在时，
	// 再次 patch 同 path 的新表不会替换旧表——superadmin 登录后菜单能拿到全部
	// 子项（access store 新表），但渲染路由仍是 Boot 期缺「站点设置/企微集成」
	// 的旧树，SPA 点击落 catch-all 404（2026-11-02 实测，硬刷新才恢复）。
	// 先 _internalSetRoutes 重建根（丢全部动态子路由，RR 7.18 起落入 HMR 树；
	// runtime resolveLoginRoute 同源用法），再按当前角色整棵补回。
	const internal = (shellRouter as unknown as { _internalSetRoutes?: (routes: RouteObject[]) => void })._internalSetRoutes;
	if (internal)
		internal.call(shellRouter, [buildShellRoot()]);
	else
		shellRouter.patchRoutes(SHELL_ROOT_ID, buildShellChildren());
	// patchRoutes 不触发重匹配（同 AuthGuard 补 replace 的语义）：登录重定向
	// 竞态下当前可能已停在 404 兜底上，按当前路径 replace 一次强制重新匹配。
	// state.location 为 basename 相对路径，直接回填不会双重拼接部署前缀。
	const { pathname, search } = shellRouter.state.location;
	void shellRouter.navigate(`${pathname}${search}`, { replace: true }).catch(() => {
		// 被更新的导航取消属正常竞态（登录重定向与重登记交叉），无需处理
	});
}

/**
 * 直链兜底页（catch-all 路由元素）。无匹配路由时渲染框架 `PageError`，
 * 把 title 设为框架 404 文案（`exception.notFoundTitle` = "404"），
 * 观感与无权限面板同构，替代 React Router 默认的「Unexpected Application Error!」。
 * 仅作观感兜底，权限判定仍由后端 403 硬执行。
 */
function CatchAll() {
	const { t } = useTranslation();
	return (
		<PageError
			error={{ status: 404, message: t("exception.notFoundTitle") }}
			resetErrorBoundary={() => {}}
		/>
	);
}

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

/**
 * 企微内 P0 早跳的目标 URL。只白名单透传 `corp` / `agent`：多企业专属链接
 * `/login?corp=X&agent=Y` 从工作台打开时，后端 `resolveWecomProfile` 必须拿到
 * 企业代码才能落到正确租户；不带参数会被 `corpSelf()` 吸到本企业，多家档案则
 * 直接 400「已授权多家企业」。票据 / redirect / error 等一律不透传。
 *
 * 与 index.html 内联 BOOT_JS（build.mts）同口径——那道先执行，这里是兜底：
 * 内联脚本被 CSP 拦下或抛异常时，模块加载完仍会走到这里。
 */
const EARLY_JUMP_PARAMS = ["corp", "agent"] as const;

function wecomEarlyJumpUrl(): string {
	const src = new URLSearchParams(location.search);
	const pass = new URLSearchParams();
	for (const key of EARLY_JUMP_PARAMS) {
		const v = src.get(key)?.trim();
		if (v)
			pass.set(key, v);
	}
	const qs = pass.toString();
	return `${resolveApiBase()}/auth/wecom/login${qs ? `?${qs}` : ""}`;
}

function Boot() {
	const [router, setRouter] = useState<ReturnType<typeof createBrowserRouter> | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				// P0 企微内早跳：跳过首屏与全部模块加载，直接进入企微授权。
				// 带 corp/agent 的专属链接要把企业代码透传过去（见 wecomEarlyJumpUrl）。
				if (typeof navigator !== "undefined" && /wxwork/i.test(navigator.userAgent) && location.pathname.endsWith("/login") && !new URLSearchParams(location.search).get("wecom_ticket")) {
					window.location.assign(wecomEarlyJumpUrl());
					return;
				}

				ensureI18n(); // setupI18n 为同步初始化，无需等待

				// 模块清单与宿主版本矩阵并行拉取（versions.json 提供
				// peerRuntime 校验所需的宿主 runtime 版本，P7.6；404 容忍——
				// 拿不到则跳过版本校验并告警，不阻断启动）。
				// 必须基于部署 base 取绝对路径：相对 "./" 在深链接（如
				// /demo/detail 直接刷新）下会解析成 /demo/modules.json → 404
				// （layout e2e M3 深链接用例暴露）；子路径部署（/oj）下裸 "/"
				// 同样会打到宿主机根，故 base 一律走 resolveSiteBase()。
				const base = resolveSiteBase();
				const [res, versionsRes, siteRes] = await Promise.all([
					fetch(`${base}modules.json`),
					fetch(`${base}versions.json`).catch(() => null),
					// 站点标题：匿名端点回传 DB 的 framework.site_title（站点设置页可改），
					// 注入 runtime store 供 Logo / 双列侧栏 / 全屏布局三处展示。失败静默 fallback
					// 构建期 VITE_GLOB_APP_TITLE，绝不阻断启动（与 versions.json 的 404 容忍同纪律）。
					fetch(`${resolveApiBase()}/system/login-methods`).catch(() => null),
				]);
				if (siteRes?.ok) {
					try {
						const env = await siteRes.json() as { data?: { site_title?: unknown } };
						const title = env?.data?.site_title;
						if (typeof title === "string" && title.trim())
							useGlobalStore.getState().setSiteTitle(title);
					}
					catch { /* 站点标题是增强面，解析失败不阻断启动 */ }
				}
				if (!res.ok)
					throw new Error(`modules.json 加载失败：HTTP ${res.status}`);
				// 站内绝对 URL 在此一次性补齐部署 base（entry / css / chunks），
				// 后续信任根校验、样式注入、预载、loader 全部消费归一后的清单
				const list: HostModule[] = resolveModuleUrls(await res.json(), base);
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

				// 角色必须在 loadAll 之前就位：loadAll 尾部即用 getRoutes() 过滤
				// 角色受限模块并登记菜单（B16），晚了就按演示角色登记，admin 自己
				// 反而看不到 /system。
				await hydrateUser();

				// 并发加载、拓扑排序、生命周期、i18n 合并（见 runtime module-loader）
				await loadAll(manifest);

				if (cancelled)
					return;

				// 建表必须走 getHostRoutes（admin 路由与菜单管线同源重写 /system/<root>/*）——
				// 直接用 getRoutes() 时菜单指向 /system/... 而渲染路由表没有该路径，方案
				// 管理页菜单点击必 404（wiki admin/contacts 回归，2026-10）。
				// children 走 buildShellChildren 统一构建口：登录后 repatchShellRoutes
				// 按同一构建口重登记（B16 回归，2026-10-24）。
				shellRouter = createBrowserRouter([buildShellRoot()], {
					/**
					 * 子路径部署（oj `mounts: [{ prefix: /oj, web: dist, spa: true }]`）：
					 * 不设 basename 时 react-router 看到的是含前缀的 `/oj/wiki/...`，
					 * 匹配不到模块路由（`routes[].path` 恒为 `/wiki/...`，无模块根以外的
					 * 前缀），深链刷新直接落 catch-all 404。取值同 modules.json 的
					 * base（`resolveSiteBase()`），保证资源与路由用同一个前缀。
					 *
					 * 浏览器 URL 不受影响：react-router 只是在匹配/生成时剥/补前缀。
					 */
					basename: base,
				});
				setRouter(shellRouter);
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
 *
 * AntdApp 必须来自 @oj-module/runtime 而非 antd：runtime 版在 antd App
 * 之上做两件事（设计 202609112121-shell-dark-css-vars-design）——
 * ① 把 token 同步为 :root 的 `--oo-*` 变量（tailwind 语义色工具类的唯一
 *   来源，缺则暗黑模式 footer 等透明露白）；② StaticAntd 挂载
 *   window.$message/$modal/$notification。
 */
function HostProviders() {
	const { language, isDark, themeColorPrimary, themeRadius, sideCollapsedWidth } = usePreferences();
	return (
		<StyleProvider layer hashPriority="high">
			<ConfigProvider
				locale={ANT_DESIGN_LOCALE[language as keyof typeof ANT_DESIGN_LOCALE]}
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
				<ProConfigProvider intl={language === "en-US" ? enUSIntl : zhCNIntl}>
					<AntdApp>
						<QueryClientProvider client={queryClient}>
							<Boot />
						</QueryClientProvider>
					</AntdApp>
				</ProConfigProvider>
			</ConfigProvider>
		</StyleProvider>
	);
}

const rootElement = document.getElementById("root");
if (rootElement) {
	createRoot(rootElement).render(<HostProviders />);
}
