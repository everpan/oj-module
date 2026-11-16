# `@oj-module/runtime` 导出 API 专题

> **这份文档解决什么问题？** 模块工程只能从 `@oj-module/runtime` 一个入口取框架能力，
> 但它导出了上百个符号，散落在 `index.d.ts` 的 re-export 里，开发者要么靠自动补全碰运气，
> 要么退回 antd 原生组件重新造轮子。这里按**用途**把它们分组列全，每个给出「做什么 /
> 谁该用 / 红线」，作为 `manual.md` 的速查 companion。
>
> **签名以权威声明为准**：`node_modules/@oj-module/runtime/dist/index.d.ts`。
> 在编辑器里对 `from "@oj-module/runtime"` 跳转定义即可看到实时清单——本文是分类导读，
> 不是签名副本，版本升级后请以 .d.ts 为准。

---

## 0. 先记住三条总纪律

1. **只从 `@oj-module/runtime` 入口 import**，不要 `import … from "#src/*"`。框架内部实现
   打进模块 bundle 会造成编译夹带、双份 store / 双 React、版本不一致；`#src/*` 在构建期
   会被直接拦下。
2. **`react` / `antd` / `react-router` / `@tanstack/react-query` 直接 import 原包**，不要
   从 runtime 转出——它们由宿主 importmap 提供单例。runtime 只额外转出了 `z`（zod，供
   契约 schema 书写）和 `ErrorBoundary`（react-error-boundary），这两个是例外。
3. **先分清「宿主自己用」还是「模块用」**：模块加载/卸载（`loadAll` / `unloadModule` 等）
   和请求 provider 注入主要是宿主链消费的；模块作者日常高频用的是第 2～4、8～11 节。

---

## 1. 模块契约与加载（宿主链为主）

| 导出 | 用途 |
|---|---|
| `defineModule` | 定义模块契约的入口；模块自己的 `index.ts` 用它声明 `name` / `routes` / `apiPrefix` / 生命周期 |
| `loadAll` / `unloadModule` | 宿主装载 / 卸载全部模块；模块作者一般只调用 `unloadModule` 做热重载 |
| `getModule` / `getModules` | 按名取单个模块 / 取全部已注册模块 |
| `getModuleRoutePrefix` | 取某模块的路由前缀 |
| `getRegisteredApiPrefix` / `getRegisteredStore` | 取模块登记过的 API 前缀 / store |
| `getRoutes` / `getHostRoutes` | 取归并后的路由表；`getHostRoutes` 是宿主建表口，与菜单管线同源 |
| `useSlotNodes` | 订阅宿主插槽节点（见手册插槽章节） |
| `resolveRoutePath` | 单路由 path 重写算法——admin 路由与菜单/宿主建表共用，避免各写一份导致路径漂移 |

---

## 2. 认证与登录态

| 导出 | 用途 | 关键参数 / 返回 |
|---|---|---|
| `fetchLogin` | 登录；`method: "ldap"` 自动路由到 LDAP 端点，其余走本地登录 | `(data: LoginInfo) => Promise<AuthType>`，返回 `{ token, refreshToken }` |
| `fetchLogout` | 登出 | `(data?: { refreshToken? }) => Promise<void>` |
| `fetchRefreshToken` | 用 refresh token 换新的 access token | `(data: { refreshToken }) => Promise<AuthType>`；请求自身不会重入刷新链，避免久开页面刷新过期时永久 loading |
| `fetchChangePassword` | 当前用户改密 | `({ old_password, new_password }) => Promise<AuthSessionPayload>` |
| `fetchLdapLogin` | LDAP 账号登录 | `({ username, password }) => Promise<AuthSessionPayload>` |
| `fetchLoginMethods` | 查站点启用了哪些登录方式 | `() => Promise<LoginMethods>` |
| `fetchAsyncRoutes` | 取动态路由表 | `() => Promise<AppRouteRecordRaw[]>`；宿主可注入 routes provider 覆盖，否则回落内置端点 |

---

## 3. 用户信息（重点：按 id 批量取）

| 导出 | 用途 | 红线 |
|---|---|---|
| `fetchUserInfo` | 取**当前登录用户**自己的画像 | 无需传 id；当前用户优先用 `useUserStore`（单例、实时），它不额外发请求 |
| `fetchUserInfosByIDs` | **按一组 id 批量取用户完整信息**（含 `displayName` / `avatar` / `email` / `roles` 等） | **展示他人显示名的正确姿势**：登录即可、租户自校验、自动去重并按 200/批分片、保持入参顺序；缺失或跨租户的 id 不返回。详见下方专段 |

`fetchUserInfosByIDs(ids)` 专段：

```ts
import { fetchUserInfosByIDs } from "@oj-module/runtime";

const users = await fetchUserInfosByIDs([1, 2, 3]); // BatchUserInfoType[]
const nameOf = new Map(users.map(u => [u.id, u.displayName]));
```

反 N+1：不要用 `fetchRbacContactDetail(id)` 在列表里逐行取显示名（每人一请求）；也不要用
`fetchRbacUserList()` 拉全量用户表来做展示名解析（那是管理面接口、需要管理员权限、且全量拉取）。
`fetchUserInfosByIDs` 一次 `IN` 批量查询，是模块侧解析一批用户显示名的标准口。

---

## 4. RBAC 管理面 API

> 这些多为管理面能力，调用方需相应角色权限。模块若只是**写自己的审计**，用
> `fetchRbacOplogPost`（第 5 节），不要 import 框架内部审计实现。

| 导出 | 用途 |
|---|---|
| `fetchRbacRoleList` / `fetchRbacPermissionList` | 角色列表 / 权限列表 |
| `fetchRbacCreateRole` | 建角色 `({ name, title, permissions? })` |
| `fetchRbacUpdateBindings` | 更新角色权限绑定 `(name, permissions)` |
| `fetchRbacDeleteRole` | 删角色 `(name)` |
| `fetchRbacUserList` / `fetchRbacCreateUser` | 用户列表 / 建号 `({ username, password, displayName?, email? })` |
| `fetchRbacUpdateUserRoles` / `fetchRbacSetForbidden` | 改用户角色 `(uid, roles)` / 启禁 `(uid, forbidden)` |
| `fetchRbacAdminResetPassword` | 管理员重置口令 `(uid, password)` |
| `fetchRbacSettings` / `fetchRbacUpdateSetting` | 读 / 写系统设置 |
| `fetchRbacContacts` | 通讯录/联系人搜索 `(keyword, limit?)` |
| `fetchRbacContactDetail` | 单个联系人详情 `(id)`；**仅适合单条查询**，批量显示名请用 `fetchUserInfosByIDs` |
| `fetchSolutionRoutes` | 取方案路由表（平台编排面） |

---

## 5. 审计与通知

| 导出 | 用途 |
|---|---|
| `fetchRbacOplog` | 读操作日志（管理面，`admin` 可见）：`(query: { action?, username?, module?, limit? })` |
| `fetchRbacOplogPost` | **模块写自己的操作日志**：在模块自己的写操作成功后调用；`module` 传本模块名（非框架名），`detail` 不得含口令/密钥/token |
| `notify` | 跨模块通知发射原语，三个方法：`notify.push(input)` 按人推、`notify.pushBroadcast(input)` 广播、`notify.del(id, userId)` 删除。后端模块请用后端的通知原语，这里的 `notify` 是前端 facade |

---

## 6. 角色 / 菜单管理（契约生成的 client）

这一组与第 4 节的 `fetchRbac*` 并存，是**契约代码生成**出来的类型化 fetch，签名带 `Query` /
`Body` / `Data` 类型（详见各自 .d.ts）。按你的工程用哪套 client 选一套，别混着用。

| 导出 | 用途 |
|---|---|
| `fetchRoleList` / `fetchRoleMenu` / `fetchMenuByRoleId` | 角色列表 / 角色-菜单树 / 按角色取菜单 |
| `fetchAddRoleItem` / `fetchUpdateRoleItem` / `fetchDeleteRoleItem` | 角色的增 / 改 / 删 |
| `fetchMenuList` / `fetchAddMenuItem` / `fetchUpdateMenuItem` / `fetchDeleteMenuItem` | 菜单的查 / 增 / 改 / 删 |

---

## 7. RBAC 纯函数与权限常量

无副作用，可在模块里放心用于渲染判断，不必自己重写。

| 导出 | 用途 |
|---|---|
| `roleLabel(role)` | 角色显示名（`title` 优先，回落 `name`） |
| `canEditRoleBindings(role)` / `canDeleteRole(role)` / `canAssignRole(actorRoles, roleName)` | 内置角色、持有人、分配权的判断 |
| `bindingDiff(before, after)` | 计算权限绑定的 `{ added, removed }` |
| `groupByModule(items)` / `groupSettingsByModule(rows)` | 按模块归组（设置卡片、权限列表） |
| `permissionPrefix` | 按钮级权限键前缀常量（`permission:button`） |
| `accessControlCodes` / `AccessControlRoles` | 权限码 / 角色码常量集 |

---

## 8. UI 组件

| 导出 | 用途 |
|---|---|
| `BasicTable` | 框架封装表格（带 `BasicTableProps` 类型导出）；优先于 antd 原生 `Table` |
| `BasicContent` / `BasicButton` | 内容区容器 / 基础按钮 |
| `AccessControl` | 基于 `roles` / `permissions` 的按钮/菜单门禁组件；配合 `useAccess` 使用，别自己拿 `roles` 数组手算 |
| `AntdApp` | antd `App` 包裹 + 主题变量同步 + StaticAntd（`$message` 等）；宿主链必须用它而非 antd 原生 `App`，否则暗黑模式变量缺失、footer 露白 |
| `ErrorBoundary` / `PageError` | 页面级错误边界与错误页；容器布局不经主布局，模块页面需显式包裹以防抛错白屏 |
| `Iframe` | iframe 封装 |
| `FormAvatarItem` / `FormTreeItem` | 表单头像项 / 树选择项（附 `TreeDataNodeWithId` 类型） |
| `LayoutEffects` | 全局副作用（标题 / 暗色类 / NProgress），宿主链与布局根共用 |

---

## 9. Hooks 与 Store

> 这些是框架写入的**同一份 zustand 单例**，模块订阅即拿到实时状态，无需自己再拉一份。

| 导出 | 用途 |
|---|---|
| `useUserStore` | 当前用户画像（`displayName` / `username` / `roles` / `permissions` / `email` …）。显示**当前用户**用 `displayName || username`，零额外请求 |
| `useAuthStore` | token 与登录 / 登出状态 |
| `useAccessStore` | 权限码集合（宿主按角色重登记时刷新） |
| `useGlobalStore` | 站点标题等全局状态 |
| `useTabsStore` | 页签；与 `useTabKey` 配对自设页签标题 |
| `useTenantStore` | 当前租户（业务模块一般无需感知） |
| `useSolutionRoutes` | 方案路由归并 store；导入即武装 token 监视、失败降级空表 |
| `usePreferences` | 用户偏好设置 |
| `useAccess` | 权限判断 hook，配合 `AccessControl` 组件 |
| `useTabKey` | 页签 key 的唯一正确取口（keepAlive 缓存页里直接用 `useLocation` 会写到别家页签） |

---

## 10. 租户上下文

| 导出 | 用途 |
|---|---|
| `bootstrapTenant` / `currentTenant` | 初始化 / 读取当前租户；登录模块用 `?tenant=` 引导，业务模块一般只读 |
| `useTenantStore` | 租户状态的 store 形式 |
| `DEFAULT_TENANT` / `TENANT_HEADER` / `TENANT_QUERY_PARAM` | 默认租户值 / 租户请求头名 / 租户查询参数名常量 |

---

## 11. URL、请求与构建期元信息

| 导出 | 用途 | 红线 |
|---|---|---|
| `resolveApiBase` | API 端点 base（ky prefix 同一取值，恒不以 `/` 结尾） | 拼**整页跳转**到后端端点（授权入口、上传 action）时用它，用站点 base 会被 SPA 兜底页吃掉 |
| `resolveSiteBase` / `withSiteBase` | 站点部署 base（子路径部署，如挂 `/oj`） | 仅用于**非路由**的站内绝对 URL（下载直链、`window.open`）；**路由跳转不要用**，navigate/Link 走路由空间，再拼会得到 `/oj/oj/...` |
| `getRedirectPath` | 登录成功后的跳转目标解析 | 登录模块化后由它统一 |
| `getAppInfo` | 构建期注入的应用元信息 | 模块经此函数获取，不依赖全局注入 |
| `request` | 宿主 ky 实例（自带鉴权头/信封解包/刷新链） | **仅第一方模块**（如方案市场编排面）复用；第三方模块一律走 `defineModule` ctx 的 scoped request，不得仿照 |
| `z` | zod re-export，契约 `.schema` 书写入口 | 从 runtime import 以与契约生成同源钉版，不要另装一份 |
| `setupI18n` / `ANT_DESIGN_LOCALE` | i18n 初始化 / antd 语言键→locale 映射 | 宿主链初始化用；语言键映射只留一处 |

---

## 12. 树与选项工具

| 导出 | 用途 |
|---|---|
| `handleTree(data, id?, parentId?, children?)` | 平铺数据转树 |
| `filterTree` / `mapTree` / `traverseTreeValues` | 树的过滤 / 映射 / 遍历 |
| `getAllExpandedKeys` | 取全部展开节点 key |
| `getYesNoOptions(t)` / `getBooleanOptions(t)` | 是/否、真/假选项（需传 i18n 的 `t` 函数） |

---

## 13. 图标

构建期内联，声明零泄漏。常用具名图标（如 `ProfileCardIcon`、`ServerErrorIcon`、
`EmbeddedIcon`、`RiAccountCircleLine`、`RiReactjsLine`、`RiUserSettingsLine`、
`RiMoonIcon`、`RiSunIcon`、`RiFullscreenLine`、`RiFullscreenExitLine`、
`RiContrastFill`、`RiMailCheckLine` 及各布局图标）与集合 `menuIcons` 均从主入口导出。
具体名单以 .d.ts / 编辑器自动补全为准。

---

## 14. 类型出口（编译期）

从主入口可 `import type`：`ModuleConfig` / `ModuleContext` / `ModuleDefinition` /
`ModuleI18n` / `ModuleLifecycle` / `Manifest` / `ManifestModuleEntry` / `ModuleInstance` /
`AppRouteRecordRaw` / `RouteMeta` / `AppInfo` / `BasicTableProps` /
`LoginInfo` / `RoleItemType` / `MenuItemType` / `TreeDataNodeWithId` /
`AuthProvider` / `HeaderProvider` / `NotificationsApiProvider` / `SystemApiProvider` /
`UploadApiProvider` / `NoticeCategory` / `NoticeItem` / `PushInput` / `PushBroadcastInput`。
写模块契约（`defineModule` 的回调参数）时重点看 `ModuleContext` / `ModuleDefinition`。

---

## 15. 常见误用速查

| 别这样 | 改成这样 | 为什么 |
|---|---|---|
| 列表里逐行 `fetchRbacContactDetail(id)` 取显示名 | `fetchUserInfosByIDs(ids)` 一次批量 | 反 N+1，避免每人一请求 |
| `fetchRbacUserList()` 拉全量做展示名解析 | `fetchUserInfosByIDs(ids)` | 前者是管理面全量接口、需管理员权限 |
| `import … from "#src/*"` | 从 `@oj-module/runtime` 入口 import | `#src/*` 构建期被拦，且会夹带框架实现 |
| `import { Table } from "@oj-module/runtime"` | `import { BasicTable } from "@oj-module/runtime"` 或 `import { Table } from "antd"` | runtime 不转出 antd/react |
| 第三方模块用导出的 `request` 直接打后端 | 走 `defineModule` ctx 的 scoped request | 前缀收敛被绕过会越权 |
| `navigate(withSiteBase(path))` | `navigate(path)` | 路由空间已剥离 basename，再拼会双前缀 |
| `import { z } from "zod"` 自己装一份 | `import { z } from "@oj-module/runtime"` | 与契约生成同源钉版 |
