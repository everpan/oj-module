# 菜单规则（方案路由注册归组）

> 读者：写**方案**（前后端一体模块）的开发者，以及改 `packages/runtime/`、`packages/cli/` 的框架贡献者。
> 设计真源：`docs/plans/2026-10-21-1028-solution-menu-grouping.md`；契约条款 `docs/prd/solution/archive/202610171254-lifecycle-manifest-contract.md` §4（C2-43）。
> 本文件只讲「规则是什么、为什么、你怎么遵守」，不重复实现细节。

---

## §1 先建立心智模型：菜单是路由的「视觉投影」

侧栏菜单**不是**你手写出来的，它是路由树经一串纯函数算出来的：

```
AppRouteRecordRaw[]  (路由树，带 handle.order / handle.title)
   │
   ├─ mergeSolutionCategories()     追加方案路由的 category / order / hideInMenu
   ├─ ascending()                   双段序轴（负 order 整体在后）
   ├─ splitMenuRoutes()             按首个负 order 切主区(top) / 底部固定区(bottom)
   ├─ generateMenuItemsFromRoutes() → MenuItemType[]  (key/label/children/icon/disabled)
   ├─ groupSolutionMenus()         ★ 本文件主角：方案路由注册菜单归组（纯视觉层）
   │
   ▼
wholeMenus / bottomMenus  (zustand access store)
   │
   └─ translateMenus(t)            渲染期按当前语言把 label 裸 key 翻成文案
```

几个关键事实（写错的根因都在这）：

- **`label` 是裸 i18n key，不是文案**。`generateMenuItemsFromRoutes` 把 `handle.title` 原样塞进 `label`；真正的翻译发生在渲染期 `translateMenus`（每次切语言重跑）。所以菜单项**永远不要**直接写中文 `label: "设置"`，要写 `label: "wiki:menu.settings"`。
- **归组不改路由树**，只重组菜单数组。点父标题不会跳路由——父项 `key` 是合成键 `solgroup:*`，被 `use-menu.ts` 的 `handleMenuSelect` 显式拦下（只展开、不导航，见 §4）。你写方案时**无需、也不能**为归组父项配路由。
- **归组是「注册态」视觉层**：只有被装进宿主、且方案路由行（`SolutionRouteRow`）已就绪的菜单才会归组。本地 `ojm dev` 直接扫源码跑，没有「安装」动作，菜单保持平铺——这是预期，不是 bug（详见 `module-dev-and-cdn-playground.md` §1）。

---

## §2 归组规则（要背下来的两条）

方案路由分 `main` / `admin` / `hidden` 三类（契约 C2-17 三值）。归组只动 `main` 和 `admin`：

### 规则 A：main 路由 ≥ 2 条 → 按模块归进一个父菜单

同一个 `module` 下**可见**（匹配到存活菜单项）的 `main` 路由 ≥ 2 条时，这几条从顶层被摘下，收进一个合成父项：

- 父项 `key` = `solgroup:main:<module>`
- 父项 `label` = 裸 key **`<name>:menu.group`**（`<name>` 是方案 manifest 的 `name`，见 §3）
- 子项按各自 `order` 升序排列，父项落在「组内最小 order 那个子项」原来的序位
- 只有 **1 条** main 路由 → 不归组，原样平铺

示例（方案 `wiki`）：

```
归组前：/space  /wiki/collections  /admin
归组后：▾ wiki（solgroup:main:wiki）        ← 父标题翻译自 wiki:menu.group
          ├ /space
          └ /wiki/collections
        /admin（普通 admin 路由，见规则 B）
```

### 规则 B：admin 路由 → 挂进宿主底部 `/system` 菜单

- 若宿主底部菜单存在 `key === "/system"`（框架固定系统设置入口），所有方案的 `admin` 路由被摘下移入该 `/system` 的 `children` 末尾，同样按 `module` 归成 `solgroup:admin:<module>` 父项。
- 若宿主**没有** `/system`（极少数自定义宿主）：admin 路由**不归组、回落平铺**到原序位，并 `console.warn` 一次（`warnOnce`，同消息不轰炸）提示「归组降级」。这是兜底，不是推荐态——正常宿主都有 `/system`。

> ⚠️ `/system` 是**框架侧断言**，不是方案 manifest 里能声明或验证的东西。方案只需把自己的 admin 路由标 `category: "admin"`，挂载点交给框架。

---

## §3 组标题 i18n key 约定（最容易踩的坑）

归组父项的 `label` 是 **`<name>:menu.group`**（`<name>` = 你的方案 `name`）。这条 key **必须**存在于双语 locale 文件，且必须是**嵌套**结构：

```jsonc
// web/src/<solution>/locales/zh-CN.json
{ "menu": { "group": "样例分组" } }   // 命中 wiki:menu.group

// web/src/<solution>/locales/en-US.json
{ "menu": { "group": "Sample Group" } }
```

- **只声明一条就够**：无论你有多少个模块、多少条 main/admin 路由，`groupSolutionMenus` 只认一个 key `<name>:menu.group`（按 `name` 去重，多模块也只产一条）。
- **必须嵌套**在 `menu.group`，不能平铺成 `"<name>:menu.group": "..."`（i18next 点路径取值）。
- 缺这条 key → 构建期契约校验直接 fail（见 §5）。

---

## §4 开发者的「该做 / 别做」清单

**该做 DO：**

- 路由 `handle.title` 写裸 key：`{ title: "wiki:menu.space", order: 200, layout: "container" }`
- 方案 manifest `routes[]` 每条标 `category`（main/admin/hidden）+ `order` 整数 + `title_key`（main/admin 必填，须匹配 `<name>:menu.*`）
- 在 `locales/{zh-CN,en-US}.json` 里补 `menu.group`
- 多个 main 路由想归到一组 → 让它们 `module` 字段相同、`category: "main"`
- admin 路由统一 `category: "admin"`，框架会自动塞进 `/system`

**别做 DON'T：**

- ❌ 为归组父项写路由 / 配 `handle` —— 父项是合成的，没有真实路由
- ❌ 直接写中文 `label` / `title` —— 必须走 i18n key，否则切语言不动
- ❌ 在方案里假设 `/system` 的 key 或结构 —— 那是框架断言，自定义宿主会回落平铺
- ❌ 给隐藏（hidden）或禁用（`enabled: false`）路由指望归组 —— 它们不参与（C2-17 / D12 上游已 filtering）
- ❌ 一个模块只挂 1 条 main 路由还想要父菜单 —— 规则 A 门槛是 ≥2，单条保持平铺

---

## §5 契约校验：C2-43（构建期 fail-fast）

`packages/cli/src/manifest-contract.ts` 在 `ojm build --bundle` 构建期执行：

- `groupI18nKeys(m)`：声明了 main/admin 路由的方案，引用面追加 `<name>:menu.group`
- `checkLocalesComplete`：该 key 在 zh-CN / en-US 任一缺失 → 报 **C2-43**（而非笼统的 C2-25），消息形如：
  `【C2-43】zh-CN 缺少归组父标题 key「wiki:menu.group」（须为嵌套 menu.group，C2-43；声明 main/admin 路由即须提供）`
- 去重语义：N 条路由只产 **1** 个 group key → 缺失时按「语言数」各报一次（例如双语都缺 = 2 条），**不会**按路由数重复报。

> 本地 dev 不跑这条（dev 不装、无方案路由行），所以「dev 正常、build 报错」几乎一定是漏了 `menu.group` 这条 locale key。

---

## §6 相关源码（改菜单行为先看这些）

| 关注点 | 位置 |
|---|---|
| 归组纯函数（SRP，无副作用，onWarn 依赖倒置注入） | `packages/runtime/src/router/utils/group-solution-menus.ts` |
| 接入点（setAccessStore 登记菜单时调用归组） | `packages/runtime/src/store/access.ts` |
| 合成父键点击拦截（只展开不导航） | `packages/runtime/src/layout/layout-menu/use-menu.ts`（`key.startsWith("solgroup:")`） |
| 菜单项类型（key/label/children/icon/disabled） | `packages/runtime/src/layout/layout-menu/types.ts` |
| 裸 key → 文案 翻译 | `packages/runtime/src/layout/layout-menu/utils.ts`（`translateMenus`） |
| 路由 → 菜单项 + 双段切分 | `packages/runtime/src/router/utils/generate-menu-items-from-routes.ts`、`splitMenuRoutes`（access.ts 内） |
| 契约 C2-43 | `packages/cli/src/manifest-contract.ts`（`groupI18nKeys` / `checkLocalesComplete`） |

回归用例：`tests/runtime/group-solution-menus.test.ts`（G1–G11 纯函数）、`tests/runtime/access-store-solution-grouping.test.ts`（接入层端到端）、`packages/cli/src/lifecycle/__tests__/manifest-contract.test.ts`（c2-43 块）。
