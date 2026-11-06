# Runtime 菜单滚动、admin path API 与默认布局

日期：2026-11-06 08:01

## 需求与用户故事

1. 作为侧边栏用户，主菜单与底部「系统管理」同时展开时，两块内容不得互相遮挡；空间不足时菜单应可滚动且主菜单不能失去视口。
2. 作为下游模块开发者，我希望公开一个接收单条 route、返回导航 path 的纯函数；`category === "admin"` 时使用与框架相同的 `/system/...` 重写算法，普通路由保持原 path。
3. 作为模块开发者，`category === "admin"` 且未声明 `layout` 时应默认使用 `container`，避免遗漏配置导致 admin 页缺少整站布局；显式 layout 必须优先。

## 调查证据

### 侧栏重叠/不可滚动

真实浏览器同时展开主菜单和底部菜单后：

- 480px 视口：主菜单视口 164px、内容 272px，SimpleBar 可滚动，两面板几何重叠为 0。
- 300px 视口：底部固定区 `shrink-0` 高 228px，主菜单视口被压成 0px，而内容仍为 272px，主菜单无法显示或滚动。
- 根因：底部固定区完全不收缩，没有为极端高度/更多 admin 组保留主菜单最小可视区域。

### admin 布局默认值

`resolveLayoutComponent()` 当前把未声明 layout 一律解析为 `Outlet`。admin 路由经重写后 hoist 为顶级路由，若不补 `container`，会失去宿主整站 chrome。

### 单路由 path API

现有 `rewriteAdminPaths()` 是内部数组级 API。公开单路由 helper 必须复用该算法，避免下游复制路径映射规则；对带旧绝对 id 的相对 path 路由，id 可提供模块根上下文。

## BDD 验收用例

### Scenario：底部菜单挤压主菜单

- **Given** 主菜单和底部菜单均有超出一个视口的条目，视口高 300px
- **When** 两者同时展开并完成动画
- **Then** 主菜单滚动视口高度至少 40px，且 scrollHeight 大于 clientHeight
- **And** 底部菜单在自身空间不足时可滚动
- **And** 两个面板几何区域不重叠，outer aside 不通过整体滚动掩盖问题

### Scenario：计算单路由导航 path

| Given route | When | Then |
| --- | --- | --- |
| admin，绝对 path `/wiz-pm/admin` | 调用公开 path helper | 返回 `/system/wiz-pm/admin` |
| admin，相对 path `admin`、id `/wiz-pm/admin` | 调用公开 path helper | 返回 `/system/wiz-pm/admin` |
| 普通路由，path `/wiz-pm/data` | 调用公开 path helper | 原样返回 `/wiz-pm/data` |
| 已重写 admin，path `/system/wiz-pm/admin` | 调用公开 path helper | 不重复添加 `/system` |

### Scenario：admin 默认布局

| Given handle | Then 布局组件 |
| --- | --- |
| `{ category: "admin" }` | `ContainerLayout` |
| `{ category: "admin", layout: "parent" }` | `ParentLayout` |
| `{ category: "admin", layout: "none" }` | `Outlet` |

## 实施任务

- [x] 新增侧栏真实浏览器回归用例，修复前确认主视口为 0。
- [x] 调整主/底菜单 flex 与 overflow，保留主菜单最小滚动视口。
- [x] 新增单路由 path helper 的失败用例，复用 `rewriteAdminPaths` 实现并公开导出。
- [x] 同步 CLI `RUNTIME_STUB_SOURCE` 与 runtime 出口白名单测试。
- [x] 新增 admin 默认 layout 与显式覆盖用例，在统一布局解析出口实现。
- [x] 运行相关测试、完整测试、类型检查、lint 与 runtime build。
- [x] 更新任务状态和阶段总结。

## 问题记录

- 菜单展开动画期间的瞬时测量会得到错误几何关系；验收必须等待动画结束后再断言。
- 单路由 helper 对相对 admin path 依赖 `route.id` 提供绝对路径；上游 `getRoutes()` 已保证生成该 id。

## 补遗：admin 子树后代的 path 计算（2026-11-06 下游反馈）

### 需求与用户故事

作为下游模块开发者，我需要计算 `category === "admin"` 子树内**后代路由**的导航 path；子路由自身不声明 `category`（继承自父级），现有单路由入参看不到继承语境，`resolveRoutePath({ path: "data" })` 只会返回 `"data"`。

### 调查证据

- admin 语境存在于**树结构**中：`processRoute` 逐节点判 `handle.category`，命中后整棵子树 hoist。由前缀代数：hoist 后 admin 根新绝对路径 = `/system + <admin 原绝对路径>`（`systemKey + rootAbs + suffix`，而 `suffix = adminAbs − rootAbs`），后代同理 = `/system + <后代原绝对路径>`——与 admin 嵌套深度、模块 root 位置无关。
- 后代「原绝对路径」的框架真源是 `addRouteIdByPath` 生成的 `id`；源定义（无 id）时按祖先链拼接（`resolveAbs` 同语义）。index 路由 id 为 `父绝对路径 + "/"`（尾斜杠）。
- 幂等性自然成立：已重写 id（`/system/...`）不以 admin 原绝对路径为前缀，原样返回。

### BDD 验收用例

| Given 入参 | When | Then |
| --- | --- | --- |
| 子路由 `data`，链 = [模块根 `/wiz-pm`, admin 父 `admin`]，无 id | 调用链式 helper | `/system/wiz-pm/admin/data` |
| 子路由带原始 id `/wiz-pm/admin/data`，同链 | 调用链式 helper | `/system/wiz-pm/admin/data`（id 优先，链仅供 admin 判定） |
| admin 嵌套在链第 3 层，后代 `data` | 调用链式 helper | `/system/a/b/admin/data`（深度无关） |
| 链无 admin 祖先（`/wiki` > `admin` > `data`） | 调用链式 helper | `/wiki/admin/data`（仅拼接绝对路径，不重写） |
| index 子路由，admin 父链 | 调用链式 helper | `/system/wiz-pm/admin/`（尾斜杠与框架 id 同源） |
| 子路由带已重写 id `/system/wiz-pm/admin/data` | 调用链式 helper | 原样返回（幂等） |
| 真实树（wiki fixture）经框架全管线重写 | 链式 helper 结果 | 与重写后子树 id 逐一相等 |

### 实施任务

- [x] 链式用例先行（含真实树一致性用例），确认失败。
- [x] `resolveRoutePath(route, ...ancestors)` 变参扩展：单路由分支行为不变；后代分支按前缀代数 `/system + 原绝对路径` 实现（不重建树、不跑 rewriteAdminPaths）。
- [x] 文档同步（runtime README、devkit manual / menu-rules、CHANGELOG Unreleased）。
- [x] 测试、typecheck、lint、runtime build 通过；并入 feat/ojm。

### 补遗阶段总结

2026-11-06 09:10–09:25，约 15 分钟。关键过程：

1. 关键推导：hoist 公式 `systemKey + rootAbs + suffix` 在链前缀代数下坍缩为 `/system + adminAbs`，后代同理 `/system + 原绝对路径`——与 admin 嵌套深度、模块 root 位置无关，无需重建树跑 rewriteAdminPaths。
2. 真实树一致性用例钉住公式：链式结果必须等于框架全管线（addRouteIdByPath → rewriteAdminPaths）重写后的子树 id。
3. index 路由尾斜杠（`父绝对路径 + "/"`）与框架 id 语义对齐；已重写 id 因不以原路径为前缀而天然幂等，无需特判。
4. CLI stub `resolveRoutePath = _fn` 签名无关，零改动；类型坑同前（union 无 `id`，测试侧收窄断言）。

## 阶段总结

2026-11-06 08:01–08:30，约 30 分钟。

关键过程：

1. 侧栏重叠：真实浏览器 300px 视口复现主菜单视口 0px，根因底部固定区 `shrink-0` 完全不收缩；修复为主菜单区 `flex-1 min-h-10 overflow-hidden`、底部区展开态 `min-h-0 overflow-y-auto`，几何重叠归零且主菜单恢复滚动。
2. 验证坑（反常识）：菜单展开动画期间的瞬时测量得到假几何，断言前须轮询 `aside.getAnimations()` 等动画结束，否则用例不稳定。
3. 验证坑（反常规）：浏览器验证吃的是构建产物链（runtime `dist` → cli `shell-dist`），改 runtime 源码后必须先 `pnpm --filter @oj-module/runtime build` 再 `pnpm --filter @oj-module/cli build:shell`，否则源码修复在页面上"不生效"。
4. `resolveRoutePath(route)`：复用 `rewriteAdminPaths` 保证与框架同源；相对 admin path 以已生成的绝对 `id` 补全模块根；对已重写路径幂等；经 `packages/runtime/src/index.ts` 公开出口下发，CLI `RUNTIME_STUB_SOURCE` stub 同步（白名单测试钉住）。
5. admin 默认 layout 在 `resolveLayoutComponent` 单点实现：显式声明（含 `none`）永远优先，未声明且 `category: "admin"` 时默认 `container`。
6. 文档同步：runtime README、devkit manual / menu-rules / SKILL 补 `resolveRoutePath` 用法与 admin 布局默认值，admin 示例删除冗余 `layout: "container"`。
7. 遗留如实记录：全量 e2e 21 通过、4 失败，均为既有 wecom 用例（登录页默认渲染企微 tab、`/system/wecom` 404），与本批修改无关，未在本批修复。

