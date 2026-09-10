# 登录模块化执行计划（Login as Module）

> 依据：`202609021142-login-module-design.md`（2026-09-02 评审修订版，固定路径 + 内置兜底 + 全屏布局）。
> 方法：TDD/BDD——每阶段先写用例再写实现；每阶段独立分支、独立合并、可回滚。
> 范围纪律：§5 推迟项（匿名通道 / `handle.brand` / `getLoginPath`）**不在本计划内**。

## 阶段总览

| 阶段 | 分支 | 内容 | 行为变化 |
| --- | --- | --- | --- |
| P0 | `feat/login-p0-request-decouple` | 白名单与 basename 解耦修复 | 无（纯重构 + 隐性 bug 修复） |
| P1 | `feat/login-p1-fullscreen-layout` | 布局注册表 + FullscreenLayout + 类型扩展 | 无（新增能力，无人消费） |
| P2 | `feat/login-p2-builtin-login-migrate` | 内置 login 同构改造 | 视觉等价（内置页换外壳渲染） |
| P3 | `feat/login-p3-route-dedup` | resolveLoginRoute 去重 + getRedirectPath 出口 | 有 login 模块时才可观测 |
| P4 | `feat/login-p4-reference-and-docs` | playground 参考实现 + 手册章节 | 仅 playground |

---

## P0 请求通道解耦（纯重构）

**目标**：`AUTH_LOGIN_PATH` 单一来源（SRP），白名单与页面路径脱钩；修子路径部署下 401 重复跳转。

### 用例（先写）

```gherkin
Feature: 请求白名单按接口路径判定
  Scenario: 登录接口不携带 token
    When 请求 "…/auth/login"
    Then 不注入 Authorization 头
  Scenario: 其他接口照常携带 token
    When 请求 "…/user/info"
    Then 注入 Authorization 头

Feature: 子路径部署下的 401 处理
  Scenario: 已站在登录页收到 401
    Given 应用部署在 BASE_URL="/app/"
    And 当前位于登录页
    When 任意接口返回 401 且无 refreshToken
    Then 不重复 goLogin 跳转
```

| 被测点 | 现状（bug） | 期望 |
| --- | --- | --- |
| 白名单命中依据 | 页面路径 `/login` 巧合同名 | 接口路径常量 `auth/login` |
| `request/index.ts:63` | `location.pathname === loginPath`，含 basename 恒 false | 剥离 BASE_URL 后比较 |
| `layout-effects/index.tsx:47` | 同上 | 同上 |

### 任务

- [x] T0.1 用例先行：`tests/runtime/request-whitelist.test.ts`（RED → GREEN）
- [x] T0.2 抽 `AUTH_LOGIN_PATH`（`utils/request/constants.ts`），白名单改接口路径判定（新增 `whitelist.ts` 的 `isAnonymousApi`）
- [x] T0.3 `request/index.ts:63` 改 `isLoginPathname(location.pathname)`（basename 感知；layout-effects 一处核实后无需改，见问题记录）
- [x] T0.4 `pnpm test` 340 全绿 + `typecheck` 干净 + `lint` 0 error

**预计耗时**：0.5 h

---

## P1 全屏布局能力

**目标**：布局注册表（OCP）+ `FullscreenLayout`（SRP/LSP）+ `RouteMeta` 可选扩展（ISP）。无消费者，行为零变化。

### 用例（先写）

```gherkin
Feature: fullscreen 布局
  Scenario: 渲染全屏外壳
    Given 路由 handle.layout = "fullscreen" 且为「父路由 + children」形态
    When 访问该路由
    Then DOM 中不存在 header / sidebar / tabbar
    And 存在品牌区（logo + 应用标题）、角落工具区、页脚
    And 内容区渲染 children 的 Outlet
  Scenario: 暗色主题自适应
    When 切换暗色模式
    Then 外壳背景随 token 切换
  Scenario: 未声明 layout 仍回落 Outlet
    Then 既有路由渲染不变（回归）
```

### 任务

- [x] T1.1 用例先行：`tests/runtime/fullscreen-layout.test.tsx`（解析 + DOM 无 sidebar）
- [x] T1.2 `resolveLayoutComponent` switch → 注册表 `layoutRegistry`（既有 case 平移，`resolve-layout.test.ts` 回归保行为）
- [x] T1.3 `RouteMeta` 扩 `layout: "fullscreen"` / `login?: boolean` / `internal?: boolean`（全可选）
- [x] T1.4 `layout/fullscreen-layout/index.tsx`：外壳自 `pages/login` 平移（视口/品牌区/工具区/横幅列/页脚 + Outlet）

**验证**：342 全绿 + typecheck 干净 + lint 0 error（59 warnings 为既有基线）

**实际耗时**：约 0.5 h（预计 1.5 h；外壳平移一次到位，无返工）

---

## P2 内置 login 同构改造

**目标**：内置 login 路由与模块形态完全同构（父路由 + children + fullscreen + `login` + `internal`），页面只剩内容区。视觉与交互逐像素等价。

### 用例（先写）

```gherkin
Feature: 内置登录页行为等价
  Scenario: 未登录访问 /login
    Then 渲染登录页（视觉与改造前一致）
  Scenario: 登录成功回跳
    Given URL 为 /login?redirect=/system/user
    When 登录成功
    Then 跳转 /system/user
  Scenario: 已登录访问 /login
    Then 回跳首页（或 redirect 目标）
```

### 任务

- [x] T2.1 用例先行：`tests/runtime/builtin-login-route.test.tsx`（路由形态 + DOM 等价，改造前 RED）
- [x] T2.2 `core/auth.ts` 改造为 fullscreen 外壳 + children，handle 打 `layout/login/internal`
- [x] T2.3 `pages/login/index.tsx` 删除外壳部分，只留内容区（FormModeContext + AnimatePresence）
- [x] T2.4 回归：`pnpm test` 344 全绿 + typecheck 0 error + lint 0 error + `pnpm build` 通过
- [x] T2.5 视觉回归：DOM 结构等价由 T2.1 用例固化（无既有登录 e2e 截图基线，不新建脚手架——见问题记录 3）

**偏差（与计划的差异）**：内置路由**显式挂 `Component: FullscreenLayout`** 而非「无 Component 由框架注入」——`baseRoutes` 不经 `resolveRouteLayouts`（`router/index.ts` 直接消费），若在路由创建处对全量 baseRoutes 补注入会翻转其他路由的隐式 Outlet 行为。运行时形态与模块完全同构，代价为零。

**实际耗时**：约 0.7 h（预计 1 h；含两个契约发现：RouteMeta.title 必填、document.title 取最后一级 match）

---

## P3 路由去重与出口

**目标**：`resolveLoginRoute` 幂等去重（启动 + `setAccessStore` 两个接入点，SRP/DRY）；`getRedirectPath` 出口收编 redirect 解析。

### 用例（先写）

```gherkin
Feature: login 路由去重
  Scenario: 无 login 模块
    Then /login 渲染内置兜底
  Scenario: 有 login 模块
    Then /login 只匹配一条且为模块页，路由表无重复 path
  Scenario: 直接落地 /login（首屏）
    Then 渲染模块页，无内置页闪现
  Scenario: logout 后停留登录页
    Given 已登录且有 login 模块
    When 退出登录
    Then 停在 /login 且渲染模块页（reset 后重新注册并再去重）
  Scenario: 非法 login 标记
    Given 模块在 /signin 上声明 login: true
    Then 标记被拒并告警
  Scenario: 多 login 模块
    Given 两个模块均合规声明 login: true
    Then 拓扑序首个生效，第二个告警忽略

Feature: getRedirectPath
  Then 数据表格：
  | search                    | 期望                |
  | ?redirect=/system/user    | /system/user        |
  | ?redirect=//evil.com      | VITE_BASE_HOME_PATH |
  | ?redirect=https://evil.com| VITE_BASE_HOME_PATH |
  | （无 redirect）            | VITE_BASE_HOME_PATH |
```

### 任务

- [x] T3.1 用例先行：`tests/runtime/login-route-dedup.test.ts`（10 例含数据表格全行；断言走匹配行为，见问题记录 5）
- [x] T3.2 `resolveLoginRoute`（无内部状态、可重入；重建根路由 + 同调用内回补获胜 login 路由）
- [x] T3.3 接入点 1：`index.tsx` bootstrap（`loadAll` 后、render 前）
- [x] T3.4 接入点 2：`setAccessStore` 合成处（`store/access.ts:42`）
- [x] T3.5 `getRedirectPath` 实现 + 收编 `password-login.tsx` 与 `auth-guard.tsx`（顺手移除 auth-guard 不再使用的 `useSearchParams`）
- [x] T3.6 login 标记校验（契约路径 + 多模块先到先得 + 告警）
- [x] T3.7 `index.ts` 导出 `getRedirectPath` + `runtime-exports.test.ts` 冻结清单 + cli `RUNTIME_STUB_SOURCE` 三处同步

**验证**：355 全绿 + typecheck 0 error + lint 0 error + build 通过 + circular-deps 回到基线 113（一度 211，见问题记录 6）

**实际耗时**：约 1.2 h（预计 2 h 内；RR 7.18 行为取证占大头）

---

## P4 参考实现与文档

**目标**：playground 写一个替换版 login 模块，验证「可替换」闭环；手册补章节。

### 任务

- [x] T4.1 `apps/playground/modules/src/login/`：参考实现（内容区自画，副标题与内置页可区分）
- [x] T4.2 playground e2e：`tests/e2e/layout/login-module.spec.ts`（/login 渲染模块内容 + 无 chrome）；全量 23/23 绿
- [x] T4.3 手册新增「§3.5 登录模块」章节 + §3.2 布局枚举补 `fullscreen`
- [x] T4.4 全量回归：355 全绿 / typecheck 0 error / lint 0 error / playground e2e 23 绿 / circular-deps 基线 113

**实际耗时**：约 1.2 h（预计 1.5 h；大头是问题记录 7/8 两个 dist 层坑的取证）

---

## 风险与关注

| 风险 | 缓解 |
| --- | --- |
| `patchRoutes` 不可删，去重接入点遗漏 → logout 后内置页残留 | 两个接入点各有专项用例（P3 用例 3/4） |
| 首屏直接落地 `/login` 闪现内置页 | bootstrap 接入点在 render 前，用例 3 固化 |
| P2 视觉回归 | 改造前先固化行为用例 + 截图对比 |
| 回归基线 | 每阶段收尾跑全量 test + e2e；异常即记录到本文「问题记录」 |

## 问题记录

| # | 分类 | 问题 | 处理 |
| --- | --- | --- | --- |
| 1 | 评审取证偏差 | 设计稿 §1 把 `layout-effects/index.tsx:47` 也列为 basename bug；实施核实它用 `useLocation()`（react-router 已剥离 basename），**无需修**。真正裸用 `location.pathname` 的只有 `request/index.ts:63` | P0 只修一处，设计文档已订正 |
| 2 | 环境 flaky | `pnpm test` 全量偶发 `ECONNREFUSED :3000`（CLI dev 类测试依赖本地端口），与本次改动无关，单跑复现通过 | 记录观察，不处理 |
| 3 | 反常规 | `RouteMeta.title` 是**必填**字段（`types.ts:20`），空 handle `{}` 不过类型检查；且 `document.title` 取路由 match 的**最后一级**（layout-effects），父路由拆壳后标题必须挂到子级，否则标签页标题丢失 | 子级 `handle.title` 补 `$t("authority.login")` |
| 4 | 验收手段缺口 | 登录页无既有 e2e 截图基线，「视觉逐像素等价」无对照物 | DOM 结构等价由组件测试固化；像素级回归留待 P4 playground e2e 一并覆盖 |
| 5 | 与文档不符（react-router 7.18） | `_internalSetRoutes` **不再替换稳定树**：落入 HMR 树（`setHmrRoutes`），`router.routes` 只读稳定树永不变；匹配走 `branches`（HMR 优先）；`patchRoutes` 在存在 HMR 树时**跳过 `updateState`**（不通知订阅者） | 观测断言一律走 `navigate` + `state.matches` 的匹配行为；重建后同一调用内回补获胜 login 路由，防直接落地 /login 闪现 404 |
| 6 | 反常规（循环依赖） | `resolve-login-route` 默认参数 import router 单例 → 引入 `router/index → layout → store/access → 本模块` 环，circular-deps 113 → **211**（+98） | 改依赖注入：`router`/`rootRoute` 由调用方传入（DIP），回到基线 113 |
| 7 | 反常识（构建产物退化） | runtime lib 构建**无 svgr 且 assetsInlineLimit=0**：`banner.svg?react` 在 dist 退化为 data URI 字符串，React `createElement(data:image/…)` 抛 InvalidCharacterError——内置 login 页在 shell 链从未渲染过，该缺陷潜伏至今才被 fullscreen 外壳暴露 | 外壳资产改 `?inline`（data URI 自包含）；记录为「dist 资产只能用 ?inline」规则 |
| 8 | 反常规（dev 体验） | playground/shell 链消费的是**预构建 runtime dist**：runtime 新增出口（getRedirectPath）后不重跑 `pnpm --filter @react-antd-module/runtime build` + shell build，模块加载报「does not provide an export」——报错点在模块侧，根因在宿主产物过期 | 排查路径记入此档；手册 §3.4 已注明 ram dev 架构（不热载宿主） |

## 执行小结（2026-09-02）

**关键过程**：五阶段全部按「用例先行（RED）→ 实现（GREEN）→ 全量回归」推进，
每阶段独立分支独立提交。评审收敛（固定路径 / 砍匿名通道）使 P0–P2 一路平顺；
真正的复杂度集中在 P3 的两个计划外发现：RR 7.18 把 `_internalSetRoutes` 挪进
HMR 树导致「稳定树不可观测 + patchRoutes 跳过 updateState」（问题 5），以及
router 单例默认参数引发的 +98 循环依赖（问题 6）——两者都靠源码级取证定案，
最终契约比设计稿更简（无内部状态、可重入、依赖注入）。P4 暴露两个 dist 层
潜伏坑（?react 退化、预构建产物不过期感知），修复同时修好了「内置登录页在
shell 链从未可渲染」的历史潜伏缺陷（问题 7）。

**各阶段耗时**：P0 约 0.4 h / P1 约 0.5 h / P2 约 0.7 h / P3 约 1.2 h / P4 约 1.2 h，
合计约 4 h（预计 6.5 h，评审砍范围省下 ~2.5 h 主要落在 P3 不再有 getLoginPath 全链改造）。

**最终验证基线**：vitest 355 全绿（新增 18 例）、typecheck 0 error、lint 0 error、
playground e2e 23/23、circular-deps 基线 113、runtime/shell/主仓三级 build 通过。
