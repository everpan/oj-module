# 布局注入与通知互动设计（layout 注册表 + routesApi 补缺 + 通知 provider 互动 + 模板实现）

> 日期：2026-09-12 22:24
> 状态：设计已评审（脑暴结论经用户逐层确认），待实现
> 范围：`packages/runtime`（布局注册表 / api-provider 扩展 / 出口积木）、`packages/cli/templates`（通知模块）、`apps/playground-oj`（dogfooding 同步升级）

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
| **整套布局 UI** | ❌ 不可替换：`resolve-layout.ts` 的 `layoutRegistry` 是模块级私有常量 | 无 |

### 1.2 通知互动缺口（比预想大）

1. `NotificationPopup` 的 UI 早已定义 4 个互动事件（`read` / `makeAll` / `clear` / `viewAll`，`widgets/notification/index.tsx:33`），但 `NotificationContainer` 未传 `onEventChange` —— 「全部已读」「清空」按钮是摆设；
2. `NotificationItem` 无 `id` 字段（DB 表有 `id` 列），单条已读无处下手；
3. `NotificationsApiProvider` 只有 `fetchNotifications`，无任何写操作；
4. cli 模板侧只有 root 级只读兜底端点（`api/src/notifications`，已豁免契约检查），无 notification web 模块；playground-oj 有模块但契约也只读。

### 1.3 关键时序事实（设计成立的前提）

模块 `onInit` 在 `loadAll` 内完成，**早于**全部布局解析点：

- `module-loader/index.ts:297` —— `resolveRouteLayouts()` 在收集模块路由时执行；
- `generate-routes-from-backend.ts:106` —— 后端动态路由到达时执行。

因此「注册先于解析」天然成立，**不需要** manifest priority 字段、两阶段 loadAll 或「特权模块」概念；「先到先得 + 重复警告」即优先级语义（与现有 4 个 provider 一致）。

## 2. 目标与非目标

### 2.1 目标（SMART）

- G1：模块可经 `ctx.register.layout(name, component)` 注册新布局名或覆盖内建名（`container` / `fullscreen` / `parent`），覆盖在路由解析前生效；
- G2：`fetchAsyncRoutes` 增加 provider 委托缺口闭合（`ctx.register.routesApi`），layout 链路零硬编码外部 API；
- G3：runtime 公开出口补齐「模块能造出等价 container」的最小积木集（tabs store / keep-alive 等）；
- G4：通知 provider 扩展为全必填四方法（读 + 单条已读 + 全部已读 + 清空），`NotificationContainer` 接线互动事件；
- G5：cli 模板新增 uni-dev notification 模块（契约 + 端点 + web 模块注册 provider），`ojm init` 出来的工程开箱即有完整通知互动；
- G6：playground-oj 同步升级（契约加写端点、provider 补写方法），作为 dogfooding 验证。

### 2.2 非目标（明确不做）

- N1：layout 物理剥离为独立模块（方案 C）——内部 store 耦合面过大，解耦收益由注册表已全拿到；
- N2：manifest priority / 两阶段 loadAll / 特权模块概念——先到先得已覆盖；
- N3：`viewAll` 事件接线——模板无通知中心页（YAGNI），事件保留不接线；
- N4：root 级内置回落端点加写操作——无 provider 时互动按钮禁用即可；
- N5：widget 级更多插槽（header-left / sidebar-top 等）——现有 `header-actions` 够用，失控风险大于收益。

## 3. 方案取舍记录（脑暴结论）

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| A. 开放布局注册表 `ctx.register.layout` | ✅ 采纳 | `resolve-layout.ts` 已是注册表结构，与 authProvider/apiProvider 同构，无加载顺序问题 |
| B. widget 级插槽扩展 | ❌ 排除 | 只满足定制不满足整套替换，插槽数量失控 |
| C. layout 物理剥离为模块 + 优先级 | ❌ 排除 | `ContainerLayout` 耦合 tabs/preferences/keep-alive/menu 大量内部 store，公开面失控；bootstrap 引入特权层 |
| provider 写方法可选 | ❌ 排除 | 违背 D9「全量接管，不做部分托管」；存量 provider 仅 playground-oj 一处，同 PR 升级可控 |
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
- `module-loader/index.ts`：`ctx.register.layout(name, component)` 挂到 register 上；卸载路径调 `unregisterLayouts(definition.name)`；
- 时序约束写进文档：布局必须在 `onInit` **同步**注册（`await` 之后的注册可能晚于路由解析，不保证生效——与 `apiPrefix` 登记同一约束）；
- `handle.layout` 的类型从字面量联合放宽为 `string`（模块自定义名），内建三名保留文档与校验提示。

### 4.2 routesApi provider 补缺（G2）

- `store/api-provider.ts` 加：

```ts
export interface RoutesApiProvider {
	fetchAsyncRoutes: () => Promise<AppRouteRecordRaw[]>
}
```

- 委托收进 `#src/api/user` 的 `fetchAsyncRoutes` 内部（与 `#src/api/notifications` 的委托模式一致：provider 优先，回落内置 `web/get-async-routes`）；`auth-guard.tsx` 消费点不动；
- `module-loader` 挂 `ctx.register.routesApi(provider)`；`unregisterApiProviders` 同步清理。

### 4.3 公开出口积木（G3）

以「模块能造出等价 container」为准补最小集，逐一核对后定稿（候选：`useTabsStore`、`KeepAliveLayer`、`useLayout`）。每加一个导出同步更新 `tests/runtime/runtime-exports.test.ts` 冻结快照——红灯是预期行为，改动需在提交信息中说明。

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

- `NotificationContainer` 接 `onEventChange`：`read` → `markRead(item.id)`；`makeAll` → `markAllRead()`；`clear` → `clearAll()`；成功后重新拉取刷新列表；
- 未注册 provider（内置回落）：写操作不存在，互动按钮禁用（`disabled`），`dot` 与列表展示不受影响；
- `viewAll` 不接线（N3）。

**契约兼容**：`id` 必填是破坏性变更——存量 provider 仅 playground-oj 一处，同 PR 升级；根仓 `web/` dogfooding 模块与 `fake/` mock 同步补 `id`。

### 4.5 cli 模板通知模块（G5）

模板新增 uni-dev notification 模块（对齐 playground-oj 形态）：

```
packages/cli/templates/
├── api/src/notification/
│   ├── contract.ts            # fetchNotifications + markRead + markAllRead + clearAll 四端点
│   ├── notifications/api.ts   # GET 列表（is_read 0/1 ↔ isRead 布尔，含 id）
│   ├── notifications/read/api.ts      # POST 单条已读（body: { id }）
│   ├── notifications/read-all/api.ts  # POST 全部已读
│   ├── notifications/clear/api.ts     # POST 清空
│   ├── migrations/0001__create_notifications.sql  # 复用现有表结构
│   └── seed.sql
└── web/src/notification/
    ├── entry.ts               # 无页面路由；onInit 注册 apiPrefix + bindRequest + notificationsApi
    └── client/                # ojm api 生成物（不手改）
```

- 现有 root 级 `api/src/notifications/api.ts`（豁免兜底）**保留不动**——它是 runtime 内置回落的对端；
- `ojm init` 的钉版与豁免清单不变（新模块走标准契约流，无需豁免）。

### 4.6 playground-oj 同步升级（G6）

- `api/src/notification/contract.ts`：`notificationItem` 加 `id`；补 `markRead` / `markAllRead` / `clearAll` 三端点定义与 oj 实现；
- `web/src/notification/entry.ts`：provider 补三个写方法，委托生成 client；
- 重跑 `ojm api` 刷新生成物与 `routes.json` / `openapi.yaml`。

## 5. BDD 用例

### 5.1 布局注册表

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | 无模块登记 | `resolveLayoutComponent({layout:"container"})` | 返回内建 ContainerLayout |
| 2 | 模块 A 在 onInit 登记 `layout("container", X)` | 同上解析 | 返回 X |
| 3 | 模块 A 已登记 `"container"`，模块 B 再登记 | B 的登记 | console.warn 忽略，解析仍得 X |
| 4 | 模块 A 登记新名 `"pro"` | `resolveLayoutComponent({layout:"pro"})` | 返回 A 的组件 |
| 5 | 模块 A 卸载（onDestroy） | 再解析 `"container"` | 回落内建 ContainerLayout |
| 6 | 未声明 layout | `resolveLayoutComponent({})` | 返回 Outlet（现状不变） |

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
| 2 | 已注册完整 provider | 点单条通知 | 调 `markRead(item.id)`，该项 isRead=true |
| 3 | 已注册完整 provider | 点「清空」 | 调 `clearAll`，列表为空 |
| 4 | 未注册 provider（内置回落） | 打开通知弹层 | 列表只读展示，互动按钮禁用 |
| 5 | provider 写方法 reject | 任一互动 | 列表保持原状，不崩溃（错误提示归 provider） |
| 6 | 旧数据无 `id` | 渲染 | TS 编译期即报错（类型必填），无运行时分支 |

### 5.4 模板通知模块

| # | Given | When | Then |
| --- | --- | --- | --- |
| 1 | `ojm init` 新工程 | `ojm api --check` | 0 error（notification 走标准契约流） |
| 2 | 新工程启动 | 登录后点通知铃 → 全部已读 | DB `is_read` 全置 1，dot 消失 |
| 3 | 新工程启动 | 点「清空」 | notifications 表清空，弹层列表为空 |

## 6. 测试落点

- `tests/runtime/layout-registry.test.ts`：用例表 5.1 全覆盖（纯函数 + 注册表，无渲染）；
- `tests/runtime/` 内补 routesApi 委托用例（表 5.2）；
- `tests/runtime/` 内补 NotificationContainer 互动用例（表 5.3，happy-dom）；
- `tests/runtime/runtime-exports.test.ts`：冻结快照随 G3 更新（预期红灯 → 更新快照）；
- `tests/cli/`：模板快照/清单类测试若涉及 templates 文件清单，同步更新。

## 7. 陷阱与反常规记录（实现期持续追加）

- ⚠️ `handle.layout` 类型放宽为 `string` 后，内建三名的拼写错误不再有 TS 兜底——考虑在 `resolveRouteLayouts` 时对未知名 `console.warn` 一次（实现期定夺）；
- ⚠️ 布局注册必须同步完成于 `onInit`：`await bindRequest(...)` 之后再 `register.layout` 的写法可能错过路由解析窗口，文档需显式提示；
- ⚠️ `NotificationItem.id` 必填是公开类型的破坏性变更，发版说明需标注（runtime 与 playground-oj 必须同版本发布）；
- ⚠️ 覆盖 `container` 的模块自担 keepAlive / 页签缓存职责——G3 积木导出前，覆盖者无法造出等价物，文档需标注该前置依赖。

## 8. 实施顺序（依赖拓扑）

1. runtime：布局注册表（4.1）→ routesApi（4.2）→ 通知 provider 扩展 + container 接线（4.4）→ 出口积木（4.3）
2. playground-oj 同步升级（4.6）——验证 4.4 的 provider 契约
3. cli 模板 notification 模块（4.5）
4. 冻结出口快照与各包 dist 重建（runtime dist 随仓库提交，勿忘）
5. 文档收尾：本文件补「实现记录与耗时」段落

## 9. 总结（实现完成后回填）

（待实现完成后补充：关键过程、耗时、偏差记录）
