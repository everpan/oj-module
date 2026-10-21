# 方案路由注册菜单归组（solution menu grouping）

- 日期：2026-10-21
- 分支：`feat/solution-menu-grouping`（基于 feat/ojm）
- 状态：设计待批准
- 修订：builder-check 一轮（子代理评审）后修订三处——①签名改双列表进出（admin 跨列表挂载，Q1）；②组标题存裸 i18n key 由渲染层 translateMenus 翻译（Q2，消除语言切换不刷新缺陷）；③归组只处理顶层项、admin 路由约定顶层定义的嵌套边界（Q3）。测试表 G4/G5/G6/G11 同步更新。

## 1. 意图与背景

方案（solution）经市场安装后，其路由以 `sys_solution_route` 行（`path/module/category/order/title_key/enabled`）下发，前端 `mergeSolutionCategories` 只把 category 落到 `handle` 做**标注**——当前没有任何渲染层消费它，安装后的菜单是若干顶层平铺项。

产品语义（用户裁定，2026-10-21）：

- **main** 路由：注册后按模块归到「<模块名>」父菜单下（开发形态不变）；
- **admin** 路由：**在 entry.ts 定义（开发者视角一致）**，注册后显示为框架「系统设置」(`/system`) 的子菜单：`系统设置 → wiki → 管理`；
- **有些解决方案模块可以没有管理菜单**（无 admin 路由即无该组）；
- **开发形态保持独立**：未安装（无方案路由行）时菜单与今天完全一致。

### 关键事实（已验证）

- 菜单层级唯一来源：`generateMenuItemsFromRoutes` 从路由树嵌套生成；`MenuItemType = { key, label, icon?, children? }`。
- `/system` 路由在**底部固定区**（`order: -100`，`splitMenuRoutes` 切进 `bottomMenus`，pin 侧边栏底部）——admin 归组的挂载点在 bottomMenus。
- 方案路由行经 `GET /api/_platform/solutions/routes` 下发；行空（未登录/端点失败/未安装）时 `mergeSolutionCategories` 原样返回——**归组函数同样以空表为无操作**，开发形态天然不变。
- 契约最高编号 C2-33（health），新增条款取 **C2-34**。

## 2. 目标 / 非目标 / 反目标

**目标**

1. 注册后 main 路由按 module 归组（≥2 条可见 main 才归组，见裁决①）。
2. 注册后 admin 路由挂入宿主 `/system` 菜单下 `<模块名>` 组；宿主无 `/system` 时回落顶层平铺 + warn-once（裁决③）。
3. 模块组标题 `<name>:menu.group` 进 C2 契约双语 fail-fast（裁决②）。
4. 开发形态（无方案行）零变化；空表/端点失败降级不阻断（对齐 R21 哲学）。

**非目标**

- 不改路由树、不造假路由（URL 语义零污染）；不动 `sys_solution_route` 表结构与下发字段。
- 不改后端安装器写表逻辑；不动 `mergeSolutionCategories` 既有语义（它继续只做标注，归组是独立的下一步）。
- 不动 backend 动态路由的菜单行为（归组只作用于模块路由经方案行标注的部分）。
- wiki 方案侧改动（locales 补 `menu.group`、drill 复验）不在本分支，回 `../oj-wiki-solution` 仓库另行执行。

**反目标**

- 不允许归组改变路由可达性（纯视觉层）；
- 不允许单 main 路由模块被强套父菜单（裁决①：≥2 才归组）；
- 不允许宿主缺 `/system` 时伪造「系统设置」组冒充框架菜单（裁决③）。

## 3. 用户裁决（本轮脑暴产出）

| # | 决策点 | 裁决 |
|---|---|---|
| ① | 单 main 路由模块是否强制归组 | **≥2 条可见 main 路由才归组**；单路由保持顶层直出 |
| ② | `<name>:menu.group` 是否进 C2 fail-fast | **进**：声明 main/admin 路由就必须给双语键 |
| ③ | 宿主无 `/system` 菜单时 admin 显示 | **回落顶层平铺 + warn-once** |

## 4. 机制设计

### 4.1 新增纯函数（runtime）

`packages/runtime/src/router/utils/group-solution-menus.ts`

**签名（builder-check Q1 修订）**：归组是**跨列表**操作（admin 项在 wholeMenus、`/system` 在 bottomMenus），单列表进出表达不了。一次调用吃两段菜单：

```ts
export function groupSolutionMenus(
  top: MenuItemType[],            // wholeMenus
  bottom: MenuItemType[],         // bottomMenus
  rows: SolutionRouteRow[],
  opts?: { systemKey?: string },  // 默认 "/system"
): { top: MenuItemType[], bottom: MenuItemType[] }
```

处理规则：

1. **行索引**：`rows` 按 path 建 Map；只认 `category ∈ {main, admin}` 且 `enabled !== false` 的行（hidden/禁用项此前已被 hideInMenu 滤出，这里再兜底）。
2. **摘除（两段都扫）**：以 `key === row.path` 匹配菜单项（`generateMenuItemsFromRoutes` 的 key 即绝对路径）。命中 main 且该模块可见 main ≥2 → 摘下待归组；命中 admin → 摘下记下**来源列表**。
3. **main 归组**：按 module 分桶，每桶合成父项 `{ key: "solgroup:main:<module>", label: "<module>:menu.group" }`。**label 存裸 i18n key 不翻译**（builder-check Q2 修订：既有菜单 label 全是裸 key，渲染期 `translateMenus`（use-menu.ts）统一 `t()`，语言切换可刷新；归组时 `t()` 会让组标题成为侧栏唯一不刷新的 label）。父项插入 top 的位置 = 桶内最小 `row.order` 的序位（保持升序序轴）。
4. **admin 挂载**：在 bottom 里找 `key === opts.systemKey`（默认 `/system`）的项 → 其 children 末尾按 `row.order` 升序追加 `{ key: "solgroup:admin:<module>", label: "<module>:menu.group", children: [摘下的 admin 项] }`（即 系统设置 → wiki → 管理）。**找不到 → 摘下的 admin 项按原序放回来源列表 + warnOnce**（Q1 修订：明确放回摘除时的列表）。
5. 空表/无命中 → 两段原样返回（不突变入参）。
6. **嵌套模块路由（builder-check Q3 裁决）**：归组只处理**顶层**菜单项。方案的 entry.ts 若自嵌套（如自有 `/wiki` 父下挂子路由），子项本就有模块自树呈现，不做重挂、不告警（尊重模块意图）；admin 路由要被挂进 /system，**约定其在该方案 entry.ts 中必须顶层定义**（wiki 满足）。契约不强制扁平化——自嵌套的 main 子项不入组即可，属于模块自己的选择。

### 4.2 接线（access store）

`packages/runtime/src/store/access.ts`：`splitMenuRoutes` 切出 top/bottom 后、生成 MenuItemType 后，各接一步归组（Q1 修订：一次调用吃两段）：

```ts
const { top, bottom } = splitMenuRoutes(newRoutes);
const grouped = groupSolutionMenus(
  generateMenuItemsFromRoutes(top),
  generateMenuItemsFromRoutes(bottom),
  get().solutionRows,
);
// wholeMenus: grouped.top / bottomMenus: grouped.bottom
```

- `initialState` 与 `setAccessStore` 都要接；`setSolutionRoutes` 触发重归并的既有通路自动覆盖（快照重放）。
- 组标题随既有 label 走裸 key → 渲染期 `translateMenus` 翻译，**语言切换可刷新**（Q2 修订后无此限制，§7 相关风险条目移除）。

### 4.3 契约新增 C2-34（cli）

`packages/cli/src/manifest-contract.ts`：

- 触发条件：`routes[]` 中存在 `category ∈ {main, admin}` 的路由；
- 校验：wiki i18n 资源（包内 `web/` 产物可得的 locale JSON——校验数据源与 C2-25 相同）必须同时含 `<name>:menu.group`（按段拆分的嵌套键，`menu: { group: ... }`）；
- 违反 → fail-fast，文案对齐 C2-25 风格。
- hidden-only 方案（无 main/admin）不触发——「可以没有管理」的自由度保留。

### 4.4 不做什么（明确边界）

- 不动 `merge-solution-categories.ts`（标注与归组分层，单一职责）。
- 不动 `generate-menu-items-from-routes.ts`（它保持"路由树→菜单"的单一映射）。
- 不动 `layout-menu` 渲染层（MenuItemType 已支持 children，零改动）。

## 5. 测试计划（BDD，先写规格）

### 5.1 `group-solution-menus`（vitest，runtime 仓库内）

| # | 场景 | 给定 | 期望 |
|---|---|---|---|
| G1 | 空表降级 | rows=[] | 两段原样返回（同引用），零变化 |
| G2 | 单 main 不归组 | wiki 仅 /space 一条 main | top 顶层直出，无 solgroup 父项 |
| G3 | 双 main 归组 | wiki /space + /wiki/collections | top 出现 solgroup:main:wiki，children 按 order 含两项 |
| G4 | 组标题裸 key | — | label === "wiki:menu.group"（不翻译；翻译归渲染层 translateMenus） |
| G5 | admin 跨列表挂载 | wiki /admin（category=admin，order 220 → 在 top）+ bottom 有 /system | bottom 的 /system children 含 solgroup:admin:wiki → /admin；top 不再有 /admin |
| G6 | 无 /system 回落 | bottom 无 /system | admin 项**回到来源列表（top）**原序 + warnOnce 一次 |
| G7 | 多模块 admin 排序 | a(order 220) b(order 230) | /system children 组序 a→b |
| G8 | hidden/禁用行不参与 | 行含 hidden + enabled=false | 不摘除、不建组 |
| G9 | main 与 admin 混合 | 同模块两类各≥1 | main 走 G3、admin 走 G5，互不干扰 |
| G10 | 宿主菜单项无对应行 | rows 为空但 menus 有 /admin 项 | 不动（无行即无注册语义） |
| G11 | 嵌套 main 子项 | 模块自嵌套 /wiki 父下的子路由行 | 不重挂、不告警，保持模块自树（Q3 约定） |

### 5.2 access store 集成（既有测试风格补用例）

- `setSolutionRoutes` 推送后菜单出现父项（快照重放通路）；
- reset()/重登录后归组不残留错位。

### 5.3 C2-34（cli 契约测试，对齐 manifest-contract 现有用例风格）

| # | 场景 | 期望 |
|---|---|---|
| C1 | main 路由 + menu.group 双语齐 | 通过 |
| C2 | main 路由缺 menu.group | fail-fast 报 C2-34 |
| C3 | 仅 hidden 路由 | 不触发 |
| C4 | 键存在但只单语 | fail-fast（对齐 C2-25 双语先例） |

## 6. 工程顺序

1. 本设计文档批准；
2. TDD：先落 5.1/5.3 规格（红），再实现（绿）；
3. `pnpm lint` + `pnpm typecheck` + `pnpm --filter @oj-module/runtime test` + cli 契约测试；
4. 提交 conventional commit（结尾 `unix@vip.qq.com ai`），--no-ff 并入 feat/ojm（不 push、不升版本——release 批次再说）；
5. 回 `../oj-wiki-solution`：locales 补 `menu.group`、重出包重签、drill 复验注册菜单形态（含 admin 入 /system）。

## 7. 风险与备忘

- **drill 宿主产物**：隔离站点的 shell 取自 cli 包 `shell-dist`——本地验证前需以新 runtime 重建 cli 产物（monorepo 内构建，非发版）。
- **同 path 多模块**：sys_solution_route path 唯一（安装器约束），`key===path` 匹配安全。
- **translateMenus 前提**：组标题裸 key方案依赖渲染层 `translateMenus` 对每个 label 调 `t`（已核实 use-menu.ts 行为）；若 label 为 ReactNode（模块直接给节点）则原样渲染，组标题不受影响（永远是 string key）。
- wiki drill 尚有一条未决项（`/wiki/ws` 匿名注册）不受影响，按原计划在 drill 中一并观察。
