# 登录模块设计（Login as Module · 全屏布局 · 固定路径）

> 目标：把 login 从 runtime 内核路由改造成**可替换的业务模块**，
> 同时保证**核心登录流程逻辑不变**，并为其提供框架级的**全屏布局**模式。
>
> 前置阅读：`module-development-guide.md`（模块手册，本文引用其中 D*/B*/O*/R* 编号）、
> `202608291145-framework-npm-package-implementation-plan.md`（设计文档）。
>
> 修订记录：2026-09-02 评审后收敛——**路径固定 `/login`（框架契约）**、
> 匿名请求通道 / `handle.brand` / `getLoginPath()` 三项推迟（见 §5）。

## 1. 现状

| 事实 | 位置 |
| --- | --- |
| login 是**内核硬编码路由**，不在模块体系 | `packages/runtime/src/router/routes/core/auth.ts:10-19`，`path: loginPath`，随 `baseRoutes` 常驻（`router/routes/index.ts:26-29`） |
| 它靠**绕过布局**而非声明布局实现全屏 | `resolveRouteLayouts` 只对「无 Component + 有 children」的父路由注入布局（`router/utils/resolve-layout.ts:36-45`），login 是叶子路由，故天然无 chrome |
| 页面本体 | `packages/runtime/src/pages/login/index.tsx`（`h-screen` + 绝对定位 header） |
| 唯一发起登录请求处 | `pages/login/components/password-login.tsx:32-60`（`useAuthStore(s => s.login)` + 读 `?redirect=`）；register/forgot/code 三个表单是纯 UI 空壳 |
| 流程核心 | `store/auth.ts`（login/logout/reset）、`router/guard/auth-guard.tsx:243-302`、`utils/request`（401 → refresh → goLogin）、`api/user` |
| 无第二份实现 | `apps/` 仅 `playground`；`packages/shell` 无 AuthGuard、无 login |

### 硬障碍（评审后重估）

1. ~~`loginPath` 硬编码 5 处以上~~ → **不再是障碍**：路径固定为框架契约后，这些硬编码是**正确实现**而非技术债，原地保留。
2. **退出登录会丢登录入口（死锁风险）**：`store/access.ts:57` 的 `reset()` 执行 `router._internalSetRoutes(rootRoute)`，而 `rootRoute` 的 children 就是 `baseRoutes`（`router/index.ts:22-27`）。login 若只活在模块路由里，退出后即消失。→ 内置兜底常驻 `baseRoutes` 解决。
3. **登录页 import 了大量 `#src/` 内部资源**（模块红线禁止）：`logo.svg`、`banner.svg`、`LayoutFooter`、`ThemeButton`、`LanguageButton`、`usePreferences`、`useLayoutMenu`。→ 全屏外壳收编解决。

### 附带发现的隐藏耦合（本方案顺手修）

1. `utils/request/index.ts:15` 的 `requestWhiteList = [loginPath]` 靠 `request.url.endsWith("/login")` 命中接口 `auth/login`——**页面路径与接口路径只是巧合同名**。
2. `utils/request/index.ts:63` 用**原始 `location.pathname`**（含 basename）与 `loginPath` 比较——子路径部署（微前端同域多应用）下该判断恒为 false，401 时已站在登录页也会重复跳转。（`layout-effects/index.tsx:47` 不在此列：它用 `useLocation()`，react-router 已剥离 basename——P0 实施时核实修正。）

## 2. 设计决策

| 决策点 | 结论 |
| --- | --- |
| 替换粒度 | **路径固定 `/login` + 组件可替换 + 内置兜底**：模块用 `defineModule` 声明 `handle.login: true` 的路由替换内置页；清单没有或加载失败时回落内置页 |
| 路径为何固定 | `/login` 与 `/exception/403|404|500` 同为**框架契约路径**（P7.14 先例）。微前端多应用隔离已由 `basename`（`router/index.ts:77`）与 `goLogin` 拼 `BASE_URL`（`go-login.ts:13`）解决；统一 SSO 是外部重定向，与内部路由路径无关——可配路径不解决任何真实场景 |
| 识别方式 | **`handle` 标记**（`login: true`），不用「约定模块名」 |
| 全屏外壳 | 框架兜住视口/主题/品牌位/角落工具/页脚，模块只写内容区；**品牌区固定**（内置 logo + `VITE_GLOB_APP_TITLE`），`handle.brand` 推迟 |
| 请求通道 | **仅 `useAuthStore.login()`**；匿名前缀通道推迟（见 §5） |
| 内置兜底位置 | **留在 runtime 内部**（不进清单、不依赖加载，最稳） |

## 3. 登录契约：标记 → 去重

### 3.1 模块侧声明

```ts
routes: [
	{
		path: "/login",             // 契约路径，必须为此值
		handle: {
			layout: "fullscreen",   // 框架级全屏布局
			login: true,            // “我是登录页”
			hideInMenu: true,       // 不进菜单
		},
		children: [
			{ index: true, Component: lazy(() => import("./pages/login")) },
		],
	},
]
```

- **路径约束**：`login: true` 的路由 `path` 必须是 `/login`，否则 runtime 拒绝该标记并告警（契约测试固化）。
- **形态约束**：必须写成「父路由无 `Component` + 有 `children`」——`resolveRouteLayouts` 只在这种形态下注入布局（与手册 §3.2 既有约定一致）。
- 模块想换品牌：现阶段在内容区自画；品牌位配置化见 §5 推迟项。

### 3.2 runtime 侧出口

只新增一个出口 **`getRedirectPath()`**：收编 `password-login.tsx:42-48` 与 `auth-guard.tsx:287` 两处 `?redirect=` 解析，只放行站内路径（必须以 `/` 开头且拒绝 `//` 协议相对地址），非法值回落 `VITE_BASE_HOME_PATH`。模块登录页成功后调它跳转，避免每个 login 模块重复实现（且修掉 `password-login.tsx:44` 假设 redirect 必以 `/` 开头的隐式约定）。

`loginPath` 各硬编码调用点**一律不动**。

### 3.3 内外去重：`resolveLoginRoute`

- 内置兜底路由（`router/routes/core/auth.ts`）同样打 `login: true`，额外打 `internal: true`，并改造为「父路由 + children + `layout: "fullscreen"`」，与模块形态完全同构。
- **合成点唯一**：`setAccessStore`（`store/access.ts:39-53`）是 `baseRoutes` 与模块/动态路由合并的唯一入口（SRP/DRY），去重逻辑只挂在这是和启动引导两处，不散落。
- **技术要点**（P3 实施修订）：`router.patchRoutes` 只能增不能删；且 RR 7.18 起 `_internalSetRoutes` 落入 HMR 树（`router.routes` 只读稳定树、不可用于观测），重建会丢弃已 patch 的动态路由。故 `resolveLoginRoute(base, incoming, router, rootRoute)` 约定：重建根路由剔除 internal 条后，**同一调用内回补**获胜的外部 login 路由（否则直接落地 `/login` 闪现 404）；router/rootRoute 由调用方注入（DIP——默认 import 单例会引入循环依赖，实测 +98 环）。函数无内部状态、可重入：
  1. **启动时**：`index.tsx` 在 `loadAll` 之后、root render 之前调用一次——直接 `/login` 落地时不会闪现内置页；
  2. **`setAccessStore` 合成时**：logout 后 `reset()` 会恢复含 internal 条的 `rootRoute`，守卫 effect 重新注册模块路由时再次去重。
- **多模块仲裁**：两个以上模块声明 `login: true` 时，按拓扑序**先到先得**，其余告警忽略（确定性、可测试）。
- 去重**不能**放进 `getRoutes()`——后者每次实时计算，放进去会让模块看不到自己。

### 3.4 隐藏耦合修复

1. 抽 `AUTH_LOGIN_PATH = "auth/login"` 常量，`utils/request` 白名单改为接口路径判定，与 `loginPath` 彻底脱钩。
2. `request/index.ts:63` 改为 `isLoginPathname(location.pathname)`（剥离 BASE_URL 后比较），修子路径部署恒 false。

## 4. 全屏布局（fullscreen）

新增 `packages/runtime/src/layout/fullscreen-layout/index.tsx`。

| 谁 | 负责 |
| --- | --- |
| `FullscreenLayout`（框架） | 视口（`h-dvh` + 溢出控制）、主题背景（`token.colorBgContainer` / `colorPrimaryBg`，暗色自适应）、左上角品牌区（内置 logo + `VITE_GLOB_APP_TITLE`）、右上角工具区（`ThemeButton` / `LanguageButton` / `layoutButtonTrigger` 保留作布局预览）、底部 `LayoutFooter`、渲染 `Outlet` |
| login 模块 | 只写内容区（表单卡片 + formMode 切换） |

**与 `none` 的分工**：`none` 是裸 `Outlet`，框架不保证任何视口；`fullscreen` 是框架保证「占满视口 + 无 chrome + 主题正确 + 品牌位统一」。其他模块继续用 `container`。

**OCP 顺手改进**：`resolveLayoutComponent` 的 switch 改为布局注册表（`Record<layout, Component>`），新增布局只加注册项不改函数体。

**收益**：`ThemeButton`/`LanguageButton`/logo/页脚全部封在外壳内，**不需要新增导出**，模块零 `#src/` 依赖。

## 5. 推迟项（YAGNI 记录）

以下设计已在评审稿中完整论证（git 历史 `7e103c3` 版本 §3.1 brand / §5 匿名通道 / §3.2 getLoginPath），出现真实需求时按原设计增量实施，均不破坏本版契约：

| 推迟项 | 触发条件 | 增量形态 |
| --- | --- | --- |
| 匿名请求通道 `ctx.register.anonymousApiPrefix()` | 模块需对接**异构认证后端**（非宿主 `auth/login`） | 仅限 `login: true` 模块登记一个前缀；命中请求不注入 token、401 直接抛错不 refresh 不 goLogin |
| `handle.brand` 品牌区配置 | 出现「不动内容区只换品牌」的诉求 | 声明式 handle（字符串/i18n key，可序列化），外壳 `t(key)` 解析跨命名空间 |
| `getLoginPath()` 路径可配 | 出现非 `/login` 登录路径的真实诉求 | 扫模块路由取 `login: true` 的 path，5 处硬编码改调；须同步处理 `whiteRouteNames`（`routes/index.ts:41`）与多模块仲裁 |

## 6. SOLID 对照

| 原则 | 落点 |
| --- | --- |
| SRP | `FullscreenLayout` 只管全屏外壳；`resolveLoginRoute` 只做去重；`getRedirectPath` 只解析 redirect；`AUTH_LOGIN_PATH` 单一来源取代巧合同名 |
| OCP | 布局解析改注册表，新布局（含未来的其他全屏变体）只注册不修改；登录页可替换本身是「对扩展开放、对修改关闭」的直译 |
| LSP | `FullscreenLayout` 与其他布局同一契约：接收路由上下文、渲染 `Outlet`、不侵入内容区，可在 `resolveRouteLayouts` 中互相替换 |
| ISP | 模块登录契约最小化——只需 `handle.login` 一个标记 + 契约路径；`RouteMeta` 新增字段全部可选，既有路由零感知 |
| DIP | 登录模块依赖框架抽象出口（`getRedirectPath` / `useAuthStore` / `ctx`），不 import `#src/` 内部；外壳依赖 `handle` 元数据抽象而非具体模块 |

## 7. 落地顺序

每步可独立合并、可回滚；第 1–3 步是纯重构，行为不变。对应执行计划 `202609021227-login-module-implementation-plan.md`。

1. **P0**：抽 `AUTH_LOGIN_PATH` 常量，白名单改接口路径判定；修两处 `location.pathname` basename 判断
2. **P1**：布局注册表 + `layout/fullscreen-layout` + `RouteMeta` 扩 `layout: "fullscreen"` / `login` / `internal`
3. **P2**：`core/auth.ts` 改造为「父路由 + children + fullscreen + login + internal」，`pages/login/index.tsx` 外壳部分搬进 `FullscreenLayout`，页面只剩内容区
4. **P3**：`resolveLoginRoute` + 启动/`setAccessStore` 两处接入 + `getRedirectPath` 导出；同步 `tests/runtime/runtime-exports.test.ts` 冻结清单
5. **P4**：playground 参考实现（验证可替换）+ 手册新增「登录模块」章节与 `fullscreen` 布局条目

## 8. 测试

- 出口冻结：`tests/runtime/runtime-exports.test.ts` 同步新增 `getRedirectPath`
- 白名单：`auth/login` 请求不携带 token；判定与页面路径无关
- basename：子路径部署下，站于登录页收到 401 不重复 `goLogin`
- 无 login 模块 → `/login` 渲染内置兜底
- 有 login 模块 → `/login` 只匹配一条且是模块页（路由表无重复 path，内置条被剔除）
- 直接落地 `/login`（首屏）→ 渲染模块页，无内置页闪现
- logout 后仍停在 `/login` 且为模块页（验 `reset()` + 重新注册 + 再去重，障碍 2 回归）
- fullscreen 路由的 DOM 中不存在 header / sidebar / tabbar
- 非 `/login` 路径声明 `login: true` → 标记被拒并告警
- 两个 login 模块 → 拓扑序首个生效，第二个告警
- `getRedirectPath`：`?redirect=/system/user` → `/system/user`；`?redirect=//evil.com` → 回落首页

## 9. 风险

1. **`patchRoutes` 不可删**：去重必须重建根路由，接入点漏一处（启动 / `setAccessStore`）就会出现「内置页残留」——logout 后场景是回归高发区，§8 已列专项用例。
2. **`handle.login` 的来源**：只在**模块路由**里识别该标记，不应信任后端下发路由（契约测试固化）。
3. **导出冻结契约**：新增 `getRedirectPath` 属出口变更，须同步契约测试（P3 drift-prevention）。
4. **首屏闪现**：去重若只做在 `setAccessStore`，直接落地 `/login` 会先渲染内置页一帧——启动时（render 前）那一次调用不可省。
