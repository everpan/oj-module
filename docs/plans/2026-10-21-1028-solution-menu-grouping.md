# 方案路由注册菜单归组（solution menu grouping）

- 日期：2026-10-21
- 分支：`feat/solution-menu-grouping`（基于 feat/ojm）
- 状态：设计待批准
- 修订：
  - builder-check 一轮（子代理评审）后修订三处——①签名改双列表进出（admin 跨列表挂载，Q1）；②组标题存裸 i18n key 由渲染层 translateMenus 翻译（Q2，消除语言切换不刷新缺陷）；③归组只处理顶层项、admin 路由约定顶层定义的嵌套边界（Q3）。测试表 G4/G5/G6/G11 同步更新。
  - **本轮（代码评估 + 硬伤修正）**：代码核验发现 5 处事实声明需订正 + C2-43 设计不可行需重做——(1) §4.2 接线代码 `get().solutionRows` 实为 `get().solutionRoutes`（否则编译失败）；(2) `mergeSolutionCategories` 不只标 category，还覆写 `order`/`hideInMenu`（§1/§2 措辞修正）；(3) `MenuItemType` 还含 `disabled?`，`label/icon` 为 `React.ReactNode`（非 string）；(4) `SolutionRouteRow` 还含 `required_permission`（前端不下发）；(5) `/system` 与 `order:-100` 不在本仓源码（框架 system 模块动态注册），标为框架断言而非"已验证"；(6) **C2-43 重做**：契约 `validateContract` 不加载 locale JSON，"校验数据源与 C2-25 相同"前提错误——C2-25 的双语齐备检查实为独立函数 `checkLocalesComplete`/`referencedI18nKeys`（见 §4.3）。
  - **5 专家交叉评审（领域：前端渲染 / 运行时状态 / CLI 契约 / i18n / 方案生命周期）**：交叉质证后修正 4 项——① **TDD 红测已存在**（`tests/runtime/group-solution-menus.test.ts`），其强制 `opts.onWarn` 回调 + 默认 `console.warn` 只一次（G6/G6b），§4.1 签名据此补全；② **layout-menu 非零改动**：`use-menu.ts` 的 `handleMenuSelect` 对父标题 `navigate(key)` 无守卫，合成 `solgroup:*` 键点击会 404，§4.4 加 `if (key.startsWith("solgroup:")) return;` 一行守卫（专家 1 关键风险）；③ **C2-43 去重**：group key 计入 `referencedI18nKeys` 会同时触发 C2-25，须在 `checkLocalesComplete` 内识别 `:menu.group` 改报 C2-43，并补契约文档登记 + 头注 `C2-01~34`（专家 3）；④ 可见 main 计数为"匹配存活菜单项"（hidden/enabled=false 已被上游滤除，不进入计数/摘除），§4.1 规则 1/2 澄清；§5.3 夹具路径与 C5 单 bundle 单 key 订正。专家 5 称 `/system` 在本仓 `web/system/entry.ts` —— 经全仓 grep **无 `/system` 字面定义**，其断言不成立，§1 维持"框架断言"。

## 1. 意图与背景

方案（solution）经市场安装后，其路由以 `sys_solution_route` 行（`path/module/category/order/title_key/required_permission/enabled`）下发，前端 `mergeSolutionCategories` 把 `category` 落到 `handle` 做**标注**，并**同时覆写 `order`、计算 `hideInMenu`**（`hidden` 或 `enabled=false` 即隐藏，路由仍可达，D12）——当前没有任何渲染层消费 `category`，安装后的菜单是若干顶层平铺项。

产品语义（用户裁定，2026-10-21）：

- **main** 路由：注册后按模块归到「<模块名>」父菜单下（开发形态不变）；
- **admin** 路由：**在 entry.ts 定义（开发者视角一致）**，注册后显示为框架「系统设置」(`/system`) 的子菜单：`系统设置 → wiki → 管理`；
- **有些解决方案模块可以没有管理菜单**（无 admin 路由即无该组）；
- **开发形态保持独立**：未安装（无方案路由行）时菜单与今天完全一致。

### 关键事实（已验证）

- 菜单层级唯一来源：`generateMenuItemsFromRoutes` 从路由树嵌套生成；`MenuItemType = { key, label, icon?, children?, disabled? }`，其中 `label`/`icon` 类型为 `React.ReactNode`（非 string——裸 i18n key 作为 string label 即走翻译，ReactNode 则原样渲染；组标题永远给 string key，故不受此分支影响）。
- `/system` 路由在**底部固定区**：`splitMenuRoutes` 按首个负 `order` 把后续路由切进 `bottomMenus`（pin 侧边栏底部）——admin 归组的挂载点在 bottomMenus。**框架断言（非本仓源码可佐证）**：框架 system 模块在运行时动态注册 `/system` 且 `order` 为负；本仓 `access.ts` 仅消费其注册结果，不定义它。归组默认 `systemKey="/system"`，挂载失败时回落（§4.1 规则 4）。
- 方案路由行经 `GET /api/_platform/solutions/routes` 下发（类型 `SolutionRouteRow`，含 `required_permission` 仅供后端深检、前端不下发）；行空（未登录/端点失败/未安装）时 `mergeSolutionCategories` 原样返回——**归组函数同样以空表为无操作**，开发形态天然不变。
- 契约最高编号 C2-33（health），新增条款取 **C2-43**。**注意**：C2-25 有两类——(a) `nameKeyRe` 仅做 key 命名空间正则（非双语校验）；(b) `checkLocalesComplete`/`referencedI18nKeys` 才是**双语 locale 齐备检查**（构建期缺 key fail-fast），本方案 C2-43 复用此机制（§4.3）。

## 2. 目标 / 非目标 / 反目标

**目标**

1. 注册后 main 路由按 module 归组（≥2 条可见 main 才归组，见裁决①）。
2. 注册后 admin 路由挂入宿主 `/system` 菜单下 `<模块名>` 组；宿主无 `/system` 时回落顶层平铺 + warn-once（裁决③）。
3. 模块组标题 `<name>:menu.group` 进 C2 契约双语 fail-fast（裁决②）。
4. 开发形态（无方案行）零变化；空表/端点失败降级不阻断（对齐 R21 哲学）。

**非目标**

- 不改路由树、不造假路由（URL 语义零污染）；不动 `sys_solution_route` 表结构与下发字段。
- 不改后端安装器写表逻辑；不动 `mergeSolutionCategories` 既有语义（它继续做 category 标注 + `order`/`hideInMenu` 覆写，归组是独立的后处理步骤）。
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

**签名（builder-check Q1 修订 + TDD 红测对齐）**：归组是**跨列表**操作（admin 项在 wholeMenus、`/system` 在 bottomMenus），单列表进出表达不了。一次调用吃两段菜单。**`onWarn` 为可选回调（TDD 红测 G6/G6b 要求，便于宿主接管告警与单测断言）；缺省走模块级 `warnOnce`（`console.warn` 同会话只打一次）**：

```ts
export interface GroupSolutionMenusOptions {
  systemKey?: string;                       // 默认 "/system"
  onWarn?: (msg: string) => void;          // 缺省：模块级 warnOnce（console.warn，同消息只一次）
}
export function groupSolutionMenus(
  top: MenuItemType[],            // wholeMenus
  bottom: MenuItemType[],         // bottomMenus
  rows: SolutionRouteRow[],
  opts?: GroupSolutionMenusOptions,
): { top: MenuItemType[], bottom: MenuItemType[] }
```

**注意**：`tests/runtime/group-solution-menus.test.ts` 已存在，是 TDD 红测规格，上面的签名/行为须与之逐条对齐（G1~G11 + G6b + 边界用例），实现落地以该测试转绿为准。

处理规则：

1. **行索引**：`rows` 按 path 建 Map；只认 `category ∈ {main, admin}` 且 `enabled !== false` 的行（hidden/禁用项此前已被 `mergeSolutionCategories`+`generateMenuItemsFromRoutes` 经 `hideInMenu` 滤除——它们根本不进入 top/bottom，因此也不进入计数或摘除；此处再兜底一遍）。
2. **摘除（只扫顶层，不递归 children）**：以 `key === row.path` 匹配**顶层**菜单项（`generateMenuItemsFromRoutes` 的 key 即绝对路径）。**不递归子项**——模块自嵌套的子路由（如 `/wiki` 父下的 `/wiki/inner`）即便有 main 行也不会被摘（G11：尊重模块自树，不告警）。命中 main 且该模块**可见 main ≥2（即可见项计数，非行计数）** → 摘下待归组；命中 admin → 摘下记下**来源列表**。
3. **main 归组**：按 module 分桶，每桶合成父项 `{ key: "solgroup:main:<module>", label: "<module>:menu.group" }`。**label 存裸 i18n key 不翻译**（builder-check Q2 修订：既有菜单 label 全是裸 key，渲染期 `translateMenus`（use-menu.ts）统一 `t()`，语言切换可刷新）。父项插入 top 的位置 = 该桶**第一个被摘项在原 top 中的索引**（保持升序序轴，G3 验证：`/zzz`(无行)、组插在 `/space` 原序位）。
4. **admin 挂载**：在 bottom 里找 `key === opts.systemKey`（默认 `/system`）的项 → 其 children **末尾**按 `row.order` 升序追加 `{ key: "solgroup:admin:<module>", label: "<module>:menu.group", children: [摘下的 admin 项] }`（即 系统设置 → wiki → 管理；G5 验证：原有 `/system/users` 在前）。**找不到 → 摘下的 admin 项按原序放回来源列表（top 或 bottom 的摘除原位）+ `onWarn` 一次**（Q1 修订）。
5. **不可变性（专家评审补充）**：返回**新数组**；**未变动的菜单项复用原 `menuItem` 引用、不深拷、不 mutate 入参对象**（G1 验证：新数组但内容相等）。
6. **嵌套模块路由（builder-check Q3 裁决）**：归组只处理**顶层**菜单项，规则 2 已强制"不递归 children"。admin 路由要被挂进 /system，**约定其在该方案 entry.ts 中必须顶层定义**（wiki 满足）；若某方案把 admin 定义成嵌套子路由，规则 2 的顶层扫描找不到它 → 静默留在模块自身树下、不进 /system（违反产品语义）。**§4.3 不强制契约校验 admin 顶层**，但本方案文档须写明此后果（专家评审建议补一条嵌套 admin 反例测试）。

### 4.2 接线（access store）

`packages/runtime/src/store/access.ts`：`splitMenuRoutes` 切出 top/bottom 后、生成 MenuItemType 后，接一步归组（Q1 修订：一次调用吃两段；`setAccessStore` 是归并的唯一出口，`initialState` 的 `solutionRoutes` 为空表，归组为无操作，无需重复接线）：

```ts
const { top, bottom } = splitMenuRoutes(newRoutes);
const grouped = groupSolutionMenus(
  generateMenuItemsFromRoutes(top),
  generateMenuItemsFromRoutes(bottom),
  get().solutionRoutes,   // 修正：store 字段为 solutionRoutes（非 solutionRows）
);
// wholeMenus: grouped.top / bottomMenus: grouped.bottom
```

- 只在 `setAccessStore` 接线：`setSolutionRoutes` 触发重归并时本就回调 `setAccessStore`（快照重放），归组随菜单重建自动覆盖；`reset()` 后重登记模块路由亦经同一出口。
- 组标题随既有 label 走裸 key → 渲染期 `translateMenus` 翻译，**语言切换可刷新**（Q2 修订后无此限制，§7 相关风险条目移除）。

### 4.3 契约新增 C2-43（cli）

**问题（硬伤重做）**：原稿称"校验数据源与 C2-25 相同、加载包内 locale JSON"——但 `validateContract` 只吃 `BundleManifest`（解析后的 manifest.yaml），**不接触任何 locale 文件**；它内部唯一的 locale 相关项是 `nameKeyRe`（C2-25 的 *命名空间正则*，非双语校验）。真正的双语齐备检查是**独立函数** `checkLocalesComplete(m, zhText, enText)` + `referencedI18nKeys(m)`，由构建管线在拿到 locale 文本后调用。因此 C2-43 不能"在 validateContract 里读 locale"，而应**复用 C2-25 的 locale 齐备机制**。

**合理方案**：归组父标题 key 为 `<name>:menu.group`，它当前**不在** `referencedI18nKeys` 的收集面（该函数只收 `routes/permissions/roles/settings` 的 title_key/label_key）。两步让 C2-25 自动覆盖它，并给归组一个独立可归因的条款：

1. **扩展 `referencedI18nKeys`**：当 `m.routes` 中存在 `category ∈ {main, admin}` 的路由时，按 `m.name` **去重**产出**一条**引用 key `<name>:menu.group`（嵌套键 `menu: { group }`；单 bundle 仅一个 `name`，故无论多少条 main/admin 路由只产一条，见 §5.3 C5）。这样 `checkLocalesComplete`（C2-25 双语齐备）会把该 key 纳入 zh-CN/en-US 双查。
2. **新增独立条款 C2-43**（归属 `checkLocalesComplete`，与 C2-25 同函数但独立编号，报错文案明确指向"归组父标题缺失"）：当存在 main/admin 路由而 `<name>:menu.group` 在任一 locale 缺失/非字符串时，报 `C2-43`（而非笼统的 C2-25），便于作者定位"你声明了会被归组的路由却没给组标题 i18n"。

**触发条件**：`routes[]` 中存在 `category ∈ {main, admin}` 的路由（hidden-only 方案不触发——"可以没有管理"自由度保留；同样，单 main 模块虽不建组，但只要声明了 main 路由就要求其 `menu.group` 存在，因为声明即承诺可被归组）。

**校验数据源**：与 C2-25 **完全同一套**——构建管线传给 `checkLocalesComplete` 的 `zhText`/`enText`（包内 `web/` 产物 locale JSON）。

**实现落点**：在 `manifest-contract.ts` 内 (a) `referencedI18nKeys` 增加 group-key 收集；(b) `checkLocalesComplete` 增加 C2-43 分支（复用既有 `lookupKey`/`parseJson`，不重复造轮子）。**不新增读取 locale 的入口**——只扩展既有机制。

**关键去重（专家评审订正，否则 C2-25/C2-43 重复报错）**：`referencedI18nKeys` 现对每个 key 在 `checkLocalesComplete` 统一报 **C2-25**（`:646`）。若把 group key 计入引用集，缺失时会**既报 C2-25 又报 C2-43**。实现须在 `checkLocalesComplete` 遍历中识别 group key（判定式 `key.endsWith(":menu.group")` 且前缀为 `m.name`），**跳过通用 C2-25 分支、改报 C2-43**（文案明确"归组父标题缺失，须为嵌套 `menu.group`"）。`referencedI18nKeys` 当前不读 `m.name`，扩展时取 `m.name` 拼 `<name>:menu.group`（若 `m.name` 缺失则依赖 `validateContract` 已报 C2-01）。

**契约纪律（专家评审补）**：(1) 改 `manifest-contract.ts:2` 头注 `C2-01~33` → `C2-01~34`；(2) 在契约真源文档 `docs/prd/solution/202610171254-lifecycle-manifest-contract.md` 登记 C2-43（构建期 file-face 规则；安装期信任构建产物，`preflight.ts` 仅含 C2-25 语法层正则、无双语齐备检查，**无需同步 preflight**）。

### 4.4 不做什么（明确边界）

- 不动 `merge-solution-categories.ts`（标注与归组分层，单一职责）。
- 不动 `generate-menu-items-from-routes.ts`（它保持"路由树→菜单"的单一映射）。
- **`layout-menu` 渲染层仅一处最小改动（专家评审订正）**：合成父键 `solgroup:*` 非真实路由，`use-menu.ts` 的 `handleMenuSelect` 在默认侧边模式对父标题调 `navigate(key)`（`:114`，无 children/路由守卫）——点击组标题会 `navigate("solgroup:main:wiki")` 落空 → 404/白屏。须在 `handleMenuSelect` 入口加一行守卫：`if (key.startsWith("solgroup:")) return;`（前缀约定与合成键同源；`/system` 等真实父键不受影响，因其是真实路由）。**其余 layout-menu 零改动**。

## 5. 测试计划（BDD，先写规格）

### 5.1 `group-solution-menus`（vitest，runtime 仓库内）

**红测已落地**：`tests/runtime/group-solution-menus.test.ts` 已存在，覆盖 G1~G11 + G6b（默认 warn 通道 console.warn 只一次）+ 边界（单 main+admin）。实现以该测试转绿为准（目前因 `#src/router/utils/group-solution-menus` 未创建而导入失败）。签名带 `opts.onWarn`（`tests/runtime/group-solution-menus.test.ts:96`）。

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
| G12 | 嵌套 admin 反例 | 模块把 admin 定义成 /wiki 父下的子路由（有 admin 行） | 顶层扫描找不到→留模块自树下、不进 /system（规则 6 后果，无告警；文档须明示此违反产品语义） |

### 5.2 access store 集成（既有测试风格补用例）

- `setSolutionRoutes` 推送后菜单出现父项（快照重放通路 `access.ts:96-102` 回调 `setAccessStore`）；
- `reset()` 后 `solutionRoutes` 清空→归组无操作（退回开发形态），随后重登录由 `useSolutionRoutes` 刷新重归并——验证不残留错位（专家评审补，对齐 `access-store-reset.test.ts` 风格）；
- `setAccessStore` 调用 `groupSolutionMenus` 时**不传 `onWarn`**，走缺省模块级 `warnOnce`（`console.warn` 同会话只一次），生产环境无需宿主接入。

### 5.3 C2-43（cli 契约测试，对齐 manifest-contract 现有用例风格）

归组父标题校验落点为 `referencedI18nKeys`（扩展）+ `checkLocalesComplete`（C2-43 分支），与 C2-25 共用 locale 文本入参。用例：

| # | 场景 | 期望 |
|---|---|---|
| C1 | main 路由 + `menu.group` 双语齐 | `referencedI18nKeys` 含该 key；`checkLocalesComplete` 无违规 |
| C2 | main 路由缺 `menu.group`（zh 缺） | `checkLocalesComplete` 报 C2-43（非 C2-25，去重生效） |
| C3 | 仅 hidden 路由 | `referencedI18nKeys` 不产 group key；不触发 C2-43 |
| C4 | key 存在但只单语（en 缺） | `checkLocalesComplete` 报 C2-43（双语齐备复用 C2-25 机制，归因 C2-43） |
| C5 | 同一 bundle 多条 main 路由 | 只产**一条** `<name>:menu.group`（按 `m.name` 去重，不随路由数重复） |

**夹具（路径订正，专家评审）**：locale 真实路径为 `packages/cli/src/lifecycle/__tests__/fixtures/fixture-valid/web/src/demo-solution/locales/{zh-CN,en-US}.json`；`fixture-valid` 的 `manifest.yaml` **已含** main(`/demo-solution`)+admin 路由，无需新增触发路由，只需在其 locales 补 `menu.group` 即成正例；`fixture-invalid` 加一条"main 路由但 locale 无 `menu.group`"的反例（C2）。用例沿用现有克隆 VALID→变异→断言风格（`manifest-contract.test.ts`）。

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
- **合成父键非路由（专家评审已确认需改，§4.4 落守卫）**：`solgroup:main:<module>` / `solgroup:admin:<module>` 是合成父键、非真实路由。`use-menu.ts:114` 的 `handleMenuSelect` 对父标题直接 `navigate(key)`（无 children/路由守卫），点击组标题会落空 → 404/白屏。已在 §4.4 加 `if (key.startsWith("solgroup:")) return;` 守卫；**drill 阶段显式验证一次父键点击不报错 + 语言切换刷新组标题**。
- wiki drill 尚有一条未决项（`/wiki/ws` 匿名注册）不受影响，按原计划在 drill 中一并观察。
