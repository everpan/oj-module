# 菜单规则（方案路由 → 菜单的投影与归组）

> 读者：写**方案**（前后端一体模块）的开发者，以及改 `packages/runtime/`、`packages/cli/` 的框架贡献者。
> 本文件只讲「规则是什么、为什么、你怎么遵守」，不重复实现细节。规则真源在
> `packages/runtime/src/router/utils/rewrite-admin-paths.ts`（admin 真重写）与
> `packages/runtime/src/router/utils/group-solution-menus.ts`（admin 视觉归组）及其上下游纯函数。
> 本文件自包含：读懂它不需要再翻别的文档。

---

## 先建立心智模型：菜单是路由的「视觉投影」

侧栏菜单**不是**手写出来的，它是路由树经一串纯函数算出来的：

```
AppRouteRecordRaw[]  (路由树，带 handle.order / handle.category / handle.module / handle.title)
   │
   ├─ mergeSolutionCategories()     仅 enabled=false → hideInMenu（管理禁用覆写；category/order 不再由行注写）
   ├─ ascending()                   双段序轴（负 order 整体在后）
   ├─ splitMenuRoutes()             按首个负 order 切主区(top) / 底部固定区(bottom)
   ├─ rewriteAdminPaths()           ★ admin 真重写：category==="admin" 子树路径改写为 /system/<模块 root>/* 并 hoist 到顶层
   ├─ generateMenuItemsFromRoutes() → MenuItemType[]  (key/label/children/icon/disabled/module/category/order)
   ├─ groupSolutionMenus()         ★ admin 视觉归组：按 module 把 admin 项收进 /system 子组 solgroup:admin:<module>
   │
   ▼
wholeMenus / bottomMenus  (zustand access store)
   │
   └─ translateMenus(t)            渲染期按当前语言把 label 裸 key 翻成文案
```

几个关键事实（写错的根因都在这）：

- **`label` 是裸 i18n key，不是文案**。`generateMenuItemsFromRoutes` 把 `handle.title` 原样塞进 `label`；真正的翻译发生在渲染期 `translateMenus`（每次切语言重跑）。所以菜单项**永远不要**直接写中文 `label: "设置"`，要写 `label: "wiki:menu.settings"`。
- **归组元数据（category / order / module）的真源是 `entry.ts` 的路由 handle**，不再依赖宿主的方案路由表（`sys_solution_route`）。dev 模式下该表为空，归组照样靠 handle 进行。
- 归组是**纯视觉层**：`groupSolutionMenus` 只重组菜单的呈现（把 admin 挂进系统设置），**不动路由树、不触碰 i18n 翻译、不 mutate 入参**。而 admin 的**路径**由 `rewriteAdminPaths` 在路由注入前就真改写掉了——那是路由层改动，不是视觉层。
- **「单根模块约定」**：一个方案的 `entry.ts` `routes` 只有一个根路由（如 `path: "wiki"`），它本身就是第一级菜单；其余页面是其 children。这取代了旧的「把 ≥2 条 `main` 路由收进一个合成父菜单」的做法（见 §3）。

---

## 单根模块约定（第一级菜单 = 模块根路由）

方案 `entry.ts` 这样组织（**真源**在路由 handle）：

```ts
export default defineModule({
  name: "wiki",
  routes: [
    {
      // 唯一根路由 = 第一级菜单项；其标题 key 用 <module>:menu.main（§4 统一）
      path: "wiki",
      handle: { title: "wiki:menu.main", layout: "container" },
      children: [
        { path: "space",        handle: { title: "wiki:menu.space",        layout: "parent" } },
        { path: "status",       handle: { title: "wiki:menu.status",       layout: "parent" } },
        { path: "collections",  handle: { title: "wiki:menu.collections",  layout: "parent" } },
        // admin 页面：标 category:"admin"，路径会被真重写为 /system/wiki/...（§2）
        { path: "admin",        handle: { title: "wiki:menu.admin", category: "admin", layout: "container" } },
        // 仅可达、不进菜单的页面：category:"hidden"
        { path: "status/detail", handle: { title: "wiki:menu.statusDetail", category: "hidden" } },
      ],
    },
  ],
});
```

约定要点：

- 模块**只有一个根路由**，它渲染成侧栏第一级菜单项。根路由下的页面是其 `children`，按 `category` 决定是否在菜单出现（见 §1）。
- 根路由的 `handle.title` 用 `<模块名>:menu.main`（这是「模块标题」与「该模块在 /system 下的管理子组标题」共用的同一个 key，见 §4）。
- `layout` 语义：`container` = 全站外壳（顶栏/侧栏/页签/页脚）；`parent` = 仅 Outlet 包裹（分组路由，无额外外壳）；深嵌套分组路由必须用 `parent`，否则会叠加出双层外壳（双击 chrome）。根路由与 admin 路由保留 `container`。
- `module` 由 module-loader 在 `getRoutes()` 注册时按 `definition.name` 自动注入，**你不用写**；旧 bundle 也带标。
- 不要为了归组父菜单去手写一个额外的「分组根路由」——第一级菜单就是模块根路由本身。

> 不要再在 `manifest.yaml` 的 `routes[]` 里手工维护 category/order：`ojm build --bundle` 构建期会**从 entry.ts handle 自动派生**并覆盖 `manifest.routes`。手工那份与 handle 漂移时，构建会警告一次并以 entry.ts 为准。手工维持双份只会增加漂移风险。

---

## §1 category 三值语义（hidden / admin / 普通）

路由 `handle.category` 取值与行为：

| `category` | 是否在菜单 | 路由是否可达 | 行为 |
|---|---|---|---|
| 省略 / `""` / `"main"`（旧写法） | ✅ 普通菜单项 | ✅ | 普通可见项。**`"main"` 不再触发任何归组**（旧设计把 ≥2 条 `main` 收进合成父菜单，现已取消）；推荐新代码直接省略 category |
| `"hidden"` | ❌ | ✅ | 有效路由但**不进菜单**（等价于 `hideInMenu: true`）；用于详情页、弹窗页等 |
| `"admin"` | ✅（挂在 `/system` 下） | ✅（路径变为 `/system/<模块 root>/...`） | 管理/设置页，走 §2 真重写 + §3 视觉归组 |

- `hidden` 项不进菜单，但路由仍可达（深链、`navigate` 都能命中）。
- `category:"admin"` 项先在**路由层**被 `rewriteAdminPaths` 真重写为 `/system/<模块 root path>/*`，再在**菜单层**被 `groupSolutionMenus` 收进 `/system` 子组。两者配合，URL 与菜单都归到系统设置下。
- `module` 自动注入，归组按它分桶，你无需关心。

> `/system` 是框架侧断言，不是方案 manifest 能声明或验证的。方案只需把 admin 路由标
> `category: "admin"`，挂载点交给框架。若宿主没有 `/system`（极少数自定义宿主）：admin 项已被
> 从原位置摘除却无处挂载，仅告警一次（`warnOnce`，同消息不重复），不会静默丢失为「出现在错误位置」。

---

## §2 admin 真重写（路由层，不是视觉把戏）

`rewriteAdminPaths`（`access.ts` 注入路由前调用）对 `category==="admin"` 的**路由子树**做真改写：

- 把该子树从原父树中摘除，hoist 到顶层（与模块根路由平级），使其运行时 URL 真正变成
  `/system/<模块 root path>/...`——而不是仍挂 `/wiki` 下、仅菜单挪到 /system 的「视觉假象」。
- `<模块 root path>` 取该模块根路由的**绝对路径**（单根约定下即顶层路由 path，如 `wiki`），
  admin 路径后缀（root 之后的部分）原样保留，故无论 admin 嵌套多深都能正确重写。
- **非突变**：返回新路由数组，未变动的分支复用原引用（react-router `patchRoutes` 接收）。

例：上节 `wiki` 模块的 `admin` 子路由，重写后路径为 `/system/wiki/admin`，运行时访问即
`/system/wiki/admin`。菜单层（`groupSolutionMenus`）随后把它视觉归进 `/system` 子组。

```ts
// rewriteAdminPaths 语义（非突变）
"/wiki/admin"  (category:"admin")  ──►  hoist + 重写  ──►  "/system/wiki/admin"
```

> 真重写 vs 旧视觉归组：旧版只在菜单层把 admin 挪到 /system，路由 URL 仍是 `/wiki/admin`，
> 深链与 SEO 都错位。新版在路由层就改掉路径，URL 与菜单一致。

---

## §3 admin 视觉归组（菜单层）

`groupSolutionMenus` 在菜单生成后、渲染前做**纯视觉层**归组（只收已生成的菜单项，不动路由树）：

- 递归收集 `category==="admin"` 的菜单项（handle 优先，宿主方案路由行仅作 `admin` 的向后兼容回退）。
- 按 `module` 分桶，每组挂进宿主 `/system` 菜单的 children 末尾：
  - 子组 key：`solgroup:admin:<模块名>`
  - 子组标题：裸 i18n key `<模块名>:menu.main`（与模块根菜单标题共用同一 key，见 §4）
  - 组内压平 admin 项自身的层级（「管理」中间级消失，子项直挂子组下），按各自 `order` 升序
- 仅当有 admin 组要挂入时才改写 `/system`（无 admin 项时不强加空 children）；宿主缺 `/system` 时告警一次。
- 非突变、无副作用（未变动子树复用原引用）。

> 旧的「`main` 路由 ≥2 条按模块收进合成父菜单 `solgroup:main:<模块>`」**已取消**。模块第一级菜单
> 现在直接是模块根路由（§0 单根约定），`category:"main"` 退回为普通可见项，不再产生合成父菜单。

---

## §4 menu.main 统一（模块标题与管理子组标题共用一个 key）

模块根菜单标题与它在 /system 下的管理子组标题**用同一个 i18n key**：`<模块名>:menu.main`。

- 模块根路由：`handle.title: "<模块名>:menu.main"` → 渲染为侧栏第一级菜单项文案。
- admin 子组：`groupSolutionMenus` 生成的 `solgroup:admin:<模块>` 标题也取 `<模块名>:menu.main`。
- 因此你只需在双语 locale 里声明**一条** `<模块名>:menu.main`：

```jsonc
// web/src/<模块>/locales/zh-CN.json
{ "menu": { "main": "Wiki" } }   // 命中 <模块名>:menu.main（根菜单 + 系统设置里的管理子组都读它）

// web/src/<模块>/locales/en-US.json
{ "menu": { "main": "Wiki" } }
```

约定：

- 必须**嵌套**在 `menu.main`，不能平铺成 `"<模块名>:menu.main": "..."`（i18next 点路径取值）。
- 缺这条 key → 构建期契约校验直接 fail（构建期 fail-fast）。
- 普通子项（space / status / collections 等）的 `title` 仍各自匹配 `<模块名>:menu.*`（如 `wiki:menu.space`）。
- 旧设计的 `menu.group` key 已废弃：`menu.main` 取代它成为根标题与管理子组标题的统一真源。

---

## §5 currentActiveMenu（高亮哪一个菜单项）

`handle.currentActiveMenu` 是一个字符串，声明「当前路由应当高亮哪个菜单项」，值是该菜单项的
**绝对路径 key**（即菜单项的 `key`，等于路由绝对路径）。用于混合导航 / 双列导航下定位要展开
的第一级菜单。

规则与坑：

- 值必须是**绝对路径**，且指向一个真实存在的菜单 key（通常是模块根或某个子路由，如 `/wiki/space`）。
  写成相对值会被按当前路由错误解析（如 `/system/dept` 下点 `detail` → `/system/detail`，落 404）。
- **不要硬编码散落的全路径字面量**。模块内访问路径应统一从「模块基路径助手」派生（见 §6），
  这样模块挂载根（`wiki`）改名时，所有引用一次性跟着变，不会因前缀写死而出错。
- 例（推荐写法，依赖模块基路径助手）：

```ts
import { wikiPath } from "./paths";
// 在 /wiki/space/:id/doc 路由上，希望高亮「空间」菜单项：
handle: { currentActiveMenu: wikiPath("space") }   // → "/wiki/space"，随模块根改名自动更新
```

---

## §6 模块内路径一律走「模块基路径助手」（相对/模块基，不散落绝对路径）

方案内部的所有前端路径——`navigate(...)`、`Link to`、`useMatch` / `matchPath` 的匹配模式、
`currentActiveMenu`、SEO 正则——都应从一个**单一来源的模块基路径助手**派生，不要散落写
`/wiki/...` 字面量。

推荐在模块内放一个 `paths.ts`：

```ts
// web/src/<模块>/paths.ts
export const WIKI_ROOT = "wiki";                       // 模块挂载根（唯一定义处）
export const wikiBase = `/${WIKI_ROOT}`;
export const wikiPath = (...segments: Array<string | number>): string =>
  `/${WIKI_ROOT}/${segments.join("/")}`;                // wikiPath("space", 1, "doc") → /wiki/space/1/doc
```

为什么不该用 react-router 的 location-relative 导航：

- 深嵌套路由（如 `/wiki/space/:id/doc/:docId`）里用 `navigate("doc/...")` 这类相对跳转，
  相对基准随当前层级变化，极易跳错；统一从 `wikiPath(...)` 拼绝对路径最稳。
- 模块根改名（如 `wiki` → `knowledge`）时，只改 `WIKI_ROOT` 一处，全模块引用自动收敛；
  散落字面量则每个都要手工改，且容易漏。

> 例外（**不要**改）：`tree/bus.ts` 里的 `treeRoom("/space/:id")` 之类是**后端 WebSocket 房间名**
> （后端契约），不是前端路由，故意不参与前端路径重写。

---

## 开发者的该做 / 别做

该做（DO）：

- 在 `entry.ts` 路由 handle 直接声明归组/菜单元数据（**真源**）：
  `{ title: "wiki:menu.space", layout: "parent" }`、
  `{ title: "wiki:menu.admin", category: "admin", layout: "container" }`
- 模块只设**一个根路由**，其余页面作其 `children`；根路由 `title` 用 `<模块>:menu.main`。
- `manifest.yaml` 的 `routes[]` **不必手写**：构建期从 entry.ts handle 自动派生并覆盖；漂移时警告一次并以 entry.ts 为准。
- 在 `locales/{zh-CN,en-US}.json` 里补嵌套的 `menu.main`（根菜单标题 + 系统设置管理子组标题共用）。
- `admin` 路由统一 `category: "admin"`，框架自动真重写进 `/system` 并归组。
- 模块内所有前端路径走 `paths.ts` 的 `wikiPath(...)` / `wikiBase`，不散落绝对路径字面量。
- `currentActiveMenu` 写绝对路径，且从模块基路径助手派生。

别做（DON'T）：

- 为归组父菜单手写一个额外「分组根路由」——第一级菜单就是模块根路由本身（单根约定）。
- 直接写中文 `label` / `title` —— 必须走 i18n key，否则切语言不动。
- 用 `category: "main"` 想「归到一组」—— 扁平 main 归组已取消，`main` 等同普通项，不再产生合成父菜单。
- 在方案里假设 `/system` 的 key 或结构 —— 那是框架断言，自定义宿主会告警并回落。
- 给隐藏（`hidden`）或禁用（`enabled: false`）路由指望进菜单 —— 它们不参与。
- 把 `currentActiveMenu` / `Link to` / `useMatch` 写成散落的全路径字面量 —— 统一走模块基路径助手（§6）。
- 手工维持 `manifest.yaml` 的 `routes[]` 与 entry.ts handle 双份 —— 单一真源是 entry.ts，手工那份会被派生结果覆盖（并警告），多写只会增加漂移风险。
- 改动 `tree/bus.ts` 的 room 名当路由改 —— 那是后端 WS 契约，非前端路由。
