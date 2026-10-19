# Changelog

本仓库为**双包 lockstep 发版**：`@oj-module/runtime`（浏览器面，含 `contract` 子路径）与 `@oj-module/cli`（Node 工具链面，含预构建宿主 `shell-dist`）**始终同版本号**一起发布。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。
设计依据、迁移记录与陷阱清单见 [`docs/prd/202609110947-oj-module-two-package-consolidation-design.md`](docs/prd/202609110947-oj-module-two-package-consolidation-design.md)。

## [Unreleased]

### Changed

- **`ojm init` 模板拷贝反转为白名单（`templates/init.include.yaml`）**：取代 0.2.5 引入的 `init.exclude.yaml` 排除清单。模板里大部分文件是「模板自运行/demo/产物」，不该进用户工程，排除清单越列越长；白名单只收录真正进脚手架的路径，未收录的一律不拷（也不计入 init 报告的 created/skipped）。拷贝结果与旧排除逻辑逐文件一致（206 → 204，差异仅两项修复，见下）。
  - 白名单条目存在性 fail-fast：收录了不存在的路径直接报错，避免拼错目录名在用户工程里留下难以追溯的缺文件。
  - `openapi.json` 裁剪反转为「只保留白名单内 api 模块的 `/api/<mod>/` 路径」，与脚手架实际模块严格一致。
  - 修复旧逻辑两处泄漏：模板本地产物 `api/node_modules/`（旧清单只排了根级 `node_modules`）与 `init.include.yaml` 自身不再进用户工程。
  - `web/src/{demo,home}/__client` 仍不拷（其 api 模块是 demo-only）：白名单对 demo/home 只列页面源码（entry/locales/pages），不列整棵模块目录。

## [0.2.5] - 2026-10-18

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.5**。

### Changed

- **证书/密钥路径收敛为单一入口**：`resolveCertDir()`（由 config 位置派生，`<project>/api/config/`）取代 `init.ts` 里 `certDir` / `keysDir` 两处各算各的；`ojm dev` 的补签逻辑从 config 的 `certificate_path` 反推同一目录。落点与文件名均未变。
  - 模板 `api/config.yaml` 顶部新增「证书与密钥唯一落点」注释块，逐把说明 `private.pem` / `public.pem` / `cert.jws` 三件套的作用与失效后果，以及 `secrets-*.pem` 与它们的区别。

- **`ojm dev` 缺开发证书时自动补签**：此前证书只在 `ojm init` 时签发，模板仓库本身作为可运行工程（无 init 环节）直接 `pnpm dev` 会因 oj 读不到 `public.pem` 而 fail-fast。现 dev 起后端前检查 `certificate_path`，缺失即现场签发。
  - 注：曾尝试把 config 迁到与 `api/`、`web/` 同级的 `config/` 目录，实测不可行并已回退——oj 的模块解析把「项目根」锚定在 **config 文件所在目录**，且相对 import 被钳制在该根内；config 一进 `config/` 子目录，`api/src` 就整体落到项目根之外，凡是带 `../` 相对 import 的 handler 在 `ojm dev` 下会被判 `escapes project root`（实测 26 个 api 文件只剩 8 个、18 条路由被跳过）。

- **模板（`packages/cli/templates`）兼作可运行 demo**：模板目录本身即一个完整工程（新增 `package.json`，纳入根 workspace，包名 `@oj-module/template-demo`），可直接 `pnpm --filter @oj-module/template-demo dev` 演示全部模块——不必再先 `ojm init` 出一个工程才能看到效果。

### Added

- **`ojm init` 排除清单（`templates/init.exclude.yaml`）**：模板里现在内置一批「仅供演示」的模块与「模板自运行专属」文件，`ojm init` 拷脚手架时按清单跳过，用户工程不再收到它们。
  - demo-only 模块：`api/src/demo`、`api/src/home`、`web/src/{about,access,exception,outside,route-nest}`（来自 `apps/playground-oj` 的演示模块，模板保留以便自演示），外加 `web/src/oj-market`（解决方案市场，第一方能力，仍在演进中，故新工程默认不带）。
  - 模板自运行专属：`package.json`、`node_modules`、`bin`、`pnpm-lock.yaml`。
  - 构建/运行期产物：`api/dist`、`web/dist`、`api/logs`、`api/config/*.pem`、`api/config/cert.jws`、`api/db.sqlite*`——尤其避免所有新建工程共享同一把模板私钥。
  - 派生规则：被排除的 api 模块，其前端 `__client` 生成物一并排除；`openapi.json` 里对应端点也会被裁掉（否则新工程一跑 `ojm api --check` 就是「有契约无 handler」）。
  - `web.config.ts` 中 demo 模块的条目以 `// #region demo-only` / `// #endregion` 标注，init 拷贝时整段剥离，脚手架不留指向缺失文件的死条目。
  - 清单随模板发布，缺失即报错（不静默退化为「全量拷贝」）。

### Fixed

- **市场页在模板默认配置下不再报错**：模板种子里 `framework.market_cdn_url` 为空，`GET /api/_platform/market/index` 按设计返 503「未配置市场地址」，而前端把它当故障弹了错误态 + 重试。现客户端把 index 的 503 归为空数组（PRD §5.3：卡片区显示「未配置市场地址」），其它状态码照旧上抛。
  - 同时不再叠 toast 与重试：ky 新增请求级 `silentError` 选项（调用方自行消化错误体时跳过全局错误 toast），index 以 `silentError + retry: 0` 发起——503 是配置态而非抖动，默认重试 3 次只会刷出 4 条同样的错误。
- **`pnpm-workspace.yaml` 改由 `ojm init` 生成**（构建审批 `allowBuilds.esbuild` + `@redocly/cli` 钉版 2.51.0），不再从模板拷贝：模板目录本身是根 workspace 成员，自带一份会让 pnpm 就近把它当 workspace 根，`cd packages/cli/templates && pnpm i` 找不到父级 catalog（`ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`）。工程里已有该文件时仍是合并语义（占位行填 true、显式 `false` 不动）。

## [0.2.4] - 2026-10-17

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.4**。本周期无代码变更，作为「解决方案全生命周期」阶段的发版基线（`../oj-market` 独立仓等下游将依赖已发布版本）。

### Docs

- **解决方案全生命周期实施设计 v3**：市场即样例（独立仓 `../oj-market`，第三方作者形态）、执行器换轨 oj 原生（`_platform` 进程内状态机 + `exec.run` shell 步骤）；五方专家评审 40 条发现 → 31 项处置全部闭环。
- **实施计划（P0–P3）**：BDD 任务表、SOLID/DRY 落点、AC-P1 验收清单（20 条）。
- **P0 spike 裁决记录**：共享根挂载形态、exec tar 三步范式、锁原子性（无互斥，安装器需读回收敛）、reload_api 全链路、M003/M004 拒启契约、长任务分段执行等六项实测闭环。
- 文档门禁：mermaid 图块校验脚本（`pnpm check:mermaid`）。

## [0.2.3] - 2026-10-16

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.3**（纯修复 + 文档，无破坏性变更）。

### Fixed

- **登录页不显示 LDAP/SSO 切换 tab**：模板登录页此前只渲染本地账号密码表单，从不调用后端匿名发现端点 `GET /system/login-methods`，故在系统设置开启 LDAP/SSO 后登录页毫无变化。
  - 运行时 `LoginInfo` 新增可选 `method` 字段，`fetchLogin` 按 `method` 路由到 `auth/login` 或 `auth/ldap-login`（两者载荷同形、均匿名）。
  - 模板登录页挂载时 `fetchLoginMethods()` 获取已启用方式；多于一种时渲染切换 tab：local/ldap 共用表单（仅 `method` 不同），sso 渲染跳转按钮（SSO 重定向端点由宿主/平台提供，模板仅负责跳转 `/auth/sso`）。
  - 发现端点失败时回落单表单（local），不阻断登录。

- **移除个人中心的「设置」菜单项**：`personal-center` 模块此前挂了一个未实现的设置占位页（`/personal-center/settings` 仅渲染 `Settings` 占位内容），现移除该菜单项、路由与页面，并清理对应的 `menu.settings` 及孤儿 i18n 键（`generalSettings` / `notificationSettings` / `accountSecurity`），保留「我的资料」。

- **操作日志写端（C3）+ runtime 契约**：新增 `POST /api/system/oplog`（登录态即可写入，供解决方案模块记录自身操作）；`access.ts` 导出 `currentAccess()` 作「登录态放行」判据；runtime `api/rbac` 新增 `fetchRbacOplogPost`（入参 `RbacOplogWrite`）。解决方案模块经 runtime 契约写日志，**不 import 框架 `#src/audit`**（模块边界红线）。

- **系统页顶部边距**：`settings` / `users` / `roles` / `oplog` 四个页面根容器加 `paddingTop: 16`，与上方 tab 拉开间距。

### Docs

- 模板 README 排障示例版本号更新为 `@oj-module/cli@0.2.3`。
- devkit 手册 §2.8 增补「场景：解决方案模块记录操作日志」，示范 `fetchRbacOplogPost` 用法与 `module` 隔离锚点。
- 新增设计稿 `docs/prd/20261016-solution-module-rbac-isolation-design.md`：每解决方案模块自服务角色/权限 CRUD + 跨模块隔离（服务端按 `callerModule` 收敛）+ runtime 对外 `createModuleRbac(module)` 契约。

## [0.2.2] - 2026-10-16

双包 lockstep：`@oj-module/runtime` 与 `@oj-module/cli` 同步升 **0.2.2**（纯修复 + 文档，无破坏性变更）。

### Fixed

- **脚手架 `pnpm dev` 因 system 模块缺 `__client` 构建失败**：`web/src/system/entry.ts` 引用 `./__client/api`，但该目录此前未随模板分发、且 `ojm dev/build` 启动时不自动生成。现把 system 模块的 `__client`（`api.ts` + `api.schemas.ts`，由模板自带 `openapi.json` 经 `ojm api` 生成）提交进模板，与 auth/notification 等一致，开箱即跑。
- **runtime 构建 TS 报错阻断 shell-dist 重建**：`layout-header` 插槽渲染 `Children.toArray(...).map(node => <Fragment key={node.key}/>)` 在 React 19 类型下 `node` 可为 `string` 无 `.key`（`TS2339`），导致 `runtime build` 失败、宿主外壳拿不到新产物。改为直接渲染 `Children.toArray(...)`（其已分配稳定 key）。

### Docs

- 模板 README 增补「排障 / 常见问题」：说明 `__client/` 为生成产物勿手改、报 `Could not resolve "./__client/api"` 时跑 `ojm api` 补齐；以及 `pnpm dlx @oj-module/cli@latest init` 可能因 dlx 缓存命中旧版 CLI 而生成偏旧脚手架（显式带版本号最稳）。

## [0.2.1] - 2026-10-16

> 基于 0.2.0 框架基线（含后端管理面 `/api/system/*`、`/api/auth/*`）。
> 注意：本仓 `package.json` 已在 0.2.0，但 0.2.0 未正式发版（npm 最高 0.1.21），
> 0.2.0 的变更记录待补，本次 0.2.1 在其之上追加。
>
> 双包 lockstep：`@oj-module/runtime` 同步升 **0.2.1**（无功能改动，纯版本对齐，满足
> 本仓「始终同版本号一起发布」通则）；`sync-host-versions.mjs` 的 prepack 门禁要求宿主
> 产物里的 runtime 版本 == `packages/runtime` 版本，故发版前须 `pnpm --filter @oj-module/cli build:shell`
> 重建 shell-dist（其 `versions.json` 记录 runtime 0.2.1）。

### Added

- **system 管理前端模板模块**：`packages/cli/templates/web/src/system/`（entry + 6 页 + 2 locales），
  以 cli 模板模块形式随 `ojm init` 分发，补齐 0.2.0 后端管理面缺的用户/角色/权限/操作日志/站点设置/登录方式 UI。
  - 用户管理（建号表单校验对齐后端、禁用 Switch、重置口令、本人行动作禁用）、成员资格（`superadmin` 才见入口，整集替换）、
    角色权限（只读双表，`title_key` 跨 namespace 不命中回退 `code`）、操作日志、站点设置（按 `item.module ∈ {framework,ldap,sso}` 过滤）、登录方式（只读）。
  - 权限三档分工：路由级 `config.requiredRoles`（B16，角色不符→404）＋ 页面级 `ForbiddenPanel`（API 403）+ 后端 `assertSystemAdmin` 硬 enforcement。`requiredRoles` 取 `["admin","superadmin"]`，对齐后端 `assertSystemAdmin` 口径。
  - 错误归一 `errors.ts` 兼容 `ContractApiError` 与 ky `HTTPError`；`ForbiddenPanel` 特判 `must_change` 渲染改密引导卡。
  - 13 个 system 端点补 `.schema`/`.response` 契约 + `auth/password` 补 `.schema`（业务逻辑零改动，仅挂契约属性）。
- **login 模块改密页** `/change-password`（fullscreen + `hideInMenu`），must_change 悬挂期唯一出口；
  走 runtime 全局 `fetchChangePassword`（auth 无 web 模块、无 client 宿主）。
- **init devDeps 钉入** `@tanstack/react-query` / `antd` / `i18next` / `@types/react`（模板页只取类型，运行时走宿主 importmap 单例）。
- **模板 `openapi.json` 快照刷到 oj 0.1.74**（旧快照 0.1.69 时代 operationId 带连字符 → 生成非法标识符 `systemLogin-methodsGet`）。

### Fixed

- **宿主链补 `user-info` 水合**（框架缺陷）：预构建宿主无 AuthGuard，user store 角色恒为空/演示值 → 模块角色过滤把管理员挡在 `/system` 外、`superadmin` 判断恒 false、侧栏用户名为空。`host.tsx` 新增 `hydrateUser()`，在 `loadAll()` 之前 await 拉真实角色（must_change 期仍 200），失败则清空、无 token 才播种 `DEMO_USER`。
- **宿主链 catch-all 兜底页**：非管理员直达角色受限路由（如 `/system/*`）时，React Router 无匹配落默认错误页；补 `{ path: "*", element: <PageError /> }` 渲染框架兜底页（后端 403 仍为硬兜底）。

### Dependencies

- oj 最低版本门禁 **0.1.73**（平级 `.response` 需 v0.1.72，`del`→`delete` 操作键归一需 v0.1.73）。

## [0.1.20] - 2026-10-15

### Added

- **`ojm api` 流水线迁移到 `openapi.json` 单一事实源**：`oj openapi`（oj ≥ v0.1.73）内省 handler 的 `.route`/`.schema`/`.response` 生成 `openapi.json`（OpenAPI 3.1，落于工程根），`ojm api` 消费它发射 `__client`（`api.ts` + `api.schemas.ts`）、stub、mock。契约口径由「前端 zod 反射」改为「后端 JSON Schema 白名单」，前后端单一来源对齐 oj 运行期校验。

### Removed

- **退役 `defineApi` DSL 与 `*.contract.ts` 翻译层**：`@oj-module/runtime/contract` 不再导出 `defineApi`/`API_DEF`/`ApiDefinitionInput`/`ApiForm*`；cli 侧 `evaluate`/`emit-meta`/`emit-schema`/`buildIr` 等 zod IR 模块删除。`packages/runtime/src/api/system/role/contract.ts` 死代码删除（保留签入 client）。

### Changed

- **handler 契约写法**：**入参**挂 `.schema = { params, query, body }`；**出参**挂与 `.schema` **平级**的 `.response`（oj v0.1.72+，= 旧 `data` 信封 payload；优先级：动词 `.response` > 组 `.response` > 动词 `.schema.response` > 组 `.schema.response`，旧 `.schema.response` 仍兼容）。union 用类型数组 `["string","number"]` 表达；nullable 用 `["string","null"]`。范本见 `packages/cli/templates/api/src/notification/api.ts`。
- **`del` 动词的操作键归一（oj v0.1.73）**：`oj openapi` 生成 `delete` 操作键（旧 oj 产出非法 `"del"`）；下游 `__client` 得 `deleteXxx()` 方法名。存量工程若手工改过 `openapi.json` 的 `"del"`→`"delete"`，升级 oj 后须删手工改动重生成，否则 `--check` 漂移。
- **迁移检查点（历史 `contract.ts` 升级）**：① 把每个 `defineApi` 端点改写为 handler `.route`+`.schema`（入参）+`.response`（出参）；② `oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json`；③ `ojm api` 重生成 `__client`；④ 删除旧 `contract.ts`、web 调用点改从 `./__client/api` 导入（函数名为 `camelCase(operationId)`，非旧人类命名）。完整指南见 docs 迁移文档。
- **playground-oj 对齐**：5 个 `contract.ts` 删除、handler 迁 `.schema`+`.response`、`openapi.json` 干净再生（去手工 `del`→`delete` 与 operationId 改名）、`__client` 重生成、web 消费点改原生 operationId 派生名；`global.d.ts` 同步 devkit 的 `Function.response` / `Object`（组级 `.route`/`.schema`/`.response`）声明；`UploadedFileMeta.key/url`、`NotificationItem.link: string|null` 类型桩修正（tsc 0 错误）。
- **清理旧契约产物遗留**：删除 playground-oj 5 个 per-module `routes.json` + `openapi.yaml`、旧 `apps/playground` `__client` 三件套（`contract.ts`/`routes.json`/`openapi.yaml`，后者 typecheck 随修复）；`ojm dev` 的 `contract.ts` 热更监听分支移除，改监听工程根 `openapi.json` 触发 `__client` 重生成（新流水线等价物）；`--check` 的 routes.js 对账注释订正（对比对象是 openapi.json 契约路由表，非 routes.json）。`api/docs/openapi.yaml` 为 `ojm api --docs` 现行产物，保留。

### Dependencies

- 双包 lockstep 升至 `0.1.20`（`@oj-module/runtime` + `@oj-module/cli`）；**`@plane/kit` / `@plane/editor` 同步锁步升至 `0.1.20`**（四包 lockstep 门禁要求；二者无代码改动，纯版本对齐，`shell-dist/versions.json` 与 `vendor/host-versions.json` 随重建同步）；oj 最低版本门禁 **0.1.73**（平级 `.response` 需 v0.1.72，`del`→`delete` 操作键归一需 v0.1.73）。

## [0.1.18] - 2026-10-14

### Added

- **标签页关闭前守卫 `beforeClose`**：`addTab` 可给页签挂 `beforeClose: () => boolean | Promise<boolean>`（数组注册、按函数引用去重、多模块叠加），五个关闭动作（单个/右/左/其他/全部）关闭前顺序 await 守卫，任一否决或抛错即整批取消（事务式）；守卫 await 期间页签保留、组件挂载，模块可安全弹「未保存」确认框。`resetTabs`（登出/401 下线）显式绕过守卫。批量关闭精确删除批准时刻的集合（TOCTOU 防护），同一 key 并发关闭去重。用法与 14 条 BDD 用例见 `docs/prd/202610142230-tabs-before-close-bdd.md`、`docs/devkit/manual.md`「页签与未保存守卫」。
- **`ojm api --check` 支持字符串字面量组键与模块根嵌套组 stub 去重**：连字符组名（`"push-broadcast"`）参与路由对账；handler 住在模块根单文件（DDD reshape 形态）时不再生成镜像 stub（`handler-scan.ts` 三方共用扫描器 + `implemented` 过滤）。

### Changed

- **BREAKING：`ojm api` 生成目录 `client` → `__client`**：发现阶段兼容旧 `client/`（deprecation 告警），生成一律写 `__client/`；存量模块请跟随改名（import 路径 `./client/api` → `./__client/api`）。
- **BREAKING：五个页签关闭动作返回类型 `Promise<void>`**：TS 调用兼容（fire-and-forget），但状态变更由同步变异步——依赖「调用后同步读到新 openTabs」的代码需改为 await。
- **oj 最低版本门禁 `MIN_OJ_VERSION` 0.1.50 → 0.1.69**：旧 vendored oj 会 fail-fast，`ojm vendor 0.1.69` 升级。存量工程注意 oj v0.1.58 起 `server.api_prefix/base` 已删除（改 `mounts:` 表达，见 oj devkit §3.1）。
- **init 模板 api 层 DDD reshape（oj v0.1.64 嵌套 handler 组）**：auth（login/logout/refresh 收模块根单文件，保留 `_shared/session.ts`）、notification（按人通知 + 广播两表 + `_shared/notify` 发射原语 + push/del + 403 归属校验，全量对齐 playground-oj）、system/playground 同步。组名 = 路径段，≤4 层，`route`/`schema` 保留键，`del` 保留动词键（不能作组名）。

### Dependencies

- 双包 lockstep 升至 `0.1.18`（`@oj-module/runtime` + `@oj-module/cli`）；oj 最低版本门禁 0.1.69（playground-oj vendored 同步）。

## [0.1.17] - 2026-10-14（补记）

### Added

- **通知面升级为按人真实通知 + 跨模块 push/del 原语**：`notifications` 表按人归属（user_id + link 深链 + category 类别），新增广播两表（`notifications_broadcast` / `_read`）；后端模块可 `import { pushNotice, pushBroadcastNotice, delNotice }` 直接发射，`markRead` 校验归属（非本人 403）。e2e 11 用例覆盖（`tests/e2e/notification.spec.ts`）。
- **`ojm --version` / `-V`**：显示 cli 包版本。

### Fixed

- **`ojm api --check` 支持 oj 嵌套 handler 组对账**（跨仓 VERB_OF 同步，oj v0.1.64）。
- **生成 client 的 `toApiError` 改读 ky `error.data`**（此前取错字段导致业务错误信息丢失）。

### Dependencies

- 双包 lockstep 升至 `0.1.17`（`@oj-module/runtime` + `@oj-module/cli`）；通知模板 client 与 host-versions 同步。

## [0.1.16] - 2026-10-13

### Added

- **`vditor` 入宿主共享依赖表——Markdown 编辑器与宿主单例共享**：npm 包是 webpack UMD 单产物（无 ESM 出口、仅 default 导出），shell 预构建按既有 CJS/UMD interop 链路（starShim / A22 显式转发）打成 `/assets/vditor.js`（gzip ≈110 KiB）自包含 ESM 资产；`vditor/dist/index.css` 按 `nprogress/nprogress.css` 同款样式垫片成 `/assets/vditor-index-css.js`。均为**软共享**（无单例语义），且惰性生效——importmap 只做映射，宿主自身不 import vditor，模块进编辑器页时才拉取，不进宿主首屏。模块侧写法不变：`import Vditor from "vditor"` + `import "vditor/dist/index.css"`，vditor 移入 `devDependencies` 对齐版本。注意：vditor 运行期按需拉的 lute / i18n / 图标 / 主题 CSS（默认第三方 CDN）**不随共享资产分发**，由模块自行处理；`vditor` 其余 dist 深路径仍走「前缀命中但无 importmap 键 → 构建期报错」规则。用法见 `docs/devkit/manual.md` §2.6「vditor（Markdown 编辑器，软共享）」；模块侧 external 断言见 `tests/cli/vditor-external.test.ts`。

### Dependencies

- 四包 lockstep 升至 `0.1.16`（发布脚本 `scripts/publish-packages.mjs` 的 lockstep 门禁要求同版；本版**实际改动仅在 `@oj-module/cli`**，runtime / kit / editor 无代码变更）；`@oj-module/core` 不在锁步组，维持 `0.1.13`。
- 新增共享依赖钉版：`vditor` 4.0.0（软共享，入 catalog 与 cli devDependencies）；共享矩阵 66 项 → 68 项。其余钉版不变，完整矩阵以 `pnpm exec ojm info` 为准。

## [0.1.15] - 2026-10-12

### Added

- **运行时导出 `useTabsStore`——模块可自设页签标题**：此前页签文案只能取路由 `handle.title`（静态 i18n key），无法跟随运行期数据（如当前文档名）。现在 `@oj-module/runtime` 导出 `useTabsStore`（`setTableTitle(routePath, title)` / `resetTableTitle(routePath)`），页面拿到数据后用 `useTabsStore(s => s.setTableTitle)` 覆盖已打开页签的文案；列表页 / `index` 路由复用同一路径展示不同内容时，离开须 `resetTableTitle` 复位。用法见 `docs/devkit/manual.md` §6.3；出口白名单测试已覆盖（`tests/runtime/runtime-exports.test.ts`）。

### Dependencies

- 四包 lockstep 升至 `0.1.15`（`@oj-module/runtime` / `@oj-module/cli` / `@plane/kit` / `@plane/editor`）；`@oj-module/core` 不在锁步组，维持 `0.1.13`。
- 宿主共享依赖钉版快照见 `packages/cli/shell-dist/versions.json`（66 项）；关键项：`react` 19.2.8 / `react-dom` 19.2.8 / `react-router` 7.18.2 / `@tanstack/react-query` 5.102.8 / `antd` 6.6.1 / `i18next` 26.4.0 / `react-i18next` 17.0.12 / `zustand` 5.0.15 / `dayjs` 1.11.23 / `echarts` 6.1.0 / `motion` 12.43.0。`oj` 最低版本门禁 `MIN_OJ_VERSION = 0.1.50` 不变。完整矩阵以 `pnpm exec ojm info` 为准。

## [0.1.11] - 2026-10-07

### Added

- **静态托管的 HTML 变换钩子（`htmlTransform`）—— 按路由注入 title/OpenGraph**：此前 `static-handler` 的 `serveHtml` 是「逐字节原样送出宿主 index.html」+ dev-only 的 reload 注入，所有 SPA 路由（含公开分享页）在服务端拿到同一份 HTML ⇒ IM（微信/Slack/飞书）链接预览与不执行 JS 的爬虫只能看到默认标题。现在 `web.config.ts` 可配 `htmlTransform: "./html-transform.ts"`（相对工程根路径或包名），`ojm dev` 与 `ojm preview` 在起 oj **之前**加载并校验它，模块 default 导出 `(path, html) => string | { html, cacheControl? } | Promise<…>`（`path` 为解码后请求路径）——`/`、`/index.html` 与 SPA history 回落的深链接统一经这一个注入点，顺序为 transform → reload 脚本（dev 工具链不受影响）；返回的 `cacheControl` 逐路由覆盖 `Cache-Control`。**未配置时状态码/响应头/响应体与历史逐字节一致**；变换抛错或返回非字符串只打日志并回退原文（单条路由的坏变换不得让站点 500）；非 HTML 资产完全不受影响。
- **契约 `form` 槽：multipart/form-data 上传**（`defineApi({ form: { fields, files } })`）——此前契约只会发 JSON 请求体，后端的 multipart 上传端点只能绕过生成 client 手写请求。现在：`form.fields` 用 zod 描述**文本部件**（字段名即表单部件名，进 OpenAPI 的 `multipart/form-data` JSON Schema），`form.files` 只声明 `name` / `required` / `multiple`（二进制刻意不进 schema）；生成 client 的调用形态 = `{ fields: {...}, files: { avatar: File|Blob, gallery?: File[] } }`，内部组装 `FormData` 并以 `body` 发送（`content-type` 交运行时按 boundary 自动补）。`form` 与 `body` 互斥、定义期即拒；`--check`、routes.json、stub 全链路跟随。无 `form` 的契约产物逐字节不变。

- **`ojm api` 生成 client 工厂化（create<Module>Client(ctx)，构造即 install）**：生成物 `web/src/<模块>/client/api.ts` 新增 `API_PREFIX` 常量（契约前缀唯一真源，与契约 `defineApi` 的 `apiPrefix` 天然一致）与 `create<Module>Client(ctx)` 工厂——模块 entry 的 `onInit` 里一行 `const client = createNotificationClient(ctx)` 即完成 apiPrefix 登记 + scoped request 绑定，不再手写 `ctx.register.apiPrefix(...)` + `bindRequest(...)` 两行样板，杜绝「登记了前缀没绑 request」的半接线状态。重复构造幂等安全；一模块一 client。模板、playground/playground-oj、根仓 `web/home` 已全部迁移；新人上手见 [`docs/202609130035-provider-guide.md`](docs/202609130035-provider-guide.md)。设计见 [`docs/prd/202609130128-client-factory-design.md`](docs/prd/202609130128-client-factory-design.md)。

### Deprecated

- 生成 client 的 `bindRequest(ctx.utils.request)` 标记 `@deprecated`（保留作逃生口）——请改用 `create<Module>Client(ctx)`。**属生成物形状破坏性变更**：外部工程升级 cli 后重跑 `ojm api` 需同步改 entry（当前无外部工程，影响面为本仓库，已完成迁移）。

### Added

- **`ojm dev` 增加 Vite 风格交互快捷键（仅 TTY）**：`r` 强制重建并热更新、`h` 显示帮助、`c` 清屏、`o` 浏览器打开、`q` 退出（后端 oj 一并终止）；`usage` 帮助文本补充快捷键映射。

### Fixed

- **`ojm dev` 以最新 oj 0.1.50 为唯一基线对齐**：`oj` 启动子命令 `server` → `serve`；版本门禁 `MIN_OJ_VERSION=0.1.50`；`build` 加 `--no-minify` 绕开 oj swc 把 `await X[0]` 重排、三元变 `&&` 的 bug；`ojm api` 新增后端入参 `.schema` 发射（oj 在 JS 前校验）；`init` 把 `jwt_secret` 密封为 `ENC[...]` + `secrets:` 段；`oj-cmd.ts` 透传 `test/exec/openapi/migrate/schema` 并自动补 `-c`；dev-proxy 502 信封对齐 oj 的 `{code,msg,data}`；contract `--check` 升级为四重对账（新增 WS 路由鉴权）。模板与 playground-oj 升 0.1.50。
- **`ojm dev` 终止时后端 oj 随之消亡**：抽出 `shutdownDev`，注册 `SIGINT`/`SIGTERM` 优雅停机并加进程退出兜底同步强杀 oj，杜绝 oj 孤儿占端口；`oj` 日志透传移除冗余 `[oj]` 前缀叠加（oj 自身 tracing 已含 `[oj]`）；`usage` 过长说明改为多行展示、并修正 `--check` 文案为四重对账。

### Removed

- **全面移除 `ram` 命令别名**：删除 `bin/ram.mjs` 与 `package.json#bin` 的 `ram` 入口、`usage` 别名说明；存量工程 scripts 需把 `ram` 改为 `ojm`。文件层兼容（`.ram-api-exempt.json` / `ram-api:stub` 指纹头 / `Symbol.for("ram.api.def")` / `RAM_DEBUG`）仍保留，存量工程生成物无需手改。

## [0.1.8] - 2026-09-12

### Changed

- **模块工程布局硬切换 `modules/` → `web/`**：模块工程（`ojm init` 模板、playground）源码目录改为 `web/src` + `web/dist` 配对，配置文件 `modules.config.ts` 更名 `web.config.ts`；`layout.ts` 删除 legacy 分支，存量 `modules/` 工程会得到人话迁移报错。产物协议不变（`modules.json`、`dist/modules/<name>/<version>/` 照旧）。框架根仓平铺 `web/<name>/` 形态由 layout `flat` 分支支撑。设计见 [`docs/prd/202609112324-web-layout-and-codegen-guide-design.md`](docs/prd/202609112324-web-layout-and-codegen-guide-design.md)。
- **`ojm api` 生成目录 `api/` → `client/`**：生成物由 `web/src/<模块>/api/{client.ts,client.schemas.ts}` 调整为 `web/src/<模块>/client/{api.ts,api.schemas.ts}`，与后端顶层 `api/` 消歧；纯前端契约位置同步为 `web/src/<模块>/client/contract.ts`；runtime 内部 role client 同规迁移。契约发现、`--check` 对账与报错文案全部跟随。

### Added

- `api/.ojm-api-exempt.json` 新增 `_comment` 自说明字段（作用、`modules`/`paths` 配法、一层通配语义）。注意：豁免清单为严格 JSON，写 `//` 注释会解析失败并**静默回退空豁免**——说明文字一律走 `_comment`。
- 新增新人指南 [`docs/prd/ojm-api-codegen-guide.md`](docs/prd/ojm-api-codegen-guide.md)：契约 → evaluate → IR → 四产物 → stub → `--check` 三重对账 → 豁免清单全链路机制与排错速查。

## [0.1.7] - 2026-09-11

### Added

- `ojm init` 模板新增 **personal-center 模块**（前端 my-profile/settings 页 + 后端 `POST /api/personal-center/upload` 头像上传）——runtime 用户菜单固定导航 `/personal-center/my-profile`，此前脚手架工程点击必落空。配套：`users` 表新增 `avatar_base64` 列（`_platform` 迁移 0002）、`user-info` 改为 db 回读头像、模板 `env.d.ts` 补 `window.$message` 全局类型。设计见 [`docs/prd/202609112006-init-template-personal-center-design.md`](docs/prd/202609112006-init-template-personal-center-design.md)。
- 宿主版本矩阵（`versions.json`）收录 tooling 项 `typescript` / `@types/react`——`ojm init` 生成的 devDependencies 全部钉版，不再有 `*` 回退告警。

### Fixed

- **宿主链暗黑模式 footer 露白**：shell 宿主（`host.tsx`）误用 antd 原生 `App`，从未写入 `--oo-*` 主题变量（tailwind 语义色工具类的唯一来源）——亮色下透明≈白不可见，暗黑模式暴露。宿主改用 runtime 导出的 `AntdApp`（变量同步 + `window.$message/$modal/$notification` 静态函数一并补齐）。设计见 [`docs/prd/202609112121-shell-dark-css-vars-design.md`](docs/prd/202609112121-shell-dark-css-vars-design.md)。
- `ojm init` 生成 devDeps 缺 `@ant-design/pro-components`（personal-center 的 ProForm 类型来源），已补钉版。
- `apps/playground-oj`：`personal-center/upload` 回写不存在的 `users.avatar_base64` 列（上传必 500），补迁移与 `user-info` 回读。

### Changed

- `ojm vendor` / `ojm init`：oj 二进制下载源从 GitHub releases 切换为 **npm 包 `@oj-bin/oj`**（临时目录 `npm i` 后拷贝 `bin/` 进工程，零污染用户工程）。平台选择、完整性校验（npm dist.integrity）、registry 镜像均由 npm 承担；`GITHUB_TOKEN` 与代理指引随之退役。设计见 [`docs/prd/202609111926-vendor-npm-install-design.md`](docs/prd/202609111926-vendor-npm-install-design.md)。

## [0.1.6] - 2026-09-11

### Added

- `@oj-module/cli`：`exports` 的 Node-only 子路径（`.`、`./build`、`./shared-deps`、`./esm-exports`、`./config`、`./manifest`、`./info`）新增 `browser` 条件，指向 `src/browser-guard.ts`——浏览器打包误引用时**显式报错**，不再静默拖入 Node 依赖；`./shell-dist/*` 是浏览器资产，不受此条件影响。

### Changed

- `@oj-module/runtime`：发布包的 `imports` 收窄为仅 `#src/*`（原 `#modules/*` 已无引用、`#manifest.json` 指向包外 `../../manifest.json`）。仓库 App 链对 `#manifest.json` 的解析改由本仓 `vite.config.ts` 提供——该需求属于仓库自身，不进入对外发布的包。

### Fixed

- `ojm api --check`：被删除的 stub 不再被静默放过（`create` 视为生成物过期，与 client/routes/openapi 口径一致）。
- `ojm api --check`：CRLF 检出（Windows `core.autocrlf=true`）不再把未改动的 stub 误报为「待更新」（指纹哈希本就按 LF 归一，字节比较同步归一）。
- `ojm api --check`：oj 路由表的短方法名 `del` 归一为 `DELETE`，uni-dev 工程里的 DELETE 端点不再误报 `routes-js-drift`。

### Internal

- 新增 `release-manifest.test.ts`：真跑 `pnpm pack` 守卫两包**发布态**——无 `workspace:`/`catalog:` 协议字面量、0 个 sourcemap、cli 对 runtime 精确且 lockstep 依赖、runtime 包内无 `.ts` 源（US-7）。版本断言改读源 `package.json`，发版不再需要改测试。
- 新增旧 scope 零残留测试与 runtime `imports` 边界断言。

## [0.1.5] - 2026-09-11

**`@oj-module` scope 首个版本**（由 `@react-antd-module` 全线迁移而来）。

### Added

- 命令 `ojm`（原 `ram` 保留为**弃用别名**：向 stderr 打印更名警告后转发，下个 major 移除）。
- 旧名兼容读取，存量工程升级无需手改：`api/.ram-api-exempt.json`（双名读）、stub 指纹头 `// ram-api:stub`（双前缀读）、端点品牌 `Symbol.for("ram.api.def")`（IR 双符号）、环境变量 `RAM_DEBUG`（`OJM_DEBUG` 优先）。

### Changed

- **架构：4 包并为 2 包，按运行环境切分**
  - `contract` 并入 `@oj-module/runtime`，作为 `./contract` 与 `./contract/errors` 子路径（编成 `dist`）。
  - 预构建宿主并入 `@oj-module/cli`（源码 `packages/cli/shell/`，产物 `packages/cli/shell-dist/`，随 cli 发布）。
  - 依赖方向只剩 `cli → runtime` 一条边；`cli` 对 `runtime` 写 `workspace:*`，发布时由 pnpm 改写为**精确版本**。
- **品牌与命名**：`@react-antd-module/*` → `@oj-module/*`；内部前缀 `ram-*` → `ojm-*`（日志 `[ojm]`/`[ojm-api]`、临时文件/DOM 标记、dev SSE 端点 `/__ojm_reload`、自动生成的子路径资产名等）。
- 两包对齐为同一版本号（lockstep）。

### Deprecated

- 旧 scope 的四个包（`@react-antd-module/{contract,runtime,cli,shell}`）**所有版本已在 npm deprecated**，安装时会打印迁移指引。

## 历史（迁移前的四包时代）

`@react-antd-module/{contract,runtime,cli,shell}` 的 0.1.x 系列为迁移前的四包形态（`contract` 0.1.3 / `runtime` 0.1.4 / `shell` 0.1.4 / `cli` 0.1.5），对应提交与开发方式见 [`docs/prd/framework-development-guide.md`](docs/prd/framework-development-guide.md)。自 `@oj-module` 首发起沿用 `0.1.5` 版本号，并进入双包 lockstep。

[0.1.8]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.8
[0.1.7]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.7
[0.1.6]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.6
[0.1.5]: https://www.npmjs.com/package/@oj-module/cli/v/0.1.5
