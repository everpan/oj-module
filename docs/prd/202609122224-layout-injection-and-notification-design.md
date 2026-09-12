# 布局注入与通知互动设计（layout 注册表 + routesApi 补缺 + 通知 provider 互动 + 模板模块）

> 日期：2026-09-12 22:24（评审修订：同日 23:00；阶段规划：23:15）
> 状态：评审修订版通过，阶段化实施中（feat/layout-injection）
> 范围：`packages/runtime`（布局注册表 / api-provider 扩展）、`packages/cli/templates`（通知模块）、`apps/playground-oj`（dogfooding 同步升级）

## 修订版本

| 版本 | 日期 | 内容 |
| --- | --- | --- |
| v1.0 | 2026-09-12 22:24 | 初版（脑暴结论：方案 A 布局注册表 + routesApi + 通知 provider 互动 + 模板模块） |
| v1.1 | 2026-09-12 23:00 | 双角色评审修订：砍 G3 积木导出（→N6）、补 routesApi 契约边界、修正时序与降级语义、补实现期陷阱（§10 评审记录） |
| v1.2 | 2026-09-12 23:15 | 阶段规划（§11）：每阶段执行完毕小结追加到 §11，最后集中审查（Phase 7） |
| v1.3 | 2026-09-12 23:30 | 实施启动：TDD 先行（Phase 1 用例已落 `tests/runtime/layout-registry.test.ts`），进入 Phase 1 运行时布局注册表实现 |

## 1. 背景与问题

### 1.1 现状摸底（事实，非推测）

layout 的外部依赖分数据依赖与 UI 组成两类。注入机制已存在（D9 provider 注册表 + P3.6 插槽）：

| 依赖点 | 现状 | 注入口 |
| --- | --- | --- |
| 通知拉取 | ✅ 已委托（`#src/api/notifications` 内 provider 优先，回落内置 root 级） | `ctx.register.notificationsApi` |
| 登录/登出/取用户 | ✅ 已委托（auth/user store 内 provider 优先） | `ctx.register.authProvider` |
| 角色/菜单管理 API | ✅ 已委托 | `ctx.register.systemApi` |
| 头像/附件上传 | ✅ 已委托 | `ctx.register.uploadApi` |
| header 操作区 UI | ✅ 插槽 `useSlotNodes("header-actions")` | `ctx.registerSlot` |
| **动态菜单/路由数据** | ❌ 硬编码：`auth-guard.tsx` 直调 `fetchAsyncRoutes()`（`web/get-async-routes`） | 无 |
| **整套布局 UI** | ⚠️ 半可替换（见下） | 无 |

「整套布局 UI」严格说半可替换：模块声明 `handle.layout: "none"` + 父路由自带 wrapper Component，**今天就能给自己的路由换任意 chrome**。真正不可做的是两点：

- (a) 覆盖**内建名**的语义——让别人写的 `"container"` 解析到自己的组件；
- (b) 替换**别的模块 / 后端下发路由**的布局。

G1 的价值正是这两点（评审 P2-8 修正）。

### 1.2 通知互动缺口（比预想大）

1. `NotificationPopup` 的 UI 早已定义 4 个互动事件（`read` / `makeAll` / `clear` / `viewAll`，`widgets/notification/index.tsx:33`），但 `NotificationContainer` 未传 `onEventChange` —— 「全部已读」「清空」按钮是摆设；
2. `NotificationItem` 无 `id` 字段（DB 表有 `id` 列），单条已读无处下手；
3. `NotificationsApiProvider` 只有 `fetchNotifications`，无任何写操作；
4. cli 模板侧只有 root 级只读兜底端点（`api/src/notifications`，已豁免契约检查），无 notification web 模块；playground-oj 有模块但契约也只读；
5. `NotificationContainer` 有 20x 复制残留（`notification-container.tsx:19` 的 `Array.from({length:20}).flatMap(() => list)`），接 id/markRead 前必须先删，否则同一 id 复制 20 份（评审工程 b4）。

### 1.3 关键时序事实（设计成立的前提）

模块 `onInit` 在 `loadAll` 内被**整体 await**（`module-loader/index.ts:236-238`），而全部布局解析点都更晚：

- `module-loader/index.ts:263 → :297` —— loadAll 结束后 `getRoutes()` 内 `resolveRouteLayouts()`；
- `generate-routes-from-backend.ts:106` —— 登录后守卫内，后端动态路由到达时。

因此「onInit 内（含 await 之后）完成的注册先于一切解析」天然成立，**不需要** manifest priority 字段、两阶段 loadAll 或「特权模块」概念；「先到先得 + 重复警告」即优先级语义（与现有 4 个 provider 一致）。

## 2. 目标与非目标

### 2.1 目标（SMART）

- G1：模块可经 `ctx.register.layout(name, component)` 注册新布局名或覆盖内建名（`container` / `fullscreen` / `parent`），覆盖在路由解析前生效。**覆盖内建名 = 自担 chrome 全部职责**（keepAlive 页签缓存、通知铃、header-actions 插槽、preferences 抽屉等内建 chrome 能力全部失效需自建），适用于 intentionally 更简的 chrome；
- G2：`fetchAsyncRoutes` 增加 provider 委托缺口闭合（`ctx.register.routesApi`），layout 链路零硬编码外部 API；
- G4：通知 provider 扩展为全必填四方法（读 + 单条已读 + 全部已读 + 清空），`NotificationContainer` 接线互动事件；
- G5：cli 模板新增 uni-dev notification 模块（契约 + 端点 + web 模块注册 provider），`ojm init` 出来的工程开箱即有完整通知互动；
- G6：playground-oj 同步升级（契约加写端点、provider 补写方法），作为 dogfooding 验证。

> 原 G3（导出布局积木）经评审**砍掉**（评审 P0-1/A2）：无真实消费者背书；「模块能造出等价 container」需要的公开面（useTabsStore/KeepAliveLayer/LayoutTabbar/useMenu/JSSThemeProvider/…）恰是否决方案 C 的论据，从侧门重新引入不可接受。积木导出后置：等第一个真实需要等价 container 的模块出现时，按需逐个导出（届时每个导出有消费者背书）。

### 2.2 非目标（明确不做）

- N1：layout 物理剥离为独立模块（方案 C）——内部 store 耦合面过大，解耦收益由注册表已全拿到；
- N2：manifest priority / 两阶段 loadAll / 特权模块概念——先到先得已覆盖（其 merge 场景局限见 §7）；
- N3：`viewAll` 事件接线——模板无通知中心页（YAGNI），事件保留不接线；
- N4：root 级内置回落端点加写操作——无 provider 时互动降级只读即可；
- N5：widget 级更多插槽（header-left / sidebar-top 等）——现有 `header-actions` 够用，失控风险大于收益；
- N6：布局积木导出（原 G3，评审后置，理由见上）；
- N7：routesApi 下发「模块自有组件」的路由——provider 返回的路由按框架 pages glob 解析 component（评审 P0-2，见 §4.2）；模块自有组件路由请走模块路由而非 routesApi；
- N8：运行中布局热回落——模块卸载不提供已注入路由的布局回落（评审 P1-5，见 §7）。

## 3. 方案取舍记录（脑暴 + 评审结论）

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| A. 开放布局注册表 `ctx.register.layout` | ✅ 采纳 | `resolve-layout.ts` 已是注册表结构，与 authProvider/apiProvider 同构，无加载顺序问题 |
| B. widget 级插槽扩展 | ❌ 排除 | 只满足定制不满足整套替换，插槽数量失控 |
| C. layout 物理剥离为模块 + 优先级 | ❌ 排除 | `ContainerLayout` 耦合 tabs/preferences/keep-alive/menu 大量内部 store，公开面失控；bootstrap 引入特权层 |
| D. 声明式 `defineModule({ layouts: { container: X } })`（评审 P1-3 补充） | ❌ 本轮排除，记录备选 | 优势真实存在：构建期可见（`ojm merge`/`build` 可静态检测同名冲突）、无注册时序约束、卸载清理天然等价。本轮仍选 A 的原因：与现有 4 个 provider 注册表同构（一致性）；defineModule 契约面不动（cli `readModuleDefinition` 无需改）；命令式的 merge 盲区用「构建期警告」后续增强对冲成本更低。若未来做构建期冲突检测，D 是升级路径 |
| provider 写方法可选 | ❌ 排除 | 违背 D9「全量接管，不做部分托管」；存量仓内 provider 仅 playground-oj 一处，同 PR 升级可控；仓外老 bundle 用运行时存在性检查防御（§4.4） |
| `NotificationItem.id` 可选 | ❌ 排除 | 单条已读的前提；两个后端实现同 PR 补齐 |

## 4. 设计

### 4.1 布局注册表（G1）

新增 `packages/runtime/src/layout/layout-registry.ts`，与 `store/api-provider.ts` 同构：

```ts
interface LayoutRegistration {
	moduleName: string
	component: ComponentType
}

// 模块登记表（内建三个不进此表，作为回落）
const registrations = new Map<string, LayoutRegistration>();

export function registerLayout(moduleName: string, name: string, component: ComponentType): void
// 同名已存在（含内建名已被覆盖过一次）→ console.warn 忽略（先到先得）
export function getRegisteredLayout(name: string): ComponentType | undefined
export function unregisterLayouts(moduleName: string): void  // onDestroy 清理该模块全部登记
```

- `resolve-layout.ts`：`resolveLayoutComponent` 改为「先 `getRegisteredLayout(name)`，落空回落内建 `layoutRegistry`」；内建常量保持私有；
- `module-loader/index.ts`：`ctx.register.layout(name, component)` 挂到 register 上；卸载路径（`unloadModule`，与 `unregisterApiProviders` 同点，`module-loader/index.ts:328`）调 `unregisterLayouts(definition.name)`；
- **时序约束**（评审 P1-4/A1 修正）：注册必须在 `onInit` 返回的 promise resolve 前完成（同步或 await 之后均可——loadAll 整体 await onInit，解析点全在其后）；`onInit` 之外的延迟注册（fire-and-forget、`onActivate`）不保证生效。因此布局组件可以 `await import("./layout")` 动态分包后再注册；
- **类型放宽**（评审 P2-6）：`handle.layout` 从字面量联合改为模板联合，保留内建名补全：

```ts
layout?: "container" | "parent" | "fullscreen" | "none" | (string & {})
```

- **未知名 warn-once**（评审 P2-6/A6）：`resolveLayoutComponent` 对「非内建且注册表落空」的名字 `console.warn` 一次（warn-once 去重——该函数在 `getRoutes()` 里反复调用）。warn 放 `resolveLayoutComponent` 而非 `resolveRouteLayouts`，两条解析路径（模块路由 + 后端路由 `generate-routes-from-backend.ts:106`）都覆盖。已知限制：`resolveRouteLayouts` 只解析「无 Component 且有 children」的节点，叶子页面写错 layout 名永远静默——文档知情接受；
- **覆盖 container 的连带消失清单**（评审 b6）：通知铃挂在 LayoutHeader、header-actions 插槽、preferences 抽屉、keepAlive 页签缓存等都在内建 chrome 里，覆盖者不重建即整体消失。覆盖前请确认这是意图。

### 4.2 routesApi provider 补缺（G2）

- `store/api-provider.ts` 加：

```ts
export interface RoutesApiProvider {
	/**
	 * 返回后端动态路由。component 解析边界（评审 P0-2）：返回的路由按框架
	 * pages glob 解析 component（generate-routes-from-backend.ts），模块自有
	 * 组件的后端路由不在本契约内——请走模块路由（N7）。
	 */
	fetchAsyncRoutes: () => Promise<AppRouteRecordRaw[]>
}
```

- 委托收进 `#src/api/user` 的 `fetchAsyncRoutes` 内部（与 `#src/api/notifications` 的委托模式一致：provider 优先，回落内置 `web/get-async-routes`）；`auth-guard.tsx` 消费点不动；
- `module-loader` 挂 `ctx.register.routesApi(provider)`；`unregisterApiProviders` 同步清理；
- `AppRouteRecordRaw` 已是公开类型（`runtime/src/index.ts:81`），无出口缺口。

### 4.4 通知 provider 互动（G4）

**runtime 侧**：

```ts
// widgets/notification/types.ts
export interface NotificationItem {
	id: string | number   // 新增，必填——单条已读的前提
	avatar: string
	date: string
	isRead?: boolean
	message: string
	title: string
}

// store/api-provider.ts —— 四方法全必填（D9 全量接管）
export interface NotificationsApiProvider {
	fetchNotifications: () => Promise<NotificationItem[]>
	markRead: (id: string | number) => Promise<void>
	markAllRead: () => Promise<void>
	clearAll: () => Promise<void>
}
```

- `NotificationContainer` 接 `onEventChange`：`read` → `markRead(item.id)`；`makeAll` → `markAllRead()`；`clear` → `clearAll()`；成功后重新拉取刷新列表（把 useEffect 内联 fetch 提成可复用 `reload`；**重拉失败不清空现有列表**，评审 b4）；同时删除 20x 复制残留；
- **只读降级**（评审 A3/P2-7）：`NotificationPopup` 内部按 `onEventChange` 是否存在推导只读态（不加新 prop）——container 在以下两种情形不传 `onEventChange`：(a) 未注册 provider（内置回落）；(b) provider 存在但缺写方法（仓外老 bundle 版本漂移，`p.markAllRead is not a function` 防御，接线时一次性检查四方法存在性 + console.warn once）。只读态下「全部已读」「清空」按钮禁用、单条点击 no-op，`dot` 与列表展示不受影响；
- `viewAll` 不接线（N3）。

**契约兼容**：`id` 必填是公开类型的破坏性变更，发版说明标注（runtime 与 playground-oj 同版本发布）。**id 同步清单**（评审 A4）：仓内 `web/` dogfooding 模块、`fake/` mock、playground-oj 端点（`api/src/notification/notifications/api.ts` 查了 id 没返回，补 `id: Number(r.id)`）、模板 root 兜底端点（`templates/api/src/notifications/api.ts` 同款补 id）——HTTP 载荷无 TS 保护（BDD 5.3#6 已修正为契约 DEV 校验守护）。

### 4.5 cli 模板通知模块（G5）

模板新增 uni-dev notification 模块（对齐 playground-oj 形态）：

```
packages/cli/templates/
├── api/src/notification/
│   ├── contract.ts            # fetchNotifications + markRead + markAllRead + clearAll 四端点
│   ├── notifications/api.ts         # GET 列表（含 id；is_read 0/1 ↔ isRead 布尔）
│   ├── notifications/read/api.ts      # POST 单条已读（body: { id }）
│   ├── notifications/read-all/api.ts  # POST 全部已读
│   ├── notifications/clear/api.ts     # POST 清空
│   ├── migrations/0001__create_notifications.sql  # 表结构迁移至此模块
│   └── seed.sql                     # 种子迁移至此模块
└── web/src/notification/
    ├── entry.ts               # 无页面路由；onInit 注册 apiPrefix + bindRequest + notificationsApi
    └── client/                # ojm api 生成物，签入模板（与 playground-oj 一致，评审 b5）
```

- **表与种子归属**（评审 b3）：现有 root 级 `api/src/notifications/`（豁免兜底）与新 `api/src/notification/` 都声明 `notifications` 表会产生双 migration + 种子 id 冲突（INSERT OR IGNORE 先跑者赢，后者种子静默丢失）。决策：**migration/seed 迁归新 notification 模块**；root 兜底只保留只读查询端点（不再持有表结构与种子）。模板面向新工程，无存量迁移负担。跨模块表所有权是否被 oj 工具链校验未确认——实现期第一件事验证；
- `ojm init` 的钉版与豁免清单：root 兜底目录维持既有豁免；新模块走标准契约流，无需豁免。

### 4.6 playground-oj 同步升级（G6）

- `api/src/notification/contract.ts`：`notificationItem` 加 `id`；补 `markRead` / `markAllRead` / `clearAll` 三端点定义与 oj 实现（`notifications/api.ts` 补 `id: Number(r.id)`）；
- `web/src/notification/entry.ts`：provider 补三个写方法，委托生成 client；
- 重跑 `ojm api` 刷新生成物与 `routes.json` / `openapi.yaml`。

## 5. BDD 用例

### 5.1 布局注册表

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | 无模块登记 | `resolveLayoutComponent({layout:"container"})` | 返回内建 ContainerLayout |
| 2 | 模块 A 在 onInit 登记 `layout("container", X)`（允许 await 之后） | 同上解析 | 返回 X |
| 3 | 模块 A 已登记 `"container"`，模块 B 再登记 | B 的登记 | console.warn 忽略，解析仍得 X |
| 4 | 模块 A 登记新名 `"pro"` | `resolveLayoutComponent({layout:"pro"})` | 返回 A 的组件 |
| 5 | 模块 A 登记后卸载（unregisterLayouts） | 再调 `resolveLayoutComponent({layout:"container"})` | 回落内建 ContainerLayout（纯函数语义；运行中已注入路由不热回落，见 §7） |
| 6 | 未声明 layout | `resolveLayoutComponent({})` | 返回 Outlet（现状不变） |
| 7 | `layout: "contaienr"`（拼错的非内建名） | 解析 | warn-once 一次，返回 Outlet |

### 5.2 routesApi 委托

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | 未注册 routesApi provider | 调 `fetchAsyncRoutes()` | 走内置 `web/get-async-routes` |
| 2 | 模块注册 routesApi provider | 调 `fetchAsyncRoutes()` | 走 provider，内置不执行 |
| 3 | 提供模块卸载 | 再调 | 回落内置 |

### 5.3 通知互动

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | 已注册完整 provider | 点「全部已读」 | 调 `markAllRead`，列表重拉，dot 消失 |
| 2 | 已注册完整 provider | 点单条通知 | 调 `markRead(item.id)`，重拉后该项 isRead=true |
| 3 | 已注册完整 provider | 点「清空」 | 调 `clearAll`，重拉后列表为空 |
| 4 | 未注册 provider（内置回落） | 打开通知弹层 | 列表只读展示，互动按钮禁用、单条点击 no-op |
| 5 | provider 写方法 reject | 任一互动 | 列表保持原状，不崩溃（错误提示归 provider） |
| 6 | provider 缺写方法（老 bundle 漂移） | container 接线时 | 一次性 console.warn + 降级只读（同 #4） |
| 7 | 互动成功后的重拉失败 | 重拉 reject | 现有列表保持，不清空 |
| 8 | 后端返回缺 id 的项 | DEV 环境 | 契约 client 的 zod 校验抛 ContractApiError（HTTP 载荷无 TS 保护，以此守护） |

### 5.4 模板通知模块

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | `ojm init` 新工程 | `ojm api --check` | 0 error（notification 走标准契约流，豁免清单不新增） |
| 2 | 新工程启动 | 登录后点通知铃 → 全部已读 | DB `is_read` 全置 1，dot 消失 |
| 3 | 新工程启动 | 点「清空」 | notifications 表清空，弹层列表为空 |
| 4 | 新工程初始化 | 跑迁移与种子 | notifications 表由 notification 模块创建并播种，root 兜底端点可查询（无双份种子） |

## 6. 测试落点

- `tests/runtime/layout-registry.test.ts`：用例表 5.1 全覆盖（纯函数 + 注册表，无渲染）。**用例间隔离**：注册表是模块级 Map，每个用例前后 unregister/复位，否则互相污染（评审 A5）；
- `tests/runtime/` 内补 routesApi 委托用例（表 5.2）；
- `tests/runtime/` 内补 NotificationContainer 互动用例（表 5.3，happy-dom）；
- **两道出口冻结**（评审 A5）：`tests/runtime/runtime-exports.test.ts` 快照 + `packages/cli/src/build.ts` 的 `RUNTIME_STUB_SOURCE`（后者由 `runtime-exports.test.ts:141-151`「cli 的 runtime stub 覆盖全部运行时出口」守护）。本轮若新增运行时导出（type-only 导出编译期擦除，是否计入实现期核对），两处同步；
- 现有 `tests/runtime/resolve-layout.test.ts` 四条断言在内建作回落时保持绿，不受影响；
- `tests/cli/`：模板快照/清单类测试若涉及 templates 文件清单，同步更新。

## 7. 陷阱与反常规记录（实现期持续追加）

- ⚠️ **merge 场景覆盖胜者不可推理**（评审 P1-3）：加载顺序 = manifest 顺序 = `ojm merge` 命令行参数顺序（`cli/src/manifest.ts:24-41` 按 source 顺序 push，无冲突检测）。两团队 merge 参数顺序不同 → container 覆盖胜者不同，差异只在浏览器 console.warn 可见，构建期零信号。已知限制，本轮接受；对冲（entry 元数据 `provides` 自声明 + merge 构建期警告，或升级方案 D 声明式字段）列为后续可选增强；
- ⚠️ **卸载不热回落**（评审 P1-5/b1）：已注入运行中 router 实例的路由，其 Component 在解析时已固化为模块组件，`unregisterLayouts` 只影响后续解析，既有路由树不动——已打开页面会继续渲染已卸载模块的 chrome 直至整页刷新。已知限制（N8）；
- ⚠️ **onInit 抛错注册残留**（评审 b2）：onInit 先注册 layout 后抛错 → 模块标 error 不产路由，但注册表登记残留。现有 api provider 注册同款问题，属一致的历史行为，新注册表照搬继承，不本轮修；
- ⚠️ **布局注册的时序约束**：必须在 onInit 返回前完成（await 之后合法）；onInit 之外的延迟注册不保证生效（评审 P1-4/A1）；
- ⚠️ **叶子节点 layout 名静默**：`resolveRouteLayouts` 只解析「无 Component 且有 children」的节点，叶子页面写错 layout 名永远静默（评审 A6）——warn-once 只覆盖经解析函数的节点；
- ⚠️ **模板双模块同表冲突**（评审 b3）：migration/seed 已决策归 notification 模块；跨模块表所有权是否被 oj 工具链校验未确认，实现期第一件事验证；
- ⚠️ **20x 复制残留**（评审 b4）：接 id 前必须先删 `notification-container.tsx:19` 的 `Array.from({length:20})`；
- ⚠️ `NotificationItem.id` 必填是公开类型的破坏性变更，发版说明需标注（runtime 与 playground-oj 必须同版本发布）；
- ⚠️ 覆盖 `container` 的连带消失清单：keepAlive 页签缓存、通知铃、header-actions 插槽、preferences 抽屉等内建 chrome 全部失效需自建（评审 b6，已写入 §4.1）。

## 8. 实施顺序（依赖拓扑）

1. runtime：布局注册表（4.1）→ routesApi（4.2）→ 通知 provider 扩展 + container 接线 + 20x 残留删除（4.4）
2. playground-oj 同步升级（4.6）——验证 4.4 的 provider 契约
3. cli 模板 notification 模块（4.5，含表/种子迁移）
4. 出口冻结核对（如需）与各包 dist 重建（runtime dist 随仓库提交，勿忘）
5. 文档收尾：§9 补「实现记录与耗时」段落

## 9. 总结（实现完成后回填）

（待实现完成后补充：关键过程、耗时、偏差记录）

## 11. 阶段规划与执行小结（v1.2）

> 规则：每阶段执行完成后，把该阶段的**关键过程、耗时、偏差**追加到对应小节末尾；状态在规划表内更新。全部阶段完成后进入 Phase 7 集中审查。

| Phase | 内容 | 分支 | 状态 |
| --- | --- | --- | --- |
| 1 | runtime 布局注册表（§4.1）：layout-registry + resolve-layout 委托 + ctx.register.layout + 卸载清理 + 类型模板联合 + warn-once | feat/layout-injection | ✅ 完成 |
| 2 | routesApi provider 补缺（§4.2） | 同分支 | ✅ 完成 |
| 3 | 通知 provider 互动（§4.4）：四方法 + container 接线 + 20x 残留删除 + 只读降级 | 同分支 | 未开始 |
| 4 | playground-oj 同步升级（§4.6） | 同分支 | 未开始 |
| 5 | cli 模板 notification 模块（§4.5，含表/种子迁移） | 同分支 | 未开始 |
| 6 | 冻结核对（runtime-exports 快照 + RUNTIME_STUB_SOURCE）+ dist 重建 + §9 回填 | 同分支 | 未开始 |
| 7 | 集中审查：对全部变更派审查代理复核，按意见修复后收尾 | 同分支 | 未开始 |

### Phase 1: runtime 布局注册表

**执行小结**（2026-09-12 23:20，耗时约 35 分钟）：

- TDD 先红后绿：`tests/runtime/layout-registry.test.ts` 8 用例（BDD 5.1 七用例 + resolveRouteLayouts 走同一注册表 1 用例），用例间 `unregisterLayouts` 复位，与评审 A5 一致。
- 实现与 §4.1 设计零偏差：`layout-registry.ts`（模块作用域 Map，先到先得警告含落败模块名、`unregisterLayouts` 按 moduleName 清理）、`resolve-layout.ts`（模块登记 → 内建表 → warn-once → Outlet 三级）、`RouteMeta.layout` 模板联合放宽（评审 P2-6）、module-loader `ctx.register.layout` 接线 + `unloadModule` 注销。
- 关键过程：typecheck 暴露测试构造路由缺 `handle.title`（`AppRouteRecordRaw` 强制 NonIndexRouteMeta），补全后绿；eslint 自动修复 import 排序/引号。
- 偏差记录：无。全量 140 测试绿（27 文件）；`pnpm-workspace.yaml` 有一条 catalog 未使用 lint 报错为分支既有问题，与本阶段无关。
- 提交：`feat(runtime): phase 1 布局注册表（G1）`。commitlint 报 subject-case（"Phase" 大写）→ 改小写通过，记入工程反常识清单（commit subject 首词须小写）。

### Phase 2: routesApi provider 补缺

**执行小结**（2026-09-12 23:35，耗时约 15 分钟）：

- TDD 先红后绿：`tests/runtime/routes-api.test.ts` 4 用例（BDD 5.2 三用例 + 先到先得告警）；`#src/utils/request` 打桩避免回落用例真发请求。
- 实现与 §4.2 零偏差：`RoutesApiProvider`（契约含 component 解析边界注释，N7）、委托收进 `#src/api/user/fetchAsyncRoutes`（auth-guard 消费点不动）、`ctx.register.routesApi` 接线、`unregisterApiProviders` 扩为四注册表同清。
- 关键过程：mock 首次写成直接返回信封对象而非 `{json()}` 响应壳，红→修→绿；与既有 api-provider 测试同构，无新增模式。
- 偏差记录：无。全量 144 测试绿（28 文件），typecheck 干净。
- 提交：`feat(runtime): phase 2 routesApi provider（G2）`。

### Phase 3: 通知 provider 互动

（待执行）

### Phase 4: playground-oj 同步升级

（待执行）

### Phase 5: cli 模板 notification 模块

（待执行）

### Phase 6: 冻结核对 + dist 重建 + 文档收尾

（待执行）

### Phase 7: 集中审查

（待执行）

## 10. 评审记录（2026-09-12 23:00）

## 10. 评审记录（2026-09-12 23:00）

双角色评审（架构师 / 工程师），结论均为**有条件通过**，条件已全部落实于上文：

| 来源 | 意见 | 处置 |
| --- | --- | --- |
| 架构 P0-1 + 工程 A2 | G3 积木导出与方案 C 排除理由自相矛盾，无消费者背书 | ✅ 砍 G3 → N6，后置到真实需求出现 |
| 架构 P0-2 | routesApi 契约未定义 component 解析边界 | ✅ 方案 a：契约显式声明按 pages glob 解析 + N7 |
| 架构 P1-3 | 第四方案（声明式 layouts 字段）漏评；merge 场景覆盖胜者不可推理 | ✅ §3 补评估记录（备选升级路径）；merge 盲区入 §7 已知限制 |
| 架构 P1-4 + 工程 A1 | 「同步注册」约束与事实不符 | ✅ 改为「onInit 返回前完成」（§4.1/§7） |
| 架构 P1-5 + 工程 b1 | 卸载不热回落被用例掩盖 | ✅ N8 + BDD 5.1#5 改写 + §7 |
| 架构 P2-6 + 工程 A6 | 类型放宽对冲应在设计期定死 | ✅ 模板联合 + warn-once 于 resolveLayoutComponent（§4.1） |
| 架构 P2-7 | 仓外老 bundle provider 缺写方法的运行时防御 | ✅ 四方法存在性检查 + 降级只读（§4.4、BDD 5.3#6） |
| 架构 P2-8 | 「整套布局不可替换」表述失准 | ✅ §1.1 改写，G1 价值聚焦 (a)(b) |
| 工程 A3 | 「按钮禁用」在现有 props 上表达不了 | ✅ popup 按 onEventChange 存在性推导只读态（§4.4） |
| 工程 A4 | root 兜底/fake/playground 端点查 id 未返回 | ✅ id 同步清单（§4.4）；BDD 5.3#6 → #8 改为契约 DEV 校验守护 |
| 工程 A5 | 漏第二道冻结 RUNTIME_STUB_SOURCE；注册表测试需隔离 | ✅ §6 补 |
| 工程 b2/b3/b4/b5/b6 | 注册残留 / 种子冲突 / 20x 复制 / client 签入 / 连带消失清单 | ✅ §7 + §4.1/§4.4/§4.5 落实 |
