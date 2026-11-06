# Runtime admin 路由重写后菜单选中态修复

日期：2026-11-06 07:52

## 背景与用户故事

下游使用 `@oj-module/runtime@0.2.67` 时，将模块子路由声明为 `category: "admin"` 后，URL 与菜单 key 被重写到 `/system/<模块根>/*`，但当前页面不高亮且「系统管理」菜单收起。

作为上游 runtime 维护者，我需要保证路由 `id` 与重写后的菜单 key 始终处于同一绝对路径空间，使菜单选中态和父级展开态不依赖下游额外配置。

## 根因与复现证据

数据流：`getRoutes()` → `addRouteIdByPath()` → `rewriteAdminPaths()` → `generateMenuItemsFromRoutes()` / `groupSolutionMenus()` → `getParentKeys()` → `resolveSelectedKeys()`。

`rewriteAdminPaths()` 通过 `{ ...route, path: newAbs }` 改写路径，spread 保留了重写前生成的 `id`。使用真实纯函数复现 `/wiz-pm/admin/data`：

| 项目 | 修复前结果 |
| --- | --- |
| 菜单 key | `/system/wiz-pm/admin/data` |
| 路由 id | `/wiz-pm/admin/data` |
| selectedKeys | `["/wiz-pm/admin/data"]` |
| `/system` 是否展开 | 否 |

根因是路径重写没有同步刷新其 admin 子树的路由 id，而非下游配置错误。

## BDD 验收用例

### Scenario：admin 子树路径重写后选中菜单并展开父链

- **Given** 模块根为 `/wiz-pm`，`admin/data` 子树已先生成原路径 id，且声明 `category: "admin"`
- **When** 经 `rewriteAdminPaths()` 重写并生成归组菜单，再根据叶子路由 id 计算 `resolveSelectedKeys()`
- **Then** admin 根及所有后代的 id 均与重写后的绝对路径一致
- **And** selectedKeys 为 `["/system", "solgroup:admin:wiz-pm", "/system/wiz-pm/admin/data"]`
- **And** `/system` 包含在展开 key 中，当前叶子菜单可高亮

### Scenario：非 admin 路由保持既有行为

- **Given** 普通模块路由已生成 id
- **When** 执行 `rewriteAdminPaths()`
- **Then** 路径与 id 均不发生漂移

## 实施任务

- [x] 添加上述端到端纯函数回归用例，并在修复前确认失败。
- [x] 在 `rewriteAdminPaths` 单点刷新被 hoist 的 admin 子树 id，不改下游契约。
- [x] 运行相关 runtime 测试、类型检查与 lint，确认无回归。
- [x] 更新任务状态与阶段总结。

## 问题记录

无新增反常规问题；本缺陷属于同一路由对象两份路径元数据未同步更新的问题。

## 阶段总结

2026-11-06 07:52–08:01，约 10 分钟。

关键过程：

1. 修复前用真实纯函数复现：菜单 key 已是 `/system/wiz-pm/admin/data` 而路由 `id` 仍是 `/wiz-pm/admin/data`，证实为 runtime 缺陷、非下游配置错误。
2. 修复落在重写单点：hoist 后对整个子树重跑 `addRouteIdByPath`（含 index 路由尾斜杠），使 `id` 与菜单 key 永远同处一个绝对路径空间，下游无需任何补偿配置。
3. 回归用例贯穿完整选中管线（`groupSolutionMenus` → `getParentKeys` → `resolveSelectedKeys`），断言选中链 `["/system", "solgroup:admin:wiz-pm", "/system/wiz-pm/admin/data"]`。
4. 类型坑：`AppRouteRecordRaw` 为不含 `id` 的联合类型，新 helper 签名以 `AppRouteRecordRaw & { id?: string }` 加宽，测试侧同样需要收窄断言。

