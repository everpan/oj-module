---
name: ojm-module-dev
description: 用 ojm 开发前后端一体工程时使用——新增/修改前端模块（entry.ts、pages、locales）、写 oj handler 的 .schema 与业务逻辑、跑 oj openapi + ojm api 生成 client、注册 provider/布局/插槽、改 web.config.ts，或排查「模块没加载 / 注册不生效 / 请求未绑定 / 铃铛按钮灰」时。触发场景：建模块、加页面、加接口、接管通知或上传、换布局、ojm dev 起不来、接通企业微信代开发（企微登录、多 corp 租户隔离、代开发后台、suite_ticket 收不到）。
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
   接管通知/上传/菜单 → §4；换布局或加插槽 → §5；排查 → §8；
   **组织架构 / 通讯录（选人、按部门算收件人、接 LDAP 等新来源）→ §14**；
   **接通企业微信（代开发 / 企业内部应用 / 两套共存）→ `wecom-daikaifa.md` + `wecom-internal-app.md`**；
   **把方案包发出去（打包/签名/CDN/安装一条链，新手照敲）→ `publish-walkthrough.md`**
   （发布身份走站点凭证见其 §2.1）。
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
   → 登录 `admin / aA123456` → 按 §8.1 五步清单核对。

## 红线（不可违反）

- **登记**：`web.config.ts` 的 `modules`（`enabled` 缺省即启用，显式 `enabled: false` 才禁用）。
  清单**先后顺序就是接管优先级**（同一入口先注册者生效，无优先级数字可填）。
  历史布局漏登记 = 模块安静不加载；module-root 下登记是可选的，但**排序仍靠它**。
- **`home` / `login` 模块必须保留**：shell 预构建把 `/` 重定向到 `/home`，且宿主只消费
  模块路由、不挂内置登录页。删掉它们 → 登录回跳落错误边界、`/login` 无路由可跳。
- **布局级路由 handle 必写 `layout: "container"`**（`category: "admin"` 除外，未声明时框架默认 `container`）：不写页面会裸渲染（无侧边栏/页签），
  且 `keepAlive` 失效。`"container" | "parent" | "none" | 自定义名`。
- **注册时机**：一切 `ctx.register.*` 必须在 `lifecycle.onInit` 内、且在 onInit 返回前完成。
  拖到 `onActivate` 或某个异步回调里注册不保证生效。`onInit` 签名是 **async**（返回
  `Promise<void>`）——漏写 `async` 会被 `tsc` 以 TS2322 拦下，范本见模板
  `src/app/web/notification/entry.ts`。
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
- **前端模块的 import 只有三类**：`@oj-module/runtime`、共享依赖（裸说明符）、自身相对路径。
  共享依赖分两档：**宿主 importmap 单例**（`react` / `antd` / `dayjs` …，模块不得打包副本）
  与**模块自打包**（`echarts` 家族 / `vditor` / `@plane/editor`，宿主不提供、模块自带，
  体积记在模块产物上）。两档都写 `devDependencies`；分档口径与体积控制见手册 §2.6。
  **拿用户/角色等信息：读走 `useUserStore` / `useAuthStore` / `useAccess`（`AccessControl` 门禁），
  写走契约 client（`ojm api` 生成模块自有 `__client`，或复用 runtime 导出的 `api/rbac` / `api/user`），
  绝不 import 框架 `#src/*`**——设计动机与红线见手册 §2.8。
- **组织架构/通讯录是内置底座，别自己搭**：部门与成员是 `_platform` 的两张租户表
  （`sys_department` / `sys_dept_member`），外部来源（企微 / LDAP）只是往这套模型灌数据的**适配器**。
  要「谁在哪个部门」用共享读面 `/api/_platform/org/*` 或后端直调
  `#/_platform/_shared/service/domain/org-read`（`resolveReadFace` 一次做完守卫）；要「某部门含下级的所有人」
  用 `org/resolve`。**别自己建部门表、别自己调企微通讯录接口、别拉全树在 JS 里递归**。
  跨模块别名须在自己模块 `manifest.yaml` 的 `deps` 里声明 `_platform: ^0.1.0`。详见手册 §14。
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

## 企业微信（接通真实套件 / 自建应用）

模板已内置企微登录（`src/app/api/auth/wecom/` + 登录页「企业微信」页签 + `/system/wecom` 后台）。
两种来源、两本手册，**按客户形态选**：

| 客户形态 | 读 | 凭据 |
|---|---|---|
| 多家企业（SaaS，扫码即装） | `wecom-daikaifa.md`（同目录） | 代开发套件 8 项 `vars`（Tier A/B/C） |
| 单企业私有化 | `wecom-internal-app.md`（同目录） | 自建应用 5 项 `wecom_corp_*` + 2 项复用 |
| 两者同时 | 两本都读，共存看 `wecom-daikaifa.md` §10 | 两套都填 + `wecom_allow_coexist: 'true'` |

两本手册都有**凭据清单、开通顺序、用户/开发/部署三视角、错误文案速查**，接企微时先读它们。
这里只列最容易踩的五条：

- **凭据填齐 = 启用，没有 `wecom_mode`**。只看「哪套变量填了」：`wecom_suite_id` + `wecom_suite_secret`
  = 代开发；`wecom_corp_id` + `wecom_corp_secret` + `wecom_corp_agent_id` = 自建。两套都齐必须显式
  `wecom_allow_coexist: 'true'`，否则首个请求 400（配置事故要看得见，不允许静默择一）。
  `wecom_enc_key` / `wecom_base_url` 两种来源都要；`wecom_base_url` 必须以 `/api/auth/wecom` 结尾，
  它派生 `<base>/event`（回调 URL）与 `<base>/callback`（网页授权回跳）。
- **`suite_ticket` 是被企微推来的**（每 10 分钟一次、30 分钟过期），所以「回调 URL 打通」必须
  早于「生成开通链接」，否则 503 且看起来像代码坏了。自建模式没有 `suite_ticket`。
- **新增企业不改配置、不重启**（代开发）：企业管理员确认授权 → `create_auth` → `wecom_app_profile`。
  同企业测试+正式两个应用是两行（主键含 `agent_id`），此时登录链接必须带 `&agent=`。
  **自建模式反过来**：一套部署一家企业，档案行由 `/system/wecom` 点「验证并接入」写入；
  换过 Secret 必须重新点一次。
- **自建应用收不到成员变更事件**（官方 90970）：要事件增量，只能让企业管理员另配
  「通讯录同步 → 接收事件服务器」，且该 URL 必须在企业主体域名下——这就是「SaaS 多企业只能走代开发」的由来。
  一个 `/event` 端点吃两套回调，靠逐个 Token 试签分辨，两组凭据不能串用。
- **整页跳转拼 API base**：`window.location.assign(resolveApiBase() + wecomAuthorizePath(corp))`；
  拼站点 base 会被 SPA 兜底页吞掉（页面原地重载、一个请求都不发，控制台无报错）。
- **通讯录同步是「组织架构底座 + 企微适配器」，不是企微专属功能**：模板的
  `src/app/api/auth/wecom/{sync,contacts}.ts` 只负责「取快照 → 喂给领域层」，模型与读面在 `_platform`
  （手册 §14）。要按部门算人、要选人、要给组织架构接 LDAP，一律读 §14，不要在企微代码里加分支。
  同步/事件增量与回调解密是**两条独立纪律**：回调必须回 `success`，而事件处理失败**也照样回 `success`**
  （重推补不回已判死的失败，兜底是下一轮全量同步）。

## 发布身份（keygen 从哪来）

签名前的第一件事是拿到一对 Ed25519 密钥。**两条路，二选一**：

| 路径 | 命令 | 何时用 |
|---|---|---|
| 站点凭证（推荐） | `ojm keygen --credential <token>` | 站点有「方案市场 → 发布管理」页；key_id 由站点按产品名+账号下发（信任仍需首装核对） |
| 离线自建（旁路） | `ojm keygen --id <publisher>.<key-name>` | 只在站点没有「发布管理」页（纯自建/离线 CDN）或 CI 临时密钥时用 |

站点有「方案市场 → 发布管理」页时**不要自建 key_id**：站点侧没有这条身份记录，产品归属与申请人无从追溯，
能不能装只能靠超管为陌生指纹手工放行。

- 凭证是**一次性兑换令牌**：站点「方案市场 → 发布管理 → 申请发布凭证」填产品名 → 明文只显示一次 →
  本机 `ojm keygen --credential <token>`（或 `OJM_PUBLISH_CREDENTIAL=<token> ojm keygen`，
  免得令牌进 shell 历史）。兑换成功即作废，失败（已用/过期/撤销/网络不通）**不落任何密钥文件**。
- 站点地址优先级：`--site-url` > `OJM_SITE_URL` > `http://127.0.0.1:9778`；兑换端点匿名可达，
  **不需要 `--user/--pass`**。`--credential` 与 `--id` 互斥（同时给 exit 2）。
- 下发的 key_id 形如 `<产品名>.<编码后用户名>`（例：`demo-solution.wecom-everpan`），CLI 不做推导；
  它同时是 `~/.ojm/keys/<key_id>/` 的目录名——**不要拿它拼路径或改名**，否则签名侧找不到私钥。
  凭证只解决「身份命名与归属」，**不预置信任**：公钥在本地生成，站点兑换时拿不到，首装照样
  `needs_trust`，仍要核对指纹。
- 两条路的私钥纪律完全一致：只活在 `~/.ojm/keys/<id>/`、不入仓不入包、一次发布固定一把。
  签名/发布/安装全流程见 `publish-walkthrough.md`（§2 凭证、§2.1 离线旁路、§3 签名起）。

## 新模块 checklist

- [ ] `src/<模块>/web/entry.ts` 默认导出 `defineModule({ name, version, routes, i18n?, lifecycle? })`
- [ ] `web.config.ts` 的 `modules` 里已登记（`enabled` 缺省即启用；module-root 下扫描已能捡到，登记用于排序/覆盖）
- [ ] 路由 `handle.layout` 选对了（有页面用 `"container"`；无页面模块 `routes: []`）
- [ ] 菜单标题用命名空间语法 `"<模块名>:menu.<key>"`，且 `locales/<lang>.json` 里有这个 key
- [ ] manifest 声明了 `roles[]` → 每个 `title_key` 用 `"<模块名>:role.<slug>"` 形状（ns 必须 = 模块名），
      且双语 locale 里都有对应嵌套 key `{"role":{…}}`——安装时解析成 `sys_role.title`，缺失则存裸 key（不失败）
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
| 通知铃 404 `no route matched`（`/api/notifications`） | 前端 `notification` 模块没加载 / 没注册 `notificationsApi`，回落到内置只读兜底；脚手架不再提供 root 级 `/api/notifications` | 保留 `src/app/web/notification/entry.ts` 的登记 + onInit 注册四方法；后端由 `src/app/api/notification` 出 `/api/notification/*` |
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
| `ojm build` 报「密封值解不开」/「本机没有能解开的私钥」 | 出包预检 fail-closed：合并产物兜底 + tracked 非 jwt 红线（manual §10.1） | jwt 坏了删 `config.local.yaml` 的 `auth.jwt_secret` 行重跑 `ojm dev`；非 jwt 取配对私钥或 local 覆盖该字段 |
| 页签怎么点都关不掉、无报错提示 | `beforeClose` 守卫 fail-safe 否决（守卫抛错按取消处理） | 先查控制台 `[tabs] beforeClose` 报错；确认弹窗逻辑与 `resolve(true/false)` 收口（manual §6.4） |
| 组织架构读面 403「该部门不在可见范围内」 | `scope` 默认 `self`，只看得到自己那条部门路径 | 换 `scope=all`（需权限点 `platform.org.read.all`），或改问自己所在部门（manual §14.2） |
| 组织架构读面 400「只展开自己所在部门」 | `includeSub` 用在了祖先/兄弟部门上（self 档只允许展开自己所在部门） | 收窄到「我所在部门」，或申请 `scope=all`（manual §14.2） |
| `oj build` 报 `#/_platform/...` 找不到模块 | 跨模块别名没在 `manifest.yaml` 的 `deps` 里声明 | 加 `_platform: ^0.1.0`（manual §14.2） |
| 同步一轮之后本地手建的部门消失了 | 适配器漏了 `origin` 条件（同步与回收都必须只动自己的行） | `markSeen` / `reconcileHidden` 带 `origin`；回收只在「本轮完整零跳过」时执行（manual §14.5） |
| 组织架构里有这个人，通讯录搜不到 | 他是同步建档（`activated=0`，从没登录过本站），通讯录只出活人 | 正确行为；让他登录一次，或走组织架构读面（manual §14.6） |
| 以为要外挂 nginx 才有 gzip/br 与长缓存 | `oj serve` 自 0.1.116 内建：br>gzip 协商 + 按文件名哈希判 `immutable`；0.1.118 起明文端口还有 h2c | 零配置即可；但**浏览器连不上 h2c**（只支持 prior knowledge、进程内无 TLS），要让浏览器走 h2 才需要前置 nginx/caddy TLS 终结。CDN 必须按 `Vary: Accept-Encoding` 分键（manual §7） |

## 手册

`manual.md`（同目录）共 14 章：1 工程结构（module-root 单树 / 两处产物根 / **§1.7 handler 四红线** /
**§1.8 `#` 别名与 TS 投影**——oj 运行时实测钉出，后端 handler 必读）/ 2 写前端模块 /
3 契约与代码生成 / 4 接管框架内置功能（provider）/ 5 布局与插槽 / 6 i18n 与样式 / 7 构建与发布 /
8 排查 / 9 参考 / 10 CLI 子命令参考（ojm 原生命令 vs oj 透传命令的差异区分）/
11 方案包打包与分发 / 12 签名与信任 / 13 方案菜单归组规则 /
14 组织架构与通讯录（共享读面 7 端点、`scope` 两级门禁、归属权与「转为本地维护」、
源适配器接点与三条禁令——选人 / 按部门算人 / 接 LDAP 都读它）。

另有 `wecom-daikaifa.md`（同目录）：企业微信**代开发**集成的凭据清单与三角色手册——凭据从哪取、
怎么填、按什么顺序开通、用户/开发/部署各自怎么做、错误文案怎么查。**接代开发时先读它**。

另有 `wecom-internal-app.md`（同目录）：企业微信**企业内部应用（自建应用）**的配置与使用手册——
五项 `wecom_corp_*` 从哪取、回调为什么只填「通讯录同步」一处、「验证并接入」的四步自检、
可见范围 / 可信 IP / 可信域名的处置、单企业私有化的边界（自建应用收不到成员变更事件）、
以及和代开发共存时的配置与页面差异。**接自建应用时先读它**。

另有 `publish-walkthrough.md`（同目录）：从「代码写完」到「装进站点」的一条命令链——
构建/打包 → 拿发布身份（凭证或离线）→ 签名 → 落 CDN → 重建索引 → verify/trial → install/TOFU，
每步带期望输出与通过判据。**第一次发包照着它敲**。
