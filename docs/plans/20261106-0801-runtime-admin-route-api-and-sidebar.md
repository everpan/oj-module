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

