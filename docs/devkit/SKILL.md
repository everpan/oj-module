---
name: ojm-module-dev
description: 用 ojm 开发前后端一体工程时使用——新增/修改前端模块（entry.ts、pages、locales）、写 oj handler 的 .schema 与业务逻辑、跑 oj openapi + ojm api 生成 client、注册 provider/布局/插槽、改 web.config.ts，或排查「模块没加载 / 注册不生效 / 请求未绑定 / 铃铛按钮灰」时。触发场景：建模块、加页面、加接口、接管通知或上传、换布局、ojm dev 起不来。
---

# ojm 模块开发

本 skill 与参考手册 `manual.md` 同目录。**按章节号按需读章，不要盲读全文。**

后端 handler 本身的写法（`json` 信封、`db` 查询、`manifest.yaml`、`oj test`）、
站点挂载（`mounts`）、密钥信封（`secrets`）、vars、cors、schema 校验、broker/tasks/oidc/ws 等
属于 **`oj-api-dev` skill** 的范围——`ojm init` 已把它装到工程的
`.claude/skills/oj-api-dev/`（权威源随 oj 二进制分发，随 oj 版本更新），
本 skill 只讲它到前端这一侧的对接。

## 工作流

1. **读章**：建模块 → 手册 §2；加接口（handler .schema → oj openapi → 生成 → 对接）→ §3；
   接管通知/上传/菜单 → §4；换布局或加插槽 → §5；排查 → §8。
2. **建目录**：一个目录 = 一个模块——前端一侧 `src/<模块名>/web/`（`entry.ts` 必备，
   `pages/`、`locales/` 按需），后端一侧 `src/<模块名>/api/`（目录镜像路由的 `api.ts`，
   动词挂 `.schema`）。两侧可只存在一侧。
   `entry.ts` 是模块元数据**唯一来源**——没有单独的 `package.json` / `meta.json`。
3. **对接四步流水线**（加接口就背这条）：
   ```
   写 handler .schema → 写 handler 业务逻辑(api.ts) → oj openapi + ojm api 生成 client → entry.ts 的 onInit 里 create<Module>Client(ctx) + 注册
   ```

   ```mermaid
   flowchart LR
     A["handler 动词写 .schema（入参）+ 平级 .response（出参）"] --> B["写业务逻辑 api.ts"]
     B --> C["oj openapi 生成 openapi.json（唯一事实源）"]
     C --> D["ojm api 生成 src/模块/web/__client"]
     D --> E["entry.ts onInit：create&lt;模块&gt;Client(ctx) 一次"]
     E --> F["web.config.ts 登记模块（可选覆盖；扫描为真源）"]
   ```
4. **登记**：往工程根 `web.config.ts` 的 `modules` 数组加一项（module-root 布局里 `ojm build/dev`
   以扫描 `src/*/web/entry.ts` 为真源，登记项排前面、其余按扫描顺序追加；历史布局则必须登记）。
   **要「不构建」写 `enabled: false`——注释掉无效。**
5. **验证**：`pnpm dev`（前端 devServer **5174** + oj 后端 **9778**，端口以工程根 `config.yaml` 为准）
   → 登录 `admin / 123456` → 按 §8.1 五步清单核对。

## 红线（不可违反）

- **登记**：`web.config.ts` 的 `modules`（`enabled` 缺省即启用，显式 `enabled: false` 才禁用）。
  清单**先后顺序就是接管优先级**（同一入口先注册者生效，无优先级数字可填）。
  历史布局漏登记 = 模块安静不加载；module-root 下登记是可选的，但**排序仍靠它**。
- **`home` / `login` 模块必须保留**：shell 预构建把 `/` 重定向到 `/home`，且宿主只消费
  模块路由、不挂内置登录页。删掉它们 → 登录回跳落错误边界、`/login` 无路由可跳。
- **布局级路由 handle 必写 `layout: "container"`**：不写页面会裸渲染（无侧边栏/页签），
  且 `keepAlive` 失效。`"container" | "parent" | "none" | 自定义名`。
- **注册时机**：一切 `ctx.register.*` 必须在 `lifecycle.onInit` 内、且在 onInit 返回前完成。
  拖到 `onActivate` 或某个异步回调里注册不保证生效。`onInit` 签名是 **async**（返回
  `Promise<void>`）——漏写 `async` 会被 `tsc` 以 TS2322 拦下，范本见模板
  `src/notification/web/entry.ts`。
- **一模块一 client**：`create<Module>Client(ctx)` 只在 onInit 里创建一次。
  页面/组件/事件回调里**不要**再创建——会覆盖 request 单槽。页面里直接 import 裸函数调用。
- **只创建自己模块的 client**：A 模块的 onInit 里创建 B 模块的 client 会 DEV 告警。要别家接口，
  走「B 自己注册 provider、A 消费 provider」的正路。
- **既然接管就整套接管**：`ctx.register.*Provider` 的方法一个都不能少，不做「只接管读、写还用框架的」。
- **生成物勿手改**：`src/<模块>/web/__client/**` 重跑即覆盖（eslint 已忽略）。改需求 = 改 handler 的
  `.schema`，重跑 `oj openapi` + `ojm api`。`openapi.json` 由 `oj openapi` 生成（oj 内省 `.schema` 的权威产物）。
  唯一例外是 `src/<模块>/api/**/api.ts` 的 stub——文件头带 `// ojm-api:stub` 指纹、被人工动过后，工具**永不写永不删**。
- **前缀约束**：API 前缀取模块 `manifest.yaml` 的 `name`（**约定与目录名一致**；`src/order/api/**` → `/order`，**不是** `/api/order`）。
  handler `.schema` / 路由须落在该目录内，否则 oj 路由表与生成物对不上、人话报错。
- **不返回数据的接口不写 `.response`**：平级声明位直接省略即可（oj v0.1.72+；旧 `.schema.response` 通道仍兼容）；校验一律放后端。
- **上传文件**：当前 `ojm api` 的 openapi 流水线不生成 form 通道的前端 client（文件部件不进 JSON Schema），
  惯例走 antd `Upload` **直连**后端（不经 JSON client），handler 用 `http.files` / `http.file(i)` 读字节，
  仅平级声明 `.response`。不要手写 `content-type`（运行时按 boundary 自动补）。
- **前端模块的 import 只有三类**：`@oj-module/runtime`、宿主 importmap 提供的共享依赖、
  自身相对路径。共享依赖不进工程 `dependencies`（宿主提供单例，模块不得打包副本）。
  **拿用户/角色等信息：读走 `useUserStore` / `useAuthStore` / `useAccess`（`AccessControl` 门禁），
  写走契约 client（`ojm api` 生成模块自有 `__client`，或复用 runtime 导出的 `api/rbac` / `api/user`），
  绝不 import 框架 `#src/*`**——设计动机与红线见手册 §2.8。
- **后端方法名是 `del`，不是 `delete`**（写成 `delete` 返回 405）。
- **加一张新表是三件套，不是只写 `schema.yaml`**：`src/<模块>/api/migrations/{seq:04}__*.sql`（DDL 的真正定义（实际 SQL），
  DDL 只进 migrations）+ `schema.yaml`（声明，与 migration 逐字段一致）+ `manifest.yaml` 的 `tables:`
  （与 schema 双向一致）。少一个就建不出表或启动失败。见手册 §1.5。
- **`seed.sql` 每次启动都重放**，必须幂等（`INSERT OR IGNORE`）；它按 `;` 朴素切分，
  注释里不许出现分号字面量。
- **handler 四红线（manual §1.7，oj 运行时实测）**：① 未捕获异常恒 500 不读
  `err.status`——业务错误必须经 `respond()` 收口 `json.fail`；② 跨模块引用走
  `#/<模块名>/…` 别名（相对 import 按**目录**解析，多一层 `../` 就 route error）；
  ③ 模块级 `let`/`Map` 不跨请求存活（oj 每请求重建模块）——跨请求状态必须落库；
  ④ 模块级禁止触碰运行时全局（`jwt`/`axis`/`bcrypt`），`oj build` introspect 空沙箱会炸。

## 重启边界（最容易卡住新人）

| 改动 | 生效方式 |
|---|---|
| 已有 `api/**/api.ts` 的**文件内容** | 保存即热更 |
| **新增/删除**后端模块目录（`src/<模块>/api`） | **必须重启 `ojm dev`** |
| 改 `schema.yaml` / `migrations/` / `config.yaml` | **必须重启** |
| 前端 `src/<模块>/web/**` | 模块重建 + 浏览器自动刷新 |

## 新模块 checklist

- [ ] `src/<模块>/web/entry.ts` 默认导出 `defineModule({ name, version, routes, i18n?, lifecycle? })`
- [ ] `web.config.ts` 的 `modules` 里已登记（`enabled` 缺省即启用；module-root 下扫描已能捡到，登记用于排序/覆盖）
- [ ] 路由 `handle.layout` 选对了（有页面用 `"container"`；无页面模块 `routes: []`）
- [ ] 菜单标题用命名空间语法 `"<模块名>:menu.<key>"`，且 `locales/<lang>.json` 里有这个 key
- [ ] 有接口 → handler 动词挂了 `.schema`（入参）+ 平级 `.response`（出参，oj v0.1.72+）→ `oj openapi` + `ojm api` 跑过 → onInit 里 `create<Module>Client(ctx)`
- [ ] 接管了某功能 → provider 方法数与类型定义**一个不差**
- [ ] 有后端 → handler 四红线过一遍（manual §1.7：respond 收口 / import 深度 / 无模块级状态 / 无模块级运行时全局）
- [ ] `pnpm dev` 起来后按 §8 五步排查全过

## 旧工程迁移（contract.ts / defineApi → 新流水线）

存量工程用 `api/src/<模块>/contract.ts`（`defineApi` + zod）声明契约——翻译层已删除，
`ojm api` 不再读取它。迁移五步：① 盘点端点 → ② 入参译到 `.schema`、`data` 译到平级
`.response`（zod→JSON Schema 对照表）→ ③ `oj openapi -c config.yaml --module-root src -b /api -o openapi.json`
（历史布局 `-d api/src`）→ ④ `ojm api` + 前端调用点改 `camelCase(operationId)` → ⑤ 删 `contract.ts` 与旧产物
（per-module `routes.json` / `openapi.yaml`），`ojm api --check` 零漂移。
前置：oj ≥ 0.1.73（迁到 module-root 布局需 ≥ 0.1.85）、框架包 ≥ 0.1.20。完整字段映射与丢失面清单见 **manual.md §3.10**。

## 常见陷阱速查

| 症状 | 原因 | 处置 |
|---|---|---|
| 模块像不存在：没路由、没反应、也不报错 | `web.config.ts` 里没登记 | 登记后重启 `ojm dev` |
| 注册了却没效果 | 注册代码不在 `onInit` 里 | 挪进 `onInit` |
| 控制台「重复的 xx provider 忽略」 | 两个模块同时接管同一功能入口 | 排前面的生效；调 `web.config.ts` 顺序或撤一处 |
| 铃铛按钮全灰 | 没注册通知 provider，或只写了「拉列表」一个方法 | 4 个方法补齐 |
| 调用报「请求未绑定」 | onInit 里没调 `create<Module>Client(ctx)` | onInit 里先 create 再发请求 |
| 控制台「模块 A 正在为 /b 路径创建 client（越界）」 | A 创建了 B 的 client | 由 B 创建并通过 provider 提供能力 |
| `ojm api` 报「schema 超出白名单」 | `.schema` 写了白名单外关键字（如 `$ref`/`oneOf`/`format`）或非法类型 | 校验放后端；如需 union 用类型数组 `["string","number"]` |
| 上传报 400「文件字段缺失」 | 后端 `http.files` 字段名与前端 FormData 不一致 | 对照 handler 读的 `http.files[0].name` / `http.body.<name>`，字段名对齐 |
| 上传报「Unsupported Media Type」/ 后端收不到文件 | 手写了 `content-type`（boundary 丢失） | 走 antd Upload 直连，删掉手写的 header，交运行时按 FormData 自动补 |
| `oj openapi` / `ojm api` 报路由与目录不符 | handler 路径 / 组名与模块目录约定不一致 | 后端路由 = 目录镜像（manual §1.3），嵌套组 / 动词键遵循 manual §3.9 |
| 改了 `.schema` 前端类型没变 | 没重新生成 | 跑 `oj openapi` + `ojm api`；生成是确定的，diff 应只含你改的部分 |
| 上传报 401 | `headers` 写成了固定对象，token 过期 | 写成方法，用的时候现取 |
| 后端菜单用了我的布局名，页面却没壳 | 注册该布局的模块没加载 | 看控制台 `[layout] 未知名布局` 提醒 |
| 后端下发的组件找不到 | 下发的组件名必须在框架页面目录里 | 自己模块的页面走模块 `routes`，别从后端下发 |
| 下线模块后页面没变 | 已渲染的页面不自动换 | 刷新页面 |
| 新建后端模块目录后 API 404 | 目录镜像路由未热更 | **重启** `ojm dev` |
| DELETE 返回 405 | 方法名写成了 `delete` | 改成 `del` |
| 页面无侧边栏/页签、keepAlive 失效 | 路由 handle 没写 `layout: "container"` | 补上 |
| 出现双滚动条 / 点回到顶部没反应 | 页面里自己又包了一层 `overflow:auto` | 删掉，内容塞进 `BasicContent` 落主滚动区 |
| 固定浮层被顶栏/页签遮挡或溢出 | `position:fixed` 按整窗算高度 | 用 `--react-antd-admin-content-height/width` 取实时高度 |
| 移动端侧边栏「不见了」 | 移动端进抽屉、iPad 默认折叠、可关 | 正常；别硬编码侧栏宽度，用 content-width |
| 覆盖 `container` 后通知铃/页签没了 | 覆盖了内置外壳，自带 chrome 全失效 | 别覆盖；要加东西用 `header-actions` 插槽 |
| 自定义布局里子页面空白 | 组件没渲染 `<Outlet/>` | 补 `<Outlet/>` |
| 登录 401 且 msg 不是 `invalid credentials` | `/auth/*` 不在 `anonymous_paths` | 加进工程根 `config.yaml`，重启 |
| WS 连接 401（「文件在却连不上」） | 模块写了 `ws.ts`，但其 `/ws` 路由不在 `anonymous_paths`（oj v0.1.30+ WS 握手也过鉴权） | 匿名 WS 加进 `anonymous_paths`；受保护 WS 带 Bearer/Cookie 是正当用法。`ojm api --check` 会对此 warn |
| 登出/回登录页落空，或登录后落错误边界 | 工程缺 `login` / `home` 模块 | 在 `web.config.ts` 保留两者 |
| 通知铃 404 `no route matched`（`/api/notifications`） | 前端 `notification` 模块没加载 / 没注册 `notificationsApi`，回落到内置只读兜底；脚手架不再提供 root 级 `/api/notifications` | 保留 `src/notification/web/entry.ts` 的登记 + onInit 注册四方法；后端由 `src/notification/api` 出 `/api/notification/*` |
| `oj serve` 启动即退，报 `config uses removed server.* site keys (v0.1.58): api_prefix` | 用了 oj v0.1.58 起删除的旧站点键（`api_prefix`/`app_path`/`app_prefix`/`static_sites`/`app_spa_fallback`） | 改 `server.api_prefix: /api` 为顶层 `mounts:`（module-root 写 `{prefix: "/api", api: "api/dist"}`；历史布局写 `api: "src"`、源码交给 `-d`）；迁移完整 YAML 由报错给出 |
| 改完 `mounts:` 仍全 404 | `api:` 指向目录不对（相对 config 所在目录） | module-root 指向产物目录 `"api/dist"`、历史布局指向源码树 `"src"`；`-c` 指向工程根 `config.yaml`（ojm dev/preview 已内置）。module-root 模板**故意不写 api 挂载**（源码交给 `--module-root src`、产物交给 `--api-path api/dist`，同时出现会报 module declared in multiple places） |
| `oj serve` 启动即退，报 `module '_shared' missing manifest.yaml` | 把共享后端代码放到了扫描根顶层（`src/_shared/`）——oj 把扫描根下的顶层目录都当模块；历史布局是 `api/src/_shared/` | 嵌进所属模块：`src/<模块>/api/_shared/`（历史布局 `api/src/<模块>/_shared/`），用 `#<本模块>/...` 别名 |
| 后端 `import '@oj-module/runtime/...'` 报错或装到站点后崩 | 那是浏览器侧包（React / 浏览器全局），且方案包 tgz 不带 `node_modules` | 后端原语/类型放本模块 `api/_shared/`，跨模块用 `#/<模块名>/_shared/...`；跨端共享类型以 runtime 为单一真源、两端形状手动同步 |
| 跨用户删/读他人通知不报错却像没生效 | 原语对不存在/非本人的行 `UPDATE 0` 行返回 `ok`，没区分归属 | 原语（`delNotice`/`markRead`）返回 `boolean`/`count`，端点据 `false`/`0` 映射 `json.fail(403, "forbidden")` |
| handler 写了动词子目录（`read/api.ts` 这类） | 旧形态（oj v0.1.64 前） | 按 manual §3.9「DDD 判据速查」reshape：同聚合多动词收模块根嵌套组，`del` 保留键例外 |
| 业务错误恒 `{"code":500}`（401/403/409 全变 500） | handler 抛异常被 oj 一律抹 500，不读 `err.status` | service 抛 `Error & {status}`，handler 经 `respond()` 收口（manual §1.7-1） |
| dev 日志 route error（Cannot find module）/ 端点 404 | handler 相对 import 多一层——按**目录**解析 | 改用 `#/<模块名>/…` 别名（与深度无关）；存量代码按 manual §1.7 深度表改 |
| 限速/节流/计数真实请求下永不累积（测试全绿） | 模块级 `Map`/`let` 不跨请求存活（每请求重建模块） | 状态落库（模板迁移 0009 先例）或 oj 持久面 |
| `ojm build` 报 `introspect api.ts: jwt not configured` | 模块级语句碰运行时全局，introspect 空沙箱炸 | 移进 handler 函数体内（manual §1.7-4） |
| 页签怎么点都关不掉、无报错提示 | `beforeClose` 守卫 fail-safe 否决（守卫抛错按取消处理） | 先查控制台 `[tabs] beforeClose` 报错；确认弹窗逻辑与 `resolve(true/false)` 收口（manual §6.4） |

## 手册

`manual.md`（同目录）共 13 章：1 工程结构（module-root 单树 / 两处产物根 / **§1.7 handler 四红线** /
**§1.8 `#` 别名与 TS 投影**——oj 运行时实测钉出，后端 handler 必读）/ 2 写前端模块 /
3 契约与代码生成 / 4 接管框架内置功能（provider）/ 5 布局与插槽 / 6 i18n 与样式 / 7 构建与发布 /
8 排查 / 9 参考 / 10 CLI 子命令参考（ojm 原生命令 vs oj 透传命令的差异区分）/
11 方案包打包与分发 / 12 签名与信任 / 13 方案菜单归组规则。
