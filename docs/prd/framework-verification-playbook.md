# 框架端到端验证手册（可重复演练）

> **用途**：框架升级（`contract`/`runtime`/`shell`/`cli` 发新版，或 oj 升级）后，**从零**跑通「脚手架 → 依赖 → 契约 → 后端 → 前端 → 构建 → 运行」，一次确认整条链路没有回归。
> **配套**：[`framework-development-guide.md`](./framework-development-guide.md)（原理）、[`oj-fullstack-tutorial.md`](./oj-fullstack-tutorial.md)（跟做）。
> **原则**：每一步都有**可判定通过/失败的检查点**，不要只看命令退出码，要核对产物。

### 最近一次基线（2026-10-21，oj 0.1.84 / cli+runtime 0.2.12 工作区态；市场链路首演）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-21 |
| 框架包版本 | `cli`/`runtime` `0.2.12`（工作区态，源码 bin 直跑） |
| oj | `0.1.84`（`ojm vendor` 装进演练宿主） |
| 验证动机 | 新增「开发方案模块 → 发布到本地 CDN → 市场安装 → TOFU → 装成」三段（§7.1–§7.3），并修掉演练暴露的宿主侧缺口 |
| 结果 | **两轮全绿**：① `ojm init` 新工程自带 `cdn/` + `/cdn` 挂载 + `platform.modules` + `fs:` 段（零手工补丁）→ `ojm build`（api/dist + web/dist + `api/dist/versions.json`）→ 方案工程 `oj build` + `ojm build --bundle`（同输入两次同 sha256）→ `keygen`/`sign --check` → `market publish --real --rebuild-index` → `market verify`（5 项全 ✓）→ `market setup`（首登改密闭环）→ `market/index` 出卡片 → 安装 `needs_trust`（指纹与发布方一致）→ `trust confirm` → 重试 `status=done`（11 段全 ok）→ `/api/demo-solution/ping` 返回 `{pong:true}` → 安装锁含 `demo-solution: 0.1.0`。② 换全新 `host2` 零手工补丁复跑同样 done（唯一人工步骤 = `platform.root` 由 `src` 改 `dist`，见 §7.3 前置） |
| 本次发现并处置 | ① **`ojm build` 不写 `api/dist/versions.json`** → 新工程装方案在 preflight 报 `C2-09`；**已修** `build.ts` + `src/__tests__/build-backend.test.ts`。② **模板 `platform:` 缺 `modules`/`root`** → 卡 `reloading`（`NotCapable: module '_platform' is not platform-privileged`）；**已修**模板并在 `preview-config` 派生时把 `root` 改写为 `api/dist`。③ **模板缺 `fs:` 段** → 安装器落盘被 jail 拒，且失败在任务文件写入前（POST 200 但 task 恒 404）；**已修**模板。④ **`oj build` 只收 `.ts` handler**：`.js` 不进 dist、`routes.js` 生成空表。⑤ **`manifest.tables` 必须与 `schema.yaml` 对齐**（`S005`）；缺 `schema.yaml` 直接失败。⑥ **引用 i18n key 必须有 locales 双语且嵌套**：平铺 dotted key 查不到。⑦ **dev 形态装不上**：`--api-path src` 时装到 dist 的模块不被发现（smoke 404）。⑧ **`ojm preview` 不能完成安装**：派生 config 与安装器热更目标（`api/config.yaml`）不同文件 → `reloadConfig` 恒 `unchanged`。 |
| 与上一基线差异 | 上一基线只覆盖「宿主工程内开发模块」（§4–§5）；本轮新增可分发方案的开发/发布/安装三段（§7.1–§7.3），并把 7 项宿主侧缺口（①–③ 已修代码，④–⑧ 入坑表）纳入手册 |

### 上一次基线（2026-10-20 第二次复跑，oj 0.1.82 / cli+runtime 0.2.10 打包态；devkit 文档树合并 + 0.2.10 发布前演练）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-20（当日第二次，补上首轮未跑的打包态 e2e 全链路） |
| 框架包版本 | `cli`/`runtime` `0.2.10`（**打包态**：§0.5 双包 pack → 解包直跑 `cli-pkg/bin/ojm.mjs`；双包均未发版，安装须 file: tgz + pnpm overrides，见发现 ③） |
| oj | `0.1.82`（npm `@oj-bin/oj` latest，init 自动下载、探针无告警，无需旁路 1） |
| 验证动机 | ① devkit 文档树合并（`docs/devkit/` 唯一入口 + `oj-api-dev/` 快照迁入为 devkit 子目录、`docs/` 下旧顶层 `oj-api-dev/` 目录删除）后验证 init 分发不受影响；② 0.2.10 发布前按 §0.5 打包形态跑 §1–§7 全链路 |
| 结果 | **全链路通过（§0.5–§7）**：§0.5 双包 pack（cli 5.6MB / runtime 331KB）+ cli-pkg 解装（`ojm --version` 0.2.10，devkit 恰 5 文件、子目录跳过）→ `ojm init` 全检查点（目录树齐全、`.gitignore` 在包内且 `templates/.gitignore` 不在、openapi 新约定全中、devDeps 全家 + `typescript@~6.0.3`、`__client` 预生成、无 `contract.ts`/`routes.json`/`openapi.yaml`）→ 依赖安装（file: tgz + overrides + `--offline` 2s）→ oj 探针通过（无构建机路径泄漏、JsRuntime 冒烟 OK）→ books 模块（后端 manifest/schema/migration/seed + list/create 两 handler，全构造器 + `.schema`/平级 `.response`；前端 entry/pages/双 locale）→ `oj openapi` + `ojm api` + `--check` 0 error / 0 warn（`BooksListGetData` 解析为 `z.array(z.object({id,title,author}))`，非 `unknown`）→ `ojm build`（后端 8 模块 + 前端 8 模块含 books@0.1.0，见发现 ④）→ `tsc` **0 error** → `ojm dev`：`seed ok module="books"`、`routes: 52 method-row(s), 25 api file(s)`、`input contracts: 37`、登录 code:0、过滤命中、新增 `data.id`、缺字段 400（`.schema` 拒收）、无 token 401、通知兜底数组、5174 根 200 + importmap runtime + books/login entry.js 200 → `ojm preview`（**单服务 9778**，release/js）：migrate 门禁过、API 链复跑全对、**带 dist 三腿 `--check` 0/0** |
| 本次发现并处置 | ① **devkit 上游引用 1 条**：npm 0.1.82 二进制的 `api-manual.md:226` 引用 `docs/migration.md`（上游 oj 仓内部路径）——0.1.80 同样存在（grep -c 1），上游长期缺口非本轮回归；ojm 侧 5 文件零命中。② **npm 0.1.82 devkit 只有 9 文件**（缺 `oj-test-guide.md`；本机 `~/.local/share/oj` 本地构建 10 文件领先 npm 发布）——init 对缺失文件优雅跳过，行为正确；文档版本对照：0.1.80=8 文件、0.1.82 npm=9、0.1.82 本地=10。③ **打包态双包依赖死结**：pack 时 cli tarball 内 manifest 被改写为 `@oj-module/runtime@0.2.10` 精确版而 npm latest 停 0.2.8——解包后须 sed cli-pkg 依赖为 `file:<runtime tgz>`；工程安装时因 cli 也来自 tarball，还须在工程 `package.json` 加 `pnpm.overrides` 把整棵树的 `@oj-module/runtime` 统一改写到本地 tgz（单点 add 不够）。④ **`web.config.ts` 是显式模块清单**：books 前端目录建好后必须在 `allModules` 加一行 `{ name: "books", entry: ... }` 才进 modules.json（首轮构建 books 缺席即此因，登记后正常）——已补进 §5 步骤。⑤ 首次带 dist `--check`（preview 刚启动即跑）报一次性 `MODULE_NOT_FOUND`，未复现（随后连跑两次 0 error / 0 warn）；疑与 preview 进程瞬时状态相关，记录备查 |
| 与上一基线差异 | 上一基线（同日首轮）因模板契约面无改动未跑打包态 e2e；本轮补全 §0.5–§7 且发现 ③④ 两条打包态/清单类新知；devkit 分发行为与合并前逐字节一致（init 分发 5 文件） |

### 上一次基线（2026-10-20 首次复跑，oj 0.1.82；范围=0.1.81/0.1.82 构造器迁移收尾 + L1 通道建立）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-20 |
| 框架包版本 | `cli`/`runtime` `0.2.9`（工作区态；本轮改动随 **0.2.10** 发出，见 CHANGELOG） |
| oj | `0.1.82`（`listTables(prefix?)` / `truncate()` / `count(distinct)` 随本轮迁移用上） |
| 验证动机 | 把 0.1.81 迁移收尾到 0.1.82（`uninstall` IN→`startswith`、`rate` 改 `truncate`、`solution-perms` 最后一处裸 SQL、`query`/`oplog` 工厂化分页），并建立模板 **L1（`oj test`）回归通道**——构造器是 oj 二进制内纯 Rust 实现，vitest 夹具原理上够不着真 `table()`，真执行面必须走 L1（边界论证见 §9.1） |
| 结果 | ① 模板 api `tsc --noEmit` **0 error**；② 模板 L1（`oj test -c config.yaml -d src -t tests`，5 用例：login-methods 匿名 / todos 无 keyword·keyword=契约·keyword=% / notification join+UNION+lit）**5/5 passed，连跑三次幂等**；③ `tests/cli/init.test.ts` **14/14**（两份 0.1.82 新指南随 init 分发，旧 devkit 缺文件时容忍）；④ 模板 L2 vitest 基线 **190 failed \| 409 passed (599)，19/33 文件**——单一根因族（夹具无 builder 面，86 直接 TypeError + 104 级联），本轮按 §9.1 政策记录不硬修；⑤ 6 处 stale `MARKET_HISTORY_DDL` 全清（market_history 真源=平台迁移 0012）；⑥ vendored devkit 与上游 0.1.82 全量对齐（`docs/devkit/oj-api-dev/` 10 文件） |
| 本次发现并处置 | ① **`oplog.ts` whereIf `""` 归一化真 bug**：可选过滤缺失值被归一成 `""`，而 whereIf 的跳过集是 `undefined/null/false/[]`——`""` 是合法值会照发 `action = ''` 把结果过滤空（与旧 `if (filter.x)` 语义相悖）；修为归一化 `undefined`（api-manual §whereIf 契约）。② **L1 登录 401 排查**（本地 dev 库口令被首登改密流程改成 `12345678` → seed 重放 `INSERT OR IGNORE` 不复位 → admin/123456 恒 401）：处置不是改 seed，而是按框架正道加 **fixtures 专用账号**（`src/_platform/fixtures/l1-test-user.sql`，`l1tester`/`l1test1234`，additive `INSERT OR IGNORE` + superadmin 绑定，仅 `oj test` 灌入）——seed 的 admin 是 `must_change=1` 生产语义（判权端点恒 403）且口令必然随用户首登漂移，L1 不能绑它。③ L1 三处契约坑（client path 相对 base 多写 `/api` 即 404；L1 `expect` 无 `toHaveLength`；`oj test` 每轮重放 迁移→seed→fixtures，断言须按唯一键收敛到自己行）——全部记入 §9.1。④ `docs/devkit/sql-builder-missing-capabilities-pr.md` 闭环：7 项诉求全闭（6 项随 0.1.81/0.1.82 落地 + 1 项 sqlite 组合限制 sanctioned 绕行），并订正原文档一处误判（`like` 的 escape 逃生舱本就存在，上游复核同判「1 条误报」） |
| 与 0.2.9 基线差异 | 0.2.9 记录的是 0.1.81 改造的端到端回归（打包态 §1–§7）；本轮模板 api.ts 契约面无改动，未重跑全套打包态 e2e，改以「tsc + L1 + L2 基线 + init 单测」四件套验证迁移收尾；L2 的 190 红是 L1/L2 边界结构性欠账（非本轮新增回归），政策见 §9.1 |

### 上一次基线（2026-10-19 复跑，oj 0.1.80 / cli+runtime 0.2.8 打包态）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-19 |
| 框架包版本 | `cli`/`runtime` `0.2.8`（**打包态**：`pnpm --dir packages/cli pack` 后解包直跑 `cli-pkg/bin/ojm.mjs`，与发版逐字节一致；双包均未发版，`pnpm install` 须 `pnpm add <runtime 本地 tgz>` 入 devDependencies，见本基线发现 ②） |
| oj | `0.1.80`（`@oj-bin/oj` latest ≥ 门禁 0.1.73，init 自动下载、探针无告警） |
| 验证动机 | 上阶段 `db.query`→`db.table()` SQL builder 迁移后，端到端复跑捕捉回归；并验证 §0.5 发布形态（pack 而非源码树） |
| 结果 | **全链路通过（§1–§7）**：`ojm init`（**236 项新增**）→ `pnpm install`（`@oj-module/runtime` 经 `pnpm add <本地 tgz>` 入 devDependencies，`--offline` 秒级）→ JsRuntime 探针通过 → books 模块（后端 6 文件 + 前端 4 文件，`.schema` 入参 + 平级 `.response`）→ `oj openapi` + `ojm api`（`--check` 0 error / 0 warn）→ `ojm build`（后端 8 模块 books 2 api file(s)、前端 8 模块含 books@0.1.0，modules.json 含 home/login/books 且 books entry 带 integrity）→ `tsc` **0 error** → `ojm dev`：seed ok（_platform/books/notification）、`routes: 52 method-row(s)`、`input contracts: 37`（`.schema` 入参校验激活）、登录返回 token、关键字过滤命中、新增 `{ok:true}`、全量 5 条、无 token 401、通知兜底返 4 条数组；5174 根 200、importmap 含 `@oj-module/runtime`、books/login/home entry.js 200、`/login`（Accept: text/html）200 → `ojm preview`（单服务 release 形态，端口 9778）：migrate 门禁过、路由来自 `api/dist`、9778 根 200、API 链复跑全对、**带 dist 三腿 `--check` 0/0** |
| 本次发现并处置 | ① **登录 500 `unknown table 'sys_rate_window'`**：上阶段 `rate.ts` 由 `db.query` 迁 `db.table()`，但 `sys_rate_window`/`sys_login_throttle` 仅 V9 迁移创建、从未在 `schema.yaml`/`manifest.yaml` 登记，oj 表元数据校验拒绝；**修复**：模板 `_platform/{schema,manifest}.yaml` 双向登记两表（提交 `aa9a3f63`），重打包后 fresh init + build + preview 登录通过。② **§0 旁路 2 的 symlink 会让 typecheck 炸 41 个 TS7006**：裸 runtime tarball 无 `node_modules`，`export { z } from "zod"` 解析成 `any`，生成物 `__client/api.ts` 的 `.map(i => …)` 全变隐式 any；须改用 §0.5 `pnpm add <runtime 本地 tgz>` 把 runtime 装进 devDependencies（zod 随之可解析）。③ oj 0.1.80 起 `oj serve` 对 `/api/health` 打 deprecated WARN（建议 `/api/_system/health`）——oj 上游信息项，本仓无需动作。④ `ojm preview` 端口已为 **9778**（单服务：API + 静态 SPA 同进程），旧基线记的 4173 已过时。⑤ **2026-10-20 复跑：v0.1.81 构造器扩展改造的回归**——把模板 `todos/uninstall/contacts/session/notify` 的手写 SQL 改写为 v0.1.81 构造器（`contains`/`whereIf`/`count` 聚合/`union`/`join`/`lit`/`as`/`select("*")`/`orIgnore`）后，端到端复跑发现 `notify.markAllRead` 的 `fromSelect`+`orIgnore` 在 sqlite 上 500（`orIgnore with fromSelect is not supported on sqlite`）——**已回退为裸 `INSERT OR IGNORE ... SELECT`**（三方言通用，提交 `e1b81e74`）；其余 `contains`+`or`/`union`+`join`/`orIgnore(VALUES)`/`select("*")`/`whereIf`/`count`/`orderBy` 全部运行时验证通过（含临时探针验证 `whereIf` 双分支、idempotency 复跑）。注意 `ojm init` 当时从 npm 拉到 oj 0.1.80（0.1.81 尚未上 latest），按 §0 旁路 1 换入本地 0.1.81 验证；回退后的 `markAllRead` 在 0.1.80 上同样安全。另：`pnpm add` runtime 须 `-D`，否则 C4/D12 硬共享依赖门禁失败（见 §0.5） |
| 与 0.2.5 基线差异 | 0.2.5 基线当时 `tsc` 0 error 系未触发本回归（`db.table` 迁移尚未引入）；本次 0.2.8 捕捉并修复 `sys_*` 表声明缺失；init 新增项 216 → 236；preview 由 4173 双服务变为 9778 单服务 |

### 上一次基线（2026-10-19 复跑，oj 0.1.80 / cli+runtime 0.2.5 工作区态）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-19 |
| 框架包版本 | `cli`/`runtime` `0.2.5`（**工作区态，均未发版**——npm latest 仍停在 0.2.2；双包 lockstep 不变） |
| oj | `0.1.80`（npm `@oj-bin/oj` latest，**首次无需 §0 旁路 1**：latest 已 ≥ 门禁 0.1.73，`ojm init` 自动下载且安装后探针无告警） |
| 验证动机 | `ojm init` 模板拷贝由**排除清单反转为白名单**（`templates/init.include.yaml`，见 CHANGELOG Unreleased）后的首次全链路演练 |
| 结果 | **全链路通过（§1–§7）**：`ojm init`（**216 项新增**，白名单下 demo-only 模块与模板自运行产物零泄漏）→ `pnpm install`（§0 旁路 2「双包均未发版」形态 + `--offline`，1.6s）→ JsRuntime 探针通过 → books 模块（后端 6 文件 + 前端 4 文件，handler `.schema` 入参 + 平级 `.response`）→ `oj openapi`（books 2 端点）+ `ojm api`（契约 8 份、写入 2 文件）+ `--check` 0 error / 0 warn → `ojm build`（后端 8 模块，books 2 api file(s)、notifications 1、system 10；前端 7 模块，modules.json 含 home/demo/login/personal-center/notification/system/books，books entry 带 integrity）→ `tsc` 0 error → `ojm dev`：seed ok（_platform/books/notification）、52 路由方法、24 个入参校验激活、登录返回 token、关键字过滤命中 1 条、新增 `{ok:true}`、全量 4 条、无 token 401、通知兜底返 4 条数组；5174 根 200、importmap 含 `@oj-module/runtime`、books/login/home entry.js 200、`/login`（Accept: text/html）200 → `ojm preview`（release 形态）：migrate 门禁过、路由来自 `api/dist`、4173 根 200、API 链复跑全对、**带 dist 三腿 `--check` 0/0** |
| 白名单专项核对 | 脚手架实际落盘 204 个模板文件，与 `init.include.yaml` 遍历模拟集合**逐文件一致（无缺无多）**；`web/src/{demo,home}` 页面源码在册而 `__client` 不拷（其 api 模块是 demo-only）；`api/node_modules` 与 `init.include.yaml` 自身零泄漏——旧排除逻辑的这两处漏洞随之修复 |
| 本次发现并处置 | ① `pnpm install` 直连 registry 被限速（实测 ~18KB/s）卡死在解析段 20min——**环境问题非框架缺陷**，处置与旁路补进 §0/§9；② books `entry.ts` 的 `onInit` 漏 `async` 被 tsc 拦（TS2322：void 不匹配 Promise<void>）——devkit SKILL「注册时机」红线补明 async 签名（模板 `web/src/notification/entry.ts` 早有此形，文档没写明）；③ oj 0.1.80 起 `oj serve` 对 `/api/health` 打 deprecated WARN（建议 `/api/_system/health`）——oj 上游信息项，本仓无需动作，记录备查 |
| 与 0.2.1 基线差异 | init 新增项 76 → 216（模板扩容：system 模块、notification/notifications 拆分、`api/tests` 全量、lifecycle 全套）；排除清单 → 白名单（拷贝结果逐文件等价，另修两处泄漏）；oj 下载通道不再滞后于门禁 |

### 历史基线（2026-10-16 复跑，oj 0.1.74 / cli+runtime 0.2.1 提交态 `34ac3d09`）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-16 |
| 框架包版本 | `cli`/`runtime` `0.2.1`（**双包 lockstep**：runtime 自 0.2.0 升 0.2.1 与 cli 对齐，提交 `34ac3d09`；宿主 shell-dist 已重建，versions.json 记录 runtime 0.2.1） |
| oj | `0.1.74`（本机预置 `bin/`，同 §0 旁路 1） |
| 结果 | **全链路通过（§1–§6）**：`ojm init`（76 项新增）→ `pnpm install`（§0 旁路 2：本地 tgz 覆盖 cli+runtime）→ JsRuntime 探针通过 → `oj openapi` + `ojm api` + `--check` 0 error / 0 warn → `ojm build`（后端模块含 system 13 端点、modules.json 含 home/demo/login/personal-center/notification/system）→ `tsc` 0 error → `ojm dev`：seed ok、21 路由方法入参校验、登录/系统管理联调全对。`ojm preview`（§7）本次未跑（dev 已验证，避免端口冲突），列为可选。 |
| 本次新增验证点（用户要求：验证模板内置模块） | **系统管理模板模块 + 核心模块存在性联调**：以 `admin/123456` 登录（首登 `must_change=1` → 改密 `PUT /api/auth/password` 清悬挂）→ 带 token 直打 `system/settings`(200, items.module ∈ {framework,ldap,market,sso})、`system/users`(1)、`system/roles`(4)、`system/oplog`(4 条)、`system/permissions`(200)、`system/login-methods`(200)、`notifications`(4 条) 全部 200，无 token 返回 401；`web/hello`、`web/user-info`(admin/superadmin)、`web/get-async-routes` 全部 200；`modules.json` 注册 6 模块（home/demo/login/personal-center/notification/system）且各自 `entry.js` 可达（notification 版本 0.0.2，路径非空）。 |
| 与 0.1.20 基线差异 | 除双包升 0.2.1 与 shell-dist 重建外，无任何功能回退；本次模板已内置完整 `system` 模块（13 系统端点 + 6 页面），无需手动补 books 演示模块即可验证「模块存在」诉求。 |
| 复跑关键坑（新增已知项，见 §9） | 登录限速：`sys_rate_window`（per-IP 30/min）+ `sys_login_throttle`（per-(IP,user) 连败阻断）在反复失败登录后会以 `401 invalid credentials` 掩盖，并非口令错误。复跑前 `DELETE FROM sys_login_throttle; DELETE FROM sys_rate_window;` 清表，或冷起新 db（`rm -f api/db.sqlite*` 后 `ojm dev` 重建 seed）即可一次性成功登录。 |

### 历史基线（2026-10-15 二次演练，oj 0.1.74 / cli+runtime 0.1.20 提交态 `41fadd39`）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-15（当日第二次全链路演练；首次见下） |
| 框架包版本 | `cli`/`runtime` `0.1.20`（**已提交态** `41fadd39`，含 lint 15 处修复、cli 包 vitest config 锚定 + `pnpm test:cli` 接 CI、根 tsc 23→0；源码 CLI 验证） |
| oj | `0.1.74`（本机安装预置进 `bin/`；npm 通道 `@oj-bin/oj` 仍滞后于 `MIN_OJ_VERSION` 0.1.73 门禁，按 §0 旁路 1 绕过） |
| 结果 | **全链路通过（§1–§7），无新问题**。`ojm init`（76 项新增）→ `pnpm install`（§0 旁路 2）→ JsRuntime 探针通过 → books 模块（新约定）→ `oj openapi` + `ojm api` + `--check` 0 error / 0 warn → `ojm build`（7 后端模块、books 2 api file(s)、modules.json 含 home/login/books）→ `tsc` 0 error → `ojm dev`：seed ok、8 路由方法入参校验、登录/过滤(1 条)/新增 `{ok:true}`/401/通知兜底全对 → `ojm preview`：migrate 门禁过、release 路由来自 `api/dist`、API 与静态兜底正常、带 dist 的三腿 `--check` 0 error / 0 warn。 |
| 二次演练新增验证点 | **devkit 分发自包含性**（同日文档更新后）：业务工程 `.claude/skills/ojm-module-dev/` 拿到含 **§3.10 旧 `contract.ts` 工程迁移指南**的手册，grep 确认零仓库内部引用（`docs/migration`、`../oj-api-dev` 等已清）；oj 侧 devkit 落在 `.claude/skills/oj-api-dev/`，与手册内新引用一致。 |
| 与首次演练差异 | 无功能差异；首次演练发现并修复的 4 项（npm 滞后旁路、空 `_shared` 目录、routes.js 尾斜杠误报+豁免不对称、未发版安装旁路）在提交态全部保持修复，本次复跑逐项回归通过。 |

### 基线：2026-10-15 首次演练（oj 0.1.74 / cli+runtime 0.1.20 工作区态）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-15 |
| 框架包版本 | `cli`/`runtime` `0.1.20`（源码 CLI 验证；宿主 versions.json 钉版） |
| oj | `0.1.74`（本机安装预置进 `bin/`；npm 通道 `@oj-bin/oj` 当时 latest 仍是 0.1.71，低于 `MIN_OJ_VERSION` 门禁 0.1.73，`ojm vendor`/`ojm init` 的下载步会被门禁拦下——见 §9 新增行） |
| 结果 | **全链路通过（§1–§7）**：`ojm init`（76 项新增，预置 bin/oj 跳过 vendor 下载）→ `pnpm install` → JsRuntime 探针通过 → books 模块（新约定 `.schema` 入参 + 平级 `.response` 出参）→ `oj openapi` 重生成 → `ojm api` 生成 `web/src/books/__client`（导出 `booksListGet`/`booksCreatePost`，`BooksListGetData` 出参类型完整）→ `ojm api --check` 0 error / 0 warn → `ojm build`（7 后端模块含 books 2 api file(s)、6 前端模块、modules.json 含 home/login/books）→ `tsc --noEmit` 0 error → `ojm dev`：migrate/seed 正常、8 个路由方法入参校验激活、登录返回 token、列表/关键字过滤/新增/无 token 401/通知兜底全对 → `ojm preview`（release 形态）：migrate 门禁过、路由来自 `api/dist/**/routes.js`、API 与静态兜底正常、带 dist 的 `--check` 三腿全过。 |
| 新约定检查点 | 契约不再有 `contract.ts`/`routes.json`/`openapi.yaml`：handler 挂 `.schema`（params/query/body）+ 平级 `.response`（oj v0.1.72+），`oj openapi` 产出工程根 `openapi.json` 为唯一事实源；client 函数名 = `camelCase(operationId)`（如 `booksListGet`），非旧人类命名。 |
| 演练中发现并修复 | ① npm 通道 oj 滞后于门禁（预置本机二进制绕过，init 对已有 bin/oj 跳过 vendor）；② 模板残留空目录 `api/src/_shared` 被 init 拷进工程、`oj build` 报 "module '_shared' missing manifest.yaml"——删空目录 + `copyTemplates` 加空目录跳过防护；③ `--check` 第三腿误报：契约侧 fullPath 尾斜杠（`notifications/`）vs dist pattern（`notifications`）键不等，且豁免只过滤「dist 多」不过滤「dist 缺」——双侧规范化 + 豁免对称过滤（含 2 条回归测试）；④ 未发布版本的 `pnpm install` 需 file: 链接 + 手工 symlink（catalog: 协议只对 workspace 成员解析）。 |

### 历史基线（2026-10-11 演练，oj 0.1.60 / cli+runtime 0.1.12）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-10-11 |
| 框架包版本 | `cli`/`runtime` `0.1.12`（源码 CLI 验证；宿主 versions.json 钉版） |
| oj | `0.1.60`（`@oj-bin/oj` 通道；本环境无 npm registry 网络，把本机 0.1.60 安装预置进 `bin/` 以绕过 `ojm vendor` 下载，效果等价） |
| 结果 | **后端全链路通过**：`ojm init` → 生成 `mounts:` 配置 → `oj serve` 正常启动（migrations/seed 应用、6 模块/12 路由注册、证书有效、`/api/health` 200）→ 登录 `admin/123456` 返回 token、无 token 401、带 token 读 `/notifications`/`/web/hello` 200。`pnpm install` 因沙箱无 npm 网络未完成，§4–§7 前端链路待联网复跑。 |
| 新增验证点 | oj v0.1.58 起 `server.api_prefix` 等 5 键已删除、改顶层 `mounts:`（旧键 fail-fast，见 §9）；`readOjApiPrefix` 改读 `mounts:`，`ojm info` 显示 `base: /api` 正确。 |

### 历史基线（2026-09-11，记录用，后续对照）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | `cli`/`runtime` `0.1.6`（本次验证跑在 `refactor/vendor-npm-install` 分支源码 CLI 上：**vendor 下载源从 GitHub releases 切换为 npm 包 `@oj-bin/oj`**，见 `202609111926-vendor-npm-install-design.md`） |
| oj | `0.1.13`（**npm `@oj-bin/oj` 通道**首验：`ojm init` 临时目录 `npm i` → 落盘 `bin/oj` + `bin/plugins/` + `bin/devkit/`，无构建机路径泄漏，探针通过） |
| 结果 | 全链路通过（§1–§7）。发现并修正 3 处手册判据过期（§1/§2/§8 的四包时代 devDeps 表述 → 两包时代只有 `cli`+`runtime`；§6 curl 直打 `/login` 404 系 SPA 回落需 `Accept: text/html`，非缺陷，已补判据说明）。`@types/react`/`typescript` 回退 `*` 告警依旧，安装后需钉版（本次钉 `19.3.0` / `7.0.2`） |

<details>
<summary>上一次基线（0.1.6 四包收尾 / oj 0.1.12 GitHub release 通道）</summary>

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | `cli` `0.1.5`（本次模板修复：home/login 前端模块 + notifications 端点 + 豁免清单；home 用统计卡片 + 折线/柱/饼图演示共享依赖矩阵）+ `runtime`/`shell` `0.1.4` + `contract` `0.1.3`（四包均已按本手册复跑） |
| oj | `0.1.12`（**官方 release**）——v0.1.11 及更早的 release 二进制有构建机路径缺陷，v0.1.12 已修复（见 §3） |
| 结果 | 全链路通过（§1–§7）：release 二进制在非构建机可用，`ojm dev` / `ojm preview` 均正常。发现并修复 4 个脚手架缺陷（模板缺 `api/.ojm-api-exempt.json` → `ojm api --check` 误报；模板缺 `web/src/login` → `/login` 无路由可跳；模板缺 root 级 `api/src/notifications` → 通知铃 404；模板缺 `web/src/home` → 登录回跳 `/home` 落错误边界，见 §4/§5）与 2 处手册判据过期（§3 泄漏计数、§4 未注明豁免文件） |

</details>

<details>
<summary>更早基线（0.1.3 / oj 0.1.11 自建）</summary>

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-11 |
| 框架包版本 | 首次全链路：四包均 `0.1.3`；其后发布 `runtime`/`cli`/`shell` `0.1.4`（`contract` 保持 `0.1.3`） |
| oj | `0.1.11`（**自建**，见 §3 高危检查点） |
| 结果 | 0.1.3 全链路通过；发现并修复 2 个脚手架缺陷（缺 `contract` 依赖、缺 `env.d.ts`），并给 cli 增加 oj 二进制自检探针（0.1.4 起随 `ojm vendor`/`ojm init` 自动执行） |

</details>

---

## 0. 准备（干净目录）

```bash
export VERIFY_DIR=/tmp/ojm-verify
export OJM_REPO=/Users/ever/git/only-js/oj-module   # 按实际改
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
```

需要：Node 18+、pnpm、**网络**（下载 oj 与 npm 包）。预计 5–10 分钟。

> **npm 通道滞后时的两条旁路**（2026-10-15 演练实测）：
> 1. **oj**：`MIN_OJ_VERSION` 门禁钉最新发布版（0.1.20 起为 **0.1.73**），而 npm `@oj-bin/oj` 的 latest 可能仍低于门禁 → `ojm vendor`/`ojm init` 的下载步被拦。旁路：先把本机 oj（≥ 门禁）连同 `devkit/`、`plugins/`、`.oj-version` 预置进工程 `bin/`，`ojm init` 对已有 `bin/oj` 会跳过 vendor（init.ts：bin/oj 存在即 `report.skipped`），效果等价。（2026-10-19 实测：oj latest 已 0.1.80 ≥ 门禁，本条旁路未触发。）
> 2. **框架包自身**：待发版本（如 0.1.20 未上 npm）`pnpm install` 会 `ERR_PNPM_NO_MATCHING_VERSION`。旁路：删 devDeps 里的 `@oj-module/cli`（CLI 用源码 bin 直跑），`@oj-module/runtime` 装好后手工 symlink 到仓库 `packages/runtime`（其内部依赖经 realpath 回落仓库 node_modules 解析，与 playground-oj 的 workspace 链接等效）。注意 `file:` 链接不行：两个包都用了 pnpm `catalog:` 协议，只对 workspace 成员解析。
>    **cli 与 runtime 双双未发版时**（2026-10-19 实测形态）：两个 devDep 都要删，再 `ln -s $OJM_REPO/packages/runtime node_modules/@oj-module/runtime`。Node 侧只有 `@oj-module/runtime/contract` 子路径会被真正求值（`ojm api` 用）；浏览器包本体 import `antd/locale/*` 在裸 Node 下报 extensionless 是**预期**，不影响链路。另：本机 pnpm store 已预热时 `pnpm install --offline` 可绕开 registry 限速（实测 1.6s，见 §9）。

## 0.5 发布形态准备（默认；与发包逐字节一致）

> **为什么必须有这一步**（2026-10-19 0.2.5 实测教训）：源码树跑演练会漏掉**打包差异**——npm/pnpm pack 会剥离 `.gitignore` 等 VCS 点文件、prepack 才同步 `devkit/` 与 `vendor/host-versions.json`、`shell-dist` 不带 sourcemap。源码树里 `templates/.gitignore` 存在、演练全绿；发布包里它不存在，`readInitInclude` fail-fast 把 `ojm init` 整个打挂（用户工程只剩空目录）。**演练用源码树 = 没验到用户真正装到的东西。**

```bash
export CLI_PKG=/tmp/ojm-verify/cli-pkg          # 解包后的 cli 发布包（后续 ojm 调用一律走它）
mkdir -p /tmp/ojm-verify
pnpm --dir "$OJM_REPO/packages/cli" pack --pack-destination /tmp/ojm-verify
tar -xzf /tmp/ojm-verify/oj-module-cli-*.tgz -C /tmp/ojm-verify
mv /tmp/ojm-verify/package "$CLI_PKG"
pnpm install --dir "$CLI_PKG"                    # 发布包 manifest 已被 pnpm pack 改写为真实 semver，可独立安装
```

后续所有 `ojm` 命令走 `$CLI_PKG/bin/ojm.mjs`（**不要**再走 `$OJM_REPO/packages/cli/bin/ojm.mjs`）。runtime 未发版时：在 my-books 里 `pnpm add -D <runtime 本地 tgz>`（同样先 `pnpm --dir packages/runtime pack`）——**务必 `-D` 装进 devDependencies**，否则 `ojm build` 的 C4/D12 门禁会拒（`@oj-module/runtime` 是硬共享依赖，禁止进 `dependencies`，由宿主 importmap 统一提供，自带产生双实例）；§0 旁路 2 的 symlink 仅作 store 不全时兜底。整体通过后如需确认 registry 形态，再 `pnpm dlx @oj-module/cli@<ver> init` 复跑一次 §1。

## 1. 脚手架（`ojm init`）

```bash
# 发布形态（默认，§0.5 准备）：与用户 `pnpm dlx @oj-module/cli@x.y.z init` 装到的逐字节一致
node "$CLI_PKG/bin/ojm.mjs" init my-books --yes
# 仅当明确要验证「源码树当前代码」时才用源码 bin（注意：会漏打包差异，如 .gitignore 被 pack 剥离，见 §9）
# node "$OJM_REPO/packages/cli/bin/ojm.mjs" init my-books --yes
```

**检查点**

- [ ] 退出码 0，末行提示 `登录 admin / 123456`
- [ ] 目录齐全：`api/src/{_platform,auth,web,notifications,notification,personal-center,system}`、`api/.ojm-api-exempt.json`、`web/src/{demo,home,login,personal-center,notification,notifications,system}`、`web.config.ts`、`tsconfig.json`、`global.d.ts`、`env.d.ts`、`bin/oj`、`bin/.oj-version`、`.claude/skills/{oj-api-dev,ojm-module-dev}/`
- [ ] **工程根有 `.gitignore`**（发布包不携带模板 `.gitignore`——npm/pnpm pack 剥离点文件，改由 init 现场生成，`ensureGitignore`；0.2.5 曾因 include 清单收录它而 fail-fast，见 §9）
- [ ] **工程根有 `openapi.json`**（新流水线唯一事实源，模板随附）+ `web/src/<模块>/__client/` 预生成（`ojm api --check` 开箱即过）
- [ ] handler 契约为新约定：动词挂 `.schema`（params/query/body 入参）+ **平级 `.response`**（出参，oj v0.1.72+）；无 `contract.ts` / `routes.json` / `openapi.yaml`
- [ ] **分发的 devkit 自包含**：`.claude/skills/ojm-module-dev/` 三件套含 manual.md **§3.10 旧 contract.ts 工程迁移指南**；grep `docs/migration|docs/plans|../oj-api-dev` 应**零命中**（devkit 随 init 进业务工程，不能引用框架仓内部路径）；oj 侧 devkit 落在 `.claude/skills/oj-api-dev/`
- [ ] `package.json` 的 devDependencies **含** `@oj-module/{cli,runtime}`（两包时代；`contract` 是 runtime 子路径、shell 已并入 cli），且值**不是 `*`**
- [ ] 若出现「`@types/react` / `typescript` 回退 `*`」告警 → 记下，安装后必须钉版
- [ ] **未出现「oj 二进制自检失败」告警**（cli ≥ 0.1.4 安装后自动冒烟）；若出现，按 §3 换自建二进制
- [ ] npm 通道 oj 低于门禁时按 §0 旁路 1 预置 `bin/oj` 后重跑（init 幂等）

## 2. 安装依赖

```bash
cd my-books && pnpm install
```

**检查点**

- [ ] `node_modules/.bin/tsc` 存在；`@oj-module/runtime` 可解析（发行版走 npm；源码验证按 §0 旁路 2）
- [ ] 安装日志里 `@oj-module/{cli,runtime}` 版本与 `versions.json` 一致（源码验证时 cli 以 bin 直跑、`ojm info` 显示 `cli: unknown` 属预期）
- [ ] `pnpm exec ojm info`（或 `node "$CLI_PKG/bin/ojm.mjs" info`）输出宿主版本矩阵 + 模块清单，无报错
- [ ] 处理 §1 的 `*` 告警：把 `@types/react` / `typescript` 钉成实际安装版本

## 3. oj 二进制可用性（检查点）

```bash
./bin/oj --version                              # 期望：oj ≥ 0.1.73（MIN_OJ_VERSION 门禁；平级 .response 需 0.1.72+，del→delete 操作键归一需 0.1.73+）
strings bin/oj | grep -oE '/Users/runner/work/only-js/only-js/[^"]*\.js'
# 期望：**空**（无泄漏的 JS 构建路径）。注意：`grep -c "/Users/runner"` 不再适用于判据——
# 即便修复后仍会命中 cargo registry 的 panic 路径（如 h2/unsafe-libyaml），属正常。
```

**已知缺陷（v0.1.12 已修复）**：GitHub release 的 oj 二进制曾由 CI 构建，JS 扩展源码被标记为
`LoadedFromFsDuringSnapshot` 且把**构建机路径**烤进二进制；在非 CI 机器上
初始化 JS 运行时报：

```
Failed to initialize a JsRuntime: No such file or directory (os error 2)
```

`./bin/oj --version` **仍会成功**（Rust 侧），所以 v0.1.12 之前必须向下走一步才会暴露。
**v0.1.12 起 JS 源已内嵌进二进制**（`ext:bridge_ext/bootstrap.js` 不再指向构建机路径），
release 产物在非构建机可用。

**最小复现探针**（必须有至少一个 `api.ts`，否则 `oj build` 不会初始化 JsRuntime）：

```bash
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello
printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts
printf 'name: web\ndesc: probe\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml
./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out 2>&1 | head -5
# 期望：oj build: web v0.1.0 → ... (1 api file(s))
# 坏二进制（≤ v0.1.11）：Failed to initialize a JsRuntime: No such file or directory (os error 2)
```

**处置**：优先 `ojm vendor` 拉 **≥ v0.1.12**（下载源为 npm 包 `@oj-bin/oj`）。若仍报 ENOENT（版本过旧或未换包），
用**自建** oj 覆盖 `bin/oj`（`cargo build --release`，产物在 `only-js/target/release/oj`），
然后重跑这些检查点直到通过。

> **自 cli 0.1.4 起已自动化**：`ojm vendor` / `ojm init` 安装后（以及「已是该版本，跳过」时）
> 会自动执行等价的 `probeOjRuntime` 冒烟；失败打印人话告警与处置指引，**不阻断**安装
> （便于用户直接替换 `bin/oj`）。本节手工探针用于 CI 与不经 cli 的场景。

> 完整根因与修复方案（可转上游）：[`oj-release-binary-defect-report.md`](./oj-release-binary-defect-report.md)。

> 通过后可继续；否则后面的 `ojm build` / `ojm dev` 必然失败。

## 4. 契约 → 前端 client

在 `api/src/books/` 下补 6 个后端文件（manifest/schema/migration/seed + 2 handler），
handler 按**新约定**写契约——**无 `contract.ts`**：入参挂 `.schema`（params/query/body），
出参挂**平级 `.response`**（oj v0.1.72+；范本照 `packages/cli/templates/api/src/notification/api.ts`、
`apps/playground-oj/api/src/demo/todos/api.ts`）：

```ts
// api/src/books/list/api.ts
const list = {
	async get() { /* ...db.query...; json.ok(rows) */ },
};
list.get.schema = { query: { type: "object", properties: { keyword: { type: "string" } } } };
list.get.response = { type: "array", items: { /* data payload */ } };
export default list;
```

然后：

```bash
./bin/oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json   # 唯一事实源（工程根单文件）
node "$CLI_PKG/bin/ojm.mjs" api                            # 或 pnpm exec ojm api
node "$CLI_PKG/bin/ojm.mjs" api --check
```

**检查点**

- [ ] `oj openapi` 退出码 0，`openapi.json` 含 `/api/books/list`、`/api/books/create`
- [ ] `ojm api` 输出「契约 N 份；写入 2 个文件」——产物 `web/src/books/__client/{api.ts, api.schemas.ts}`（**`__client` 目录名**，旧 `client/` 已改名）
- [ ] client 导出 **operationId 派生名**：`booksListGet` / `BooksListGetQuery` / `BooksListGetData` / `booksCreatePost`（= `camelCase(路径_方法)`，**不是**旧 `defineApi` 的人类命名如 `listBooks`）
- [ ] **出参类型存活**：`BooksListGetData` 非 `unknown`（`.response` 经 `responses.200.content` 信封进 client——新约定与旧 `.schema.response` 的等价性验证点）
- [ ] **不生成** `api/src/books/routes.json` / `openapi.yaml`（旧产物已清理；`api/docs/openapi.yaml` 仅 `--docs` 时产生）
- [ ] `ojm api --check` 退出码 0：`0 error / 0 warn`（无 dist 时第三腿 routes.js 对账给 hint 不判违规）
- [ ] 工程根存在 `api/.ojm-api-exempt.json`（`{"modules":["web","notifications"],"paths":["/auth/*"]}`，内置 `auth`/`web`/`notifications` 端点有意无业务契约；init 自 cli 0.1.5 起内置）

> `ojm api` 只认 `openapi.json`（项目根或 `api/`）：找不到即报错指引先跑 `oj openapi`。
> 若报 `Cannot find package '@oj-module/runtime'` → 依赖未装/未链接（§0 旁路 2）。

## 5. 前端模块

补 `web/src/books/{entry.ts,locales/*,pages/index.tsx}` 并**登记进 `web.config.ts` 的 `allModules`**
（加一行 `{ name: "books", entry: "web/src/books/entry.ts" }`——该清单是显式的，漏登记则
build 静默跳过 books、modules.json 里不出现，2026-10-20 实踩），然后：

```bash
pnpm exec ojm build
pnpm exec tsc --noEmit -p tsconfig.json     # typecheck
```

**检查点**

- [ ] `ojm build`：`oj build` 列出全部后端模块（0.2.10 实测 8 个：`_platform/auth/books/notification/notifications/personal-center/system/web`），其中 books `2 api file(s)`、notifications `1 api file(s)`
- [ ] 输出「已合并宿主站点 → web/dist」「构建 books@0.1.0」「清单已生成」
- [ ] `web/dist/` 含 `index.html`、`assets/`、`modules/`、`modules.json`、`versions.json`
- [ ] `web/dist/modules/books/0.1.0/entry.js` 存在（带 `integrity`）
- [ ] `modules.json` 含 `home` / `demo` / `login` / `books`（**`home` / `login` 不可少**：shell 预构建把 `VITE_BASE_HOME_PATH` 定为 `/home` 且不挂 runtime 内置登录兜底，缺则登录回跳 / 登出 / 点 logo 落错误边界）
- [ ] `modules.json` 中 books 条目 `peerRuntime` 与宿主 runtime 版本相容
- [ ] **typecheck 0 error**（含生成的 `__client/api.ts`——页面 import 的 `booksListGet`/`BooksListGetData` 等 operationId 派生名须对得上）

## 6. 运行与联调（`ojm dev`）

```bash
pnpm exec ojm dev        # 默认 5174；oj 9778
# 另一个终端：
TOKEN=$(curl -s -X POST http://127.0.0.1:9778/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"123456"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.access_token))")
curl -s "http://127.0.0.1:9778/api/books/list?keyword=设计" -H "authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:9778/api/books/create -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"title":"重构","author":"Martin Fowler","year":2019}'
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9778/api/books/list   # 期望 401
curl -s http://127.0.0.1:9778/api/notifications -H "authorization: Bearer $TOKEN"  # 通知铃兜底（期望数组）
```

**检查点**

- [ ] dev 日志：`seed ok module="books"`、`routes: N method-row(s)`（0.2.10 实测 52 row / 25 api file）、`input contracts: M route-method(s) validated before reaching JS`（0.2.10 实测 37；`.schema` 入参校验激活）、`oj serve listening`
- [ ] 登录返回 `code:0` 且 `data.access_token` 非空
- [ ] 登录成功后回跳 `/home` 正常渲染（不落 React Router 错误边界），页面含统计卡片 + 折线/柱/饼图（共享依赖矩阵演示）
- [ ] 列表过滤按关键字命中（注意种子数据：`keyword=设计` 会同时命中「设计数据密集型应用」与「领域驱动设计」——用更独特的关键字如 `数据密集型` 验证单条过滤）
- [ ] 新增返回 `code:0` 且 `data` 与 `create.post.response` 声明一致（tutorial 的 handler 声明 `{ok:true}`；自建 handler 按自身声明核对），全量列表条数 +1
- [ ] `GET /api/notifications`（带 token）返回 `code:0` + 数组（runtime 通知铃 root 级兜底；缺端点会 404 `no route matched`）
- [ ] 无 token 返回 **401**
- [ ] `http://localhost:5174/` 200，importmap 含 `@oj-module/runtime`，`/modules/books/0.1.0/entry.js` 200
- [ ] `/modules/login/0.1.0/entry.js` 200，且 `/login` 能渲染模块登录页（登出后可跳回；缺 login 模块则落空）

> **curl 打路由路径 404 不是缺陷**：SPA history 回落要求 `Accept: text/html`（浏览器天然带），
> curl 默认 `*/*` 不触发回落。curl 验证请带 `-H 'Accept: text/html'`。

用完停服：`pkill -f "ojm dev"; pkill -f "bin/oj"`。

## 7. 预览（可选，验证 release 形态）

```bash
pnpm exec ojm preview    # oj migrate（verify 门禁）→ 单服务 release 形态（9778：API + 静态 SPA 同进程）
```

**检查点**：migrate 成功（账本落后会拒启，先 `oj migrate -c api/config.yaml -d api/dist`）；
站点可访问（9778 根 200 + `/modules/books/0.1.0/entry.js` 200；preview 自 0.2.5 起为单服务，
旧基线记的 4173 双服务已过时）；
release 下路由来自 `api/dist/**/routes.js`（目录镜像不存在）；
API 全链路再通一遍（登录/列表/新增）；
**带 dist 后重跑 `ojm api --check`**——第三腿（routes.js vs openapi.json 契约路由表）此时激活，
应 `0 error / 0 warn`（注意尾斜杠规范化与豁免对称过滤，2026-10-15 已修，见 §9）。

## 7.1 开发一个方案模块（作者视角）

> 与 §4–§5 的区别：§4/§5 是在**宿主工程里**写业务模块（跟着宿主一起构建）；本节写的是**可分发**的
> 方案模块——独立工程、独立构建、打成包发布到市场。两者共用 oj 的 handler 与清单约定。

方案工程的最小形态（后端方案；带前端则在 `web/src/<name>/` 补 entry 与 locales）：

```text
solution-demo/
├── manifest.yaml                      # C2 契约清单（Form A，包身份证）
├── api/src/<name>/
│   ├── manifest.yaml                  # oj 原生清单（name/desc/version/tables）
│   ├── schema.yaml                    # 声明式表结构（必须与 manifest.tables 逐一对齐）
│   ├── routes.js                      # 手写路由（oj build 会重写成生成物）
│   ├── migrations/0001__init.sql      # 迁移（与 schema.yaml 同表名）
│   └── ping/api.ts                    # handler 必须是 .ts（见坑 ①）
└── web/src/<name>/locales/{zh-CN,en-US}.json   # manifest 引用 i18n key 时必需（见坑 ③）
```

```bash
# 1) 后端构建：用宿主（或任意）已安装的 oj 二进制
<host>/bin/oj build -d api/src -o api/dist
#   期望：oj build: demo-solution v0.1.0 → api/dist/demo-solution-0.1.0 (1 api file(s))

# 2) 打包（构建即校验：清单契约 + 表↔schema + locales 双语齐备）
node "$CLI_PKG/bin/ojm.mjs" build --bundle
#   期望：方案包已生成 → dist/<name>-<version>.tgz + sha256（确定性：同输入两次同哈希）
```

**检查点**

- [ ] `api/dist/<name>-<version>/` 内含 `manifest.yaml`、`routes.js`、`ping/api.js`、`migrations/`、`schema.yaml`
- [ ] `routes.js` 里出现自己声明的路由行（若为空 → handler 不是 `.ts`，见坑 ①）
- [ ] `ojm build --bundle` 退出码 0，`dist/<name>-<version>.tgz` 存在且 sha256 两次一致
- [ ] 没有 `C2-25` / `C2-12a` 违规输出（有则按提示补齐 locales / schema）

## 7.2 发布到市场源（CDN）

```bash
# 1) 一次性发布方身份（一次生成，长期复用；私钥永不入仓）
node "$CLI_PKG/bin/ojm.mjs" keygen --id demo.publisher --out ./keys --yes
#   记下 fingerprint（市场卡片与 trust confirm 都要核对它）

# 2) 落包 + 重建索引（--real 走真构建；发布方密钥与 --id 必须同时给）
cd <host>
node "$CLI_PKG/bin/ojm.mjs" market publish --real ../solution-demo \
  --id demo.publisher --key ../keys/private.pem --rebuild-index

# 3) 离线验包（不起站点、不装、不要凭据）
node "$CLI_PKG/bin/ojm.mjs" market verify --rebuild-index
```

**检查点**

- [ ] `cdn/` 下六件套齐全：`<name>-<version>.tgz`、`.tgz.sig`、`bundles.yaml`、`manifests.yaml` 及两份 `.yaml.sig`
- [ ] `market verify` 五项全 ✓（完整性 / 包级签 / 索引签 ×2 / manifest 结构），末行带边界声明
- [ ] `curl <站点>/cdn/bundles.yaml` 返回 YAML（不是 index.html）——dev 形态陷阱见 §9
- [ ] 重发同版本且字节一致 → 幂等；字节不同 → 报冲突并提示升 version

## 7.3 市场链路验证（安装 → TOFU → 装成）

> **前置**：宿主必须以 **release 形态 + 真实 config** 起站（见坑 ⑤⑥）。dev（`--api-path src`）与
> `ojm preview`（派生 config）都**不能**完成安装的热更段。

```bash
cd <host>
node "$CLI_PKG/bin/ojm.mjs" build                      # api/dist + web/dist（含 api/dist/versions.json）
# config：platform.root 改为 dist（release 形态；dev 时是 src）
#   platform:
#     modules: [_platform]
#     root: dist
(cd api && ../bin/oj serve -c config.yaml -b /api --api-path dist --console-log &)

node "$CLI_PKG/bin/ojm.mjs" market setup --url http://127.0.0.1:9778 --user admin --pass 123456 --new-pass <新口令>
# → 市场页（或 GET /api/_platform/market/index）出现方案卡片

# 安装（首次必然停在待信任）
curl -s -X POST http://127.0.0.1:9778/api/_platform/market/install \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"demo-solution","version":"0.1.0","source":"cdn"}'
# → {data:{id:"install-..."}}；轮询 GET /api/_platform/market/task?id=<id> 到 status=needs_trust
#   响应的 trust.fingerprint 必须与 keygen 输出逐字一致

node "$CLI_PKG/bin/ojm.mjs" trust confirm --task <task-id> --url http://127.0.0.1:9778 --user admin --pass <新口令>
# 重试同一条 install → 期望 status=done，11 段全 ok

# 只验「这个包能不能装」、不想搭宿主时（隔离站点，12s 内出结果）
node "$CLI_PKG/bin/ojm.mjs" market trial --fixture <name>@<version>
```

**检查点**

- [ ] `market/index` 卡片含目标方案与 latest 版本（空则回看 setup 写入的市场地址）
- [ ] 首次安装 `status=needs_trust`，`trust.fingerprint` 与发布方公布值一致（**逐字核对再确认**）
- [ ] `trust confirm` 后重试，`status=done` 且 11 段全 `ok`：`preflight / downloading / verifying /
      extracting / migrating / lock_commit / registering / deploying_web / reloading / smoke / audit`
- [ ] 装后探活：`curl /api/<name>/ping` 返回 `code:0`（匿名端点，无需 token）
- [ ] 安装锁 `api/dist/manifests.yaml` 出现 `<name>: <version>`；`api/dist/<name>-<version>/` 存在
- [ ] 再装同版本 → 走重装路径而非「方案名已被占用」；`market verify --rebuild-index` 无漂移

## 8. 一次通过判据（汇总清单）

- [ ] `ojm init` 成功：devDeps 含 `@oj-module/{cli,runtime}`（非 `*`）、根级 `openapi.json` + `__client` 预生成、handler 为新约定（`.schema` 入参 + 平级 `.response`，无 `contract.ts`/`routes.json`/`openapi.yaml`）、`env.d.ts` 在 include
- [ ] `pnpm install` 成功，`cli`/`runtime` 两包版本一致（未发版按 §0 旁路 2）
- [ ] oj 二进制通过 §3 探针（JsRuntime 能初始化），版本 ≥ 门禁 0.1.73
- [ ] `ojm api` 生成 `web/src/books/__client`（operationId 派生名、出参类型存活）；`--check` 无 drift（内置 `auth`/`web`/`notifications` 经 `api/.ojm-api-exempt.json` 豁免，见 §4）
- [ ] `ojm build` 产出全部后端模块 + 合并站点 + `modules.json`（含 home/login/books）
- [ ] `typecheck` 0 error
- [ ] `ojm dev`：登录 / 列表过滤 / 新增 / 401 / 通知兜底全对
- [ ] （可选）`ojm preview` 通过 migrate、服务与带 dist 的 `--check` 三腿
- [ ] 〔方案链路〕
  - [ ] 方案工程 `oj build` 出 `api/dist/<name>-<version>/`（含路由行）、`ojm build --bundle` 出 tgz（sha256 稳定）
  - [ ] `ojm market publish --real --rebuild-index` 后 `cdn/` 六件套齐全，`market verify --rebuild-index` 五项全 ✓
  - [ ] 宿主 `ojm build` 后 `api/dist/versions.json` **存在**（C2-09 前置；缺则该步是回归）
  - [ ] 市场卡片可见 → 首装 `needs_trust`（指纹逐字核对）→ `trust confirm` → 重试 `status=done` 且 11 段全 ok
  - [ ] 装后 `/api/<name>/ping` 返回 `code:0`；`api/dist/manifests.yaml` 出现 `<name>: <version>`

## 9. 已知坑与处置

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| `oj serve` 启动报 `config uses removed server.* site keys (v0.1.58): api_prefix` | oj v0.1.58 起删除 `server.api_prefix`/`app_spa_fallback`/`app_path`/`app_prefix`/`static_sites`，改顶层 `mounts:`（出现旧键即 fail-fast，并输出迁移 YAML） | `api/config.yaml` 用 `mounts:`（ojm init 自本轮起已生成）；老工程把 `server.api_prefix: /api` 改为 `mounts: [{prefix: "/api", api: "src"}]`（devkit `api-manual.md` §10）；ojm dev/preview 的 SPA 深链回落由 ojm 自建静态层负责，无需旧 `app_spa_fallback` |
| `Failed to initialize a JsRuntime: No such file or directory` | ≤ v0.1.11 的 release oj 二进制烤了构建机路径（v0.1.12 已修复） | 用 ≥ v0.1.12 的 release（`ojm vendor`）；旧版用自建 oj 覆盖 `bin/oj`（§3） |
| `ojm init` / `ojm vendor` 末尾出现「oj 二进制自检失败」告警 | release 二进制缺陷，cli ≥ 0.1.4 的安装后冒烟主动暴露 | 同上；v0.1.12 起不应再出现。告警不阻断，`ojm init` 仍已产出工程 |
| `ojm api --check` 报 `handler 未登记`（`auth/*`、`web/*`） | 内置模块有意无契约，而工程缺豁免清单 | cli ≥ 0.1.5 的 `ojm init` 已内置 `api/.ojm-api-exempt.json`；旧工程手工补（`{"modules":["web"],"paths":["/auth/*"]}`，§4） |
| 登出 / 回跳登录落空，`/login` 空白或 404 | 工程缺 `login` 模块——shell 宿主只消费模块路由，不挂 runtime 内置登录兜底 | 保留 `web.config.ts` 的 `login` 模块（cli ≥ 0.1.5 的 `ojm init` 已内置 `web/src/login`，§5） |
| 登录后 / 点 logo 跳 `/home` 落 React Router 错误边界 | shell 预构建把 `VITE_BASE_HOME_PATH` 定为 `/home`，而工程缺 home 模块 | 保留 `web.config.ts` 的 `home` 模块（cli ≥ 0.1.5 的 `ojm init` 已内置 `web/src/home`，§5） |
| 通知铃请求 404 / `no route matched` | 缺 root 级 `/api/notifications` 端点（runtime 未注册 provider 时走内置兜底） | cli ≥ 0.1.5 的 `ojm init` 已内置 `api/src/notifications`（root 级 handler + 表，参考 playground notification，§5） |
| `ojm api` 报 `Cannot find package '@oj-module/runtime/contract'` | 工程 devDeps 缺 `contract` | 新版 `ojm init` 已内置；旧工程手动加并 `pnpm install` |
| `typecheck` 报 `Property 'env' does not exist on type 'ImportMeta'` | 缺 `env.d.ts` / 未进 tsconfig include | 新版 `ojm init` 已内置；旧工程补 `env.d.ts` 并加进 `include` |
| `@types/react` / `typescript` 为 `*` | 宿主 versions.json 未收录 | 安装后钉成实际版本 |
| 登录 401 且非 `invalid credentials` | `/auth/*` 不在 `anonymous_paths` | 补进 `api/config.yaml` 后重启 |
| 反复失败登录（含首登改密前）后登录恒 401 `invalid credentials`，但口令正确 | per-IP 登录限速 `sys_rate_window`（阈值 30/min，见 `api/src/auth/_shared/login-throttle.ts` 的 `rateLimit("login:ip:${ip}", 30, 60_000)`）被压满，`guardLoginThrottle` 在窗口超限时抛 401 并复用 "invalid credentials" 文案掩盖 | 复跑前清表：`sqlite3 api/db.sqlite "DELETE FROM sys_login_throttle; DELETE FROM sys_rate_window;"`；或冷起新 db（`rm -f api/db.sqlite*` 后 `ojm dev` 重建 seed）一次性成功登录 |
| 新增后端模块目录后接口 404 | 目录镜像路由未热加载 | 重启 `ojm dev` |
| DELETE 请求 405 | 方法名写成 `delete` | 改为 `del` |
| `ojm api` 报 apiPrefix 与目录名不符 | 违反 AC-D9 | 改 `apiPrefix` 或移动契约目录 |
| 迁移账本落后拒启（M004） | release `verify` 门禁 | 先 `oj migrate -c api/config.yaml -d api/dist` |
| 方案工程 `oj build` 报 `S005: <mod>/manifest.yaml: tables 声明 "x" 不在 schema.yaml` | oj 用 schema.yaml 做表结构真源，manifest.tables 只是引用面 | 在 `api/src/<name>/schema.yaml` 按声明式格式补该表（`tables: {<table>: {pk, columns}}`），与 migrations 的建表语句对齐 |
| 方案包 `ojm build --bundle` 报 `C2-25 缺少 web/src/<name>/locales/{zh-CN,en-US}.json` | manifest 只要引用了 `title_key`/`label_key` 这类 i18n key，就必须提供双语 locale（后端方案同样要） | 建两份 locale JSON；key 必须**嵌套**（`{"menu":{"main":"…"}}`），平铺 dotted key（`"menu.main"`）查不到 |
| `ojm build --bundle` 报 `C2-12a`（tables 与 schema 不一致） | 同上：清单声明与 schema.yaml 表集必须逐一相等 | 改 manifest.tables 或 schema.yaml，二者取并集后保持一致 |
| 方案装了但路由 404 / `routes.js` 是空表 | `oj build` 只编译 `.ts` handler；直接放 `ping/api.js` 不会进 dist | 方案工程 handler 写 `api.ts`（由 oj build 编译成 dist 里的 `api.js`） |
| 安装 POST 返回 200、但 `GET market/task?id=` 恒 404 | 宿主 config 缺 `fs:` 段 → 安装器落盘被 jail 拒，失败发生在任务文件写入之前 | cli ≥ 0.2.13 的模板自带 `fs: {root: ., readonly: false}`；旧工程手补后重启 |
| 安装卡在 `preflight`：`C2-09 无法读取宿主 runtime 版本` | 安装器读 `api/dist/versions.json`（B-11 与 manifests.yaml 同层），而早期 `ojm build` 只写 `web/dist/versions.json` | cli ≥ 0.2.13 的 `ojm build` 已双落点；旧版手抄一份 `cp web/dist/versions.json api/dist/versions.json` |
| 安装卡在 `reloading`：`NotCapable: module '_platform' is not platform-privileged` | 宿主 config 的 `platform.modules` 未列 `_platform` | 模板自 0.2.13 起自带 `platform: {modules: [_platform], root: src}`；旧工程手补 |
| 安装卡在 `reloading`：`reloadConfig 返回 unchanged` | 用 `ojm preview` 起站——它服务派生 config（`.ojm-preview.yaml`），而安装器热更改的是 `api/config.yaml`，被监视文件没变 | 安装验证必须对**真实 config** 起站：`(cd api && ../bin/oj serve -c config.yaml -b /api --api-path dist)`，并把 `platform.root` 改成 `dist` |
| 安装卡在 `smoke`：探活 404 | dev 形态（`--api-path src`）起站，装好的模块落在 `api/dist`，不被发现 | 安装目标恒为 release 部署；先 `ojm build`，再以 `--api-path dist` 起站 |
| 安装卡在 `smoke`：探活 401（方案声明了 `api.anonymous`） | auth 守卫在**装配期**读 `anonymous_paths`，安装器刚注册进去的匿名路径要重启才生效 | 重启站点后重试安装即可（装成的模块与锁都在，重试走重装路径）；或安装前把该路径预置进 `config.anonymous_paths`。`ojm market trial` 已在隔离站点预置（验机制而非重启时序） |
| 想确认「这个包到底能不能装」又不想碰自己的工程 | 手工起站试装要清场、还会污染信任库 | `ojm market trial --fixture <name>@<version>`：一次性隔离站点（随机端口 / 一次性 DB/密钥/凭据/信任库/CDN）跑完整安装，跑完即毁；`--keep` 保留现场。实测 11 段全 ok 约 12s |
| `oj serve` 报 `platform.root (...) must be mounted as an api mount` | release（`--api-path dist`）下 `platform.root` 仍指 `src`，与生效的模块根不一致 | 把 `platform.root` 改成 `dist`（`ojm preview` 派生 config 时会自动改写） |
| `ojm init`/`ojm vendor` 报「上游 @oj-bin/oj 的 latest 是 vX，低于 ojm 要求的最低版本 v0.1.73」 | npm 通道发布滞后于 `MIN_OJ_VERSION` 门禁（门禁钉最新发布版，ojm 不做兼容分支） | 本机已装 ≥ 门禁的 oj 时：把 `bin/{oj,devkit/,plugins/,.oj-version}` 预置进工程再跑 init（bin/oj 存在即跳过 vendor）；否则等上游发布或降级 cli |
| `pnpm install` 报 `ERR_PNPM_NO_MATCHING_VERSION ... @oj-module/cli@0.1.20` | 验证的是未发布版本，npm 上没有 | 删 devDeps 的 cli（源码 bin 直跑）+ 用 §0.5 的 `pnpm add <runtime 本地 tgz>` 把 runtime 装进 devDependencies（双包均未发版时 cli/runtime 都要处理）；**勿用 `ln -s` 把裸 runtime tarball 链进 `node_modules`**——裸包无 `node_modules`，`export { z } from "zod"` 解析成 `any`，会让生成物 `__client/api.ts` 的 `.map(i => …)` 全报 TS7006，typecheck 假红。也勿用 `file:` 链 cli（两包的 `catalog:` 依赖只对 workspace 成员解析，报 `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`） |
| `oj build` 报 `module '_shared' missing manifest.yaml` | 模板里残留**空目录**（git 不跟踪空目录，删文件不删目录），init 连空目录一起拷进工程，oj 把每个 api/src 子目录当模块 | 删模板里的空目录；cli ≥ 0.1.20 的 `copyTemplates` 已加空目录跳过防护（`dirHasFiles`） |
| `ojm api --check` 报 `routes.js 与契约路由表不一致——dist 缺：GET notifications/` | 契约侧 fullPath 对模块根路径带尾斜杠（`stripBase` 的 `rel || "/"` → `/notifications/`），dist pattern 无斜杠（`notifications`），键不等误报；且豁免原只过滤「dist 多」 | cli ≥ 0.1.20 已修：第三腿双侧尾斜杠规范化 + 豁免对「dist 缺/dist 多」对称过滤（回归测试见 `tests/cli/contract-check.test.ts`） |
| 手工改过 `openapi.json`（`del`→`delete`、operationId 改名）后 `--check` 漂移 | oj ≤ 0.1.72 的 `oj openapi` 产出非法 `"del"` 操作键 | 升级 oj ≥ 0.1.73（`del`→`delete` 归一）后删手工改动重生成；client 用原生 operationId 派生名 |
| `pnpm install` 卡死：20min+ 无 lockfile、`node_modules` 近空、pnpm 进程低 CPU 干等 | 直连 `registry.npmjs.org` 被限速（实测 ~18KB/s，单个 tarball 30s 下不完），pnpm 卡在元数据解析段 | 本机 pnpm store 已预热（装过同版本矩阵）时 `pnpm install --offline`，实测 1.6s 完成；store 不全时换镜像源或等限速恢复。**环境问题，非框架缺陷** |
| 新模块 `entry.ts` 被 `tsc` 拦：`TS2322 (ctx) => void 不匹配 (ctx) => Promise<void>` | `lifecycle.onInit` 签名要求返回 Promise；照抄老模块时容易漏 `async` | 写 `async onInit(ctx)`（范本：模板 `web/src/notification/entry.ts`；devkit SKILL「注册时机」红线已补明） |
| `ojm init` 报 `init.include.yaml 收录了不存在的路径：.gitignore`，工程只剩空目录 | npm/pnpm pack 剥离 `.gitignore` 点文件（npm-packlist always-exclude，`files` 字段绕不过）；include 白名单收录它 → 安装包缺文件 → `readInitInclude` fail-fast 在拷贝任何文件前中断。**演练盲区**：playbook 当时用源码树 CLI 演练，源码树里该文件存在故全绿——演练形态 ≠ 发包形态 | cli ≥ 0.2.6 已修：`.gitignore` 改由 init 现场生成（`ensureGitignore`，与 `pnpm-workspace.yaml` 同型），include 清单移除该条目；守卫：`tests/cli/release-manifest.test.ts` 逐条核对清单条目落在 tarball 内；演练按 §0.5 用本地 pack 的发布包 |
| 通知「全部已读」在 sqlite 开发库 500：`markAllRead` 用 `db.table(...).fromSelect(...).orIgnore()` | oj 0.1.81 在 sqlite 上 `orIgnore` 的 upsert 子句只跟随 VALUES，不支持 SELECT 源（实测 `orIgnore with fromSelect is not supported on sqlite`）——构造器无法表达「`INSERT OR IGNORE ... SELECT`」 | 退回裸 `db.exec("INSERT OR IGNORE INTO ... SELECT ...")`（sqlite `OR IGNORE` / pg `ON CONFLICT DO NOTHING` / mysql `ON DUPLICATE KEY` 三方言通用）；**`orIgnore` + `fromSelect` 组合在 sqlite 上不可用**，别用。上游需求见 §「向上游改进需求」F |

### 9.1 构造器迁移后的 L1/L2 边界与 vitest 190 红基线（2026-10-20）

**架构定论**：`db.table()` 构造器是 oj 二进制内的**纯 Rust 实现**，无 JS 模块可导出——Node 侧
（vitest 夹具）原理上垫不出真 `table()`，任何 JS 复刻都是会漂移的第二真相。两层测试因此定型：

- **L2（`tests/*.spec.ts`，vitest + node:sqlite 夹具）**：夹具 `g.db` 只给
  `{query, exec, tx, dialect}`（见 `tests/fixture.ts` 头注）。构造器面用**记录型假 builder**
  （记 `where/orderBy/limit` 调用序列做编排断言，样板 `query-utils.spec.ts` / `rbac-settings.spec.ts`）；
  真 SQL 执行断言走 `db.query` 直查内存库。
- **L1（`tests/*.test.ts`，`oj test` 收集）**：真 v8 + 真路由/鉴权 + 真迁移/seed/fixtures +
  真构造器，守 SQL 渲染/过滤/转义的真执行面（样板 `tests/l1-builder.test.ts`；方法论
  devkit `oj-test-guide.md`）。

**vitest 基线（2026-10-20，单一可复现命令）**：
`npx vitest run -c packages/cli/templates/api/vitest.config.ts --reporter=json` →
**190 failed | 409 passed (599)，19/33 文件**。按报错文本归类（判据：failure message 含
`table is not a function`）：**86 直接**（`db.table`/`tx.table` TypeError）+ **104 级联**
（89 AssertionError——handler 500 信封致 `data` undefined；13 其他 TypeError——undefined
读数；2 Error——lifecycle 步骤副作用断链）。**单一根因族**：模板 src 全面迁构造器后，
L2 夹具没有 builder 面。这是结构性欠账，**不是本轮新增回归**（迁移前同源码的红随迁移推进
等比扩大）。

**处置政策（逐条修复时按此分轨，勿整体 L2 化）**：

1. handler 对构造器的使用是** incidental**（真逻辑在别处）→ L2 化：记录型假 builder（见上样板）；
2. 行为**就是** SQL 渲染/过滤/转义 → 属 L1，补 `*.test.ts`（见上样板）；
3. 两条都不沾（纯 orchestration）→ 修夹具数据准备，不给 builder。

**L1 契约坑速查（本轮实测）**：

| 现象 | 原因与解法 |
| --- | --- |
| `client.get("/api/x")` 恒 404（日志 `/api/api/x`） | `client` 路径**相对 base**（base=`/api`），多写一层前缀即翻倍；正确写法 `client.get("/x")`。`client.login` 同理（内部 POST `/auth/login`） |
| `expect(...).toHaveLength is not a function` | L1 `expect` 只支持 `toBe/toEqual/toBeTruthy/toBeFalsy/toContain`（api-manual §9 契约）；改 `expect(x.length).toBe(n)` |
| 登录后打鉴权端点恒 403 `must_change` | seed admin 是 `must_change=1`（D12 生产语义），`currentAccess()` 悬挂期全拒；L1 用 fixtures 专用账号（`l1tester`，`must_change=0`，`src/_platform/fixtures/l1-test-user.sql`，仅 `oj test` 灌入、additive 不动 admin） |
| 口令正确却登录 401 `invalid credentials` | dev 库 admin 口令被首登改密流程改过（seed 重放 `INSERT OR IGNORE` 不复位既有行）；本地重置 `rm -f api/db.sqlite*` 后重跑（迁移+seed+fixtures 重建），或直接用 fixtures 账号 |
| 重复跑 L1 断言飘 | `oj test` 每轮重放 迁移→seed→fixtures 且 INSERT 类只增不改；断言按**自己推的行**收敛（push→拿回 id→按 id 断言，样板见 `l1-builder.test.ts` 通知用例） |
| 可选过滤传 `""` 仍发出 `= ''` 条件 | `whereIf` 跳过集是 `undefined/null/false/[]`，**`""`/`0` 是合法值会保留**（api-manual §whereIf）；缺失值必须归一化为 `undefined`（`oplog.ts` 2026-10-20 修复同款坑） |

## 10. 复跑脚本（TL;DR）

```bash
set -e
export VERIFY_DIR=/tmp/ojm-verify OJM_REPO=/Users/ever/git/only-js/oj-module
rm -rf "$VERIFY_DIR" && mkdir -p "$VERIFY_DIR" && cd "$VERIFY_DIR"
# §0.5 发布形态：pack → 解包 → 安装（演练与发包逐字节一致，防打包差异漏网）
export CLI_PKG="$VERIFY_DIR/cli-pkg"
pnpm --dir "$OJM_REPO/packages/cli" pack --pack-destination "$VERIFY_DIR"
tar -xzf "$VERIFY_DIR"/oj-module-cli-*.tgz -C "$VERIFY_DIR" && mv "$VERIFY_DIR/package" "$CLI_PKG"
pnpm install --dir "$CLI_PKG"
# npm 通道 oj 低于门禁时先预置（§0 旁路 1）：mkdir my-books/bin && cp ~/.local/share/oj/oj my-books/bin/oj
#   && cp -R ~/.local/share/oj/{devkit,plugins} my-books/bin/ && printf 'v0.1.74\n' > my-books/bin/.oj-version
node "$CLI_PKG/bin/ojm.mjs" init my-books --yes
cd my-books && pnpm install
./bin/oj --version
rm -rf /tmp/_oj_probe && mkdir -p /tmp/_oj_probe/src/web/hello \
  && printf 'export default { get() { json.ok({ ok: true }); } };\n' > /tmp/_oj_probe/src/web/hello/api.ts \
  && printf 'name: web\nversion: 0.1.0\n' > /tmp/_oj_probe/src/web/manifest.yaml \
  && ./bin/oj build -d /tmp/_oj_probe/src -o /tmp/_oj_probe/out   # §3 探针（坏二进制约在此 panic）
# …补 books 后端（.schema 入参 + 平级 .response 出参）→ ./bin/oj openapi -c api/config.yaml -d api/src -b /api -o openapi.json
#   → ojm api（+ --check）→ 补前端 →
node "$CLI_PKG/bin/ojm.mjs" build && npx tsc --noEmit -p tsconfig.json && node "$CLI_PKG/bin/ojm.mjs" dev
```

> 每次框架发版后跑一遍本文档，把 §「最近一次基线」更新为新版本与结果。
