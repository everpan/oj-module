# _platform 分发形态脑暴：源码 vs 编译 vs 机制护栏

> 日期：2026-10-19 · 状态：**评审完成，待用户确认后实施**（§0～§5 为原始脑暴，§6 为五专家评审后的方案修订——**实施以 §6 为准**）· 触发：oj-market 默认进脚手架后，_platform 以源码随 scaffold 下发，R29「第三方不得仿照/直呼特权面」只是约定，无法阻止开发者直接 import。
> 关联：docs/prd/solution/DEVELOPER.md §7（R29）、docs/plans/2026-10-19-module-data-sharing-design.md §3.5（前端直连查证）。

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 编译分发能挡住什么？ | 只能挡「读源码/拷实现」。**挡不住越权**（特权端点已有运行时门：R9 `assertSuperAdmin` + market 保留名），也挡不住「对着 HTTP 面仿照调用」——fetch 不需要 import 你的源码 |
| api 侧编译分发可行吗？ | **不可行**。auth/system/notification/personal-center 等第一方模块合法地 `import "../_platform/_shared/*"`（respond / access / audit / settings），_platform 无源则它们集体编译不过；连它们一起编译 = 整个宿主后端闭源，脚手架「可读可定制」的根基没了 |
| web 侧编译分发可行吗？ | 可行但**收益极小**：web/src/_platform 只有 `__client`（生成的 client + schemas），消费者只有 oj-market；而真正的风险通道（全局 request 直调 `/api/_platform/market/*`）是 HTTP 层的，编译源码挡不住字符串 URL |
| 推荐方向 | **源码保留 + 机制护栏 + 合法出口**：① ojm 守卫扫描 import 图（非第一方模块 import `_platform` 即报错，口径同 `ojm api --check`）；② web 侧把 `_platform/__client` 收进 oj-market（唯一消费者，特权 client 特权模块自带）；③ 「第三方真的需要跨模块调用」走 data-sharing 设计已规划的 v2 直连轨（`api.exports.endpoints` + 披露），让绕行失去动机 |

## 1. 问题拆解：三个被混在一起的风险

| 风险 | 现有覆盖 | 编译分发能补吗 |
|---|---|---|
| **越权**（第三方调特权端点装/卸方案） | 已有运行时门：`/api/_platform/market/*` = assertSuperAdmin 独占 + module=market 已装启用双校验（R9 门）；`market` 是保留名（C2-01）；isolate + RBAC 隔离 | 不能——门不在源码可见性上。而且「能 import 源码」≠「能过运行时门」 |
| **耦合**（import `_platform/_shared` 内部实现，升级即碎） | **零机制**——这是真实的未覆盖面 | 能挡 import，但代价是把合法第一方 import 一起打死（§2 F1） |
| **仿照**（读 oj-market/_platform 实现后照抄编排调用） | 仅文档约定 + 代码注记（R29）；DEVELOPER.md §7 已写明误用失效形态（superadmin 下「看起来能用」） | 不能——HTTP 调用面可从网络面板观察，无需源码 |

关键认知：**「直接 import」在这套体系里只发生在构建期**（oj build 以模块目录为单位 esbuild 打包进 `dist/<name-ver>/routes.js`，运行期没有跨模块 import 可拦）。所以问题本质是构建期依赖纪律 + HTTP 调用纪律，不是「源码保密」。

## 2. 关键事实（决定取舍）

- **F1 · 合法跨模块 import 是既有模式**：`auth/api.ts → _platform/_shared/respond`、`auth/_shared/session.ts → _shared/service/{access,audit}`、`system/settings/api.ts → respond + service/{access,settings}`。第一方模块间源码级依赖是脚手架的显式设计，不是漏洞。
- **F2 · web/src/_platform 极薄**：仅 `__client`（api.ts / api.schemas.ts，生成物），无 entry/无 UI；唯一消费者是 oj-market（R29 注记即在此）。
- **F3 · 编译分发有先例但仅限第三方**：市场安装的方案包就是编译形态（`manifest.yaml + routes.js`）；宿主自带模块（含 _platform）全是源码。
- **F4 · 脚手架无 lint 基建**：模板不带 eslint 配置；但 ojm 有 `ojm api --check`（openapi ↔ __client ↔ init 三方对账）这类「自带守卫」传统，扫 import 图是同一挂法。
- **F5 · 升级通道现状**：init 幂等补缺（已存在文件跳过）——用户工程里的 _platform 源码**今天就没有升级机制**（改过不覆盖、没改也不更新）。这是源码分发的更深问题，但编译分发同样不解决（dist 同样被跳过）。
- **F6 · 合法需求有既定出口**：data-sharing 设计已把「第三方 → _platform 直连」评估否决（合法目标太窄），真正的需求走 v2 直连轨（`api.exports.endpoints` + `api.direct` + 分发定夺 + 安装披露）。

## 3. 方案与评估

### A. api 侧编译分发（init 只拷 _platform 编译产物 + 对外 d.ts）

- 优：物理上挡住 `import _platform/_shared`；用户改不了特权实现。
- 劣（致命）：
  - F1 连锁：auth/system/... 集体编译不过；救法 = 第一方模块也编译 → **整个宿主后端闭源**，与「脚手架 = 可读可定制的起步工程」冲突；
  - dev 流需要重建产物管线（ojm dev / oj build 对 dist 与 src 的混排语义要新设计），改动面横跨 cli + oj；
  - 审计性归零：用户无法读 _platform 知道自己的站点在跑什么。
- 判定：**否**。代价与目标（防耦合/防仿照）完全不成比例。

### B. web 侧编译分发（`_platform/__client` 只发编译产物）

- 优：技术可行（无 UI、消费者单一），顺带挡住「copy 生成 client 改改就用」。
- 劣：收益小——风险通道是 HTTP（全局 request 直调），编译源码不减少可观察的调用面；且 oj-market 仍要 import 它，引入「特权 client 只给特权模块」的分发规则，机制成本 > 收益。
- 判定：**降级为 C2 的附带项**（见下），不单独做。

### C. 源码保留 + 机制护栏（推荐主轨）

- **C1 · ojm import 图守卫**（新增，口径同 `ojm api --check`）：
  - 规则：`api/src` 与 `web/src` 下，**非第一方清单模块**（清单 = scaffold 白名单同源：_platform、auth、system、notification(s)、personal-center、web、oj-market）出现 `_platform` 相对导入即报错，附人话指引（「特权面走契约声明，跨模块调用走 v2 直连轨/契约分发」）；
  - 挂点：`ojm api --check` 顺手扫（已有三方对账管线），CI/本地零新增命令；
  - 成本：grep 级实现，百行内；无误报面（规则就是字符串前缀）。
- **C2 · web 特权 client 收权**：`_platform/__client` 移入 `web/src/oj-market/`（唯一消费者自带），`web/src/_platform` 从脚手架与模板中消失——特权调用面不再作为「公共设施」暴露，R29 从约定变成物理事实。附带解决 B 想解决的问题。
- **C3 · 合法出口（既定）**：v2 直连轨落地后，「我确实需要调 XX 端点」有正路（契约声明 + 披露），绕行动机消失——护栏+出口才是完整闭环，只堵不疏会催生 fetch 字符串绕过（护栏拦不住，也不该假装拦得住）。

### D. npm 包化（_platform 发私有 registry，编译形态，工程以依赖引用）

- 优：版本化升级通道（F5 顺带解决）、物理隔离。
- 劣：需要 registry 基建与访问控制；与市场分发模型（方案包经 oj-market 安装，不走 npm）并行再养一条包管理线；init 的 package.json 生成从「钉版 devDeps」变为「运行时依赖 _platform」——宿主升级语义全变。
- 判定：**否**（基建与模型成本远超本问题体量；若未来真要做宿主升级通道，应整体规划而非搭本问题的便车）。

### E. 维持现状（约定 + 文档）

- 与 data-sharing §3.5 口径一致：「前端只调自己后端」是对第三方的目标形态，第一方特权面靠约定共存。
- 单独成立的前提是接受「耦合零机制」。本次 oj-market 默认下发让特权调用面在每个新工程都可见可 copy，暴露面变大——**建议至少加 C1**。

## 4. 推荐组合与排序

| 步骤 | 内容 | 成本 |
|---|---|---|
| ① C1 | ojm import 图守卫（`api --check` 附带扫） | 百行级，一个 PR |
| ② C2 | `_platform/__client` 收进 oj-market，删 web/src/_platform | 小；oj-market 与模板同步改 |
| ③ C3 | 等 data-sharing v2 直连轨（已有设计，不重复立项） | 已规划 |
| 不做 | api 侧编译分发（A）、npm 包化（D） | — |

诚实账：C1/C2 落地后，**恶意仿照（对着 HTTP 面抄）依然拦不住**——那是 R9 运行时门的职责（非 superadmin 一律 403，失效形态已在 DEVELOPER.md §7 写明）；护栏的目标是让**无意耦合与无意识 copy** 在开发期就报错，而不是承诺防住有心人。

## 5. 未决点

1. C1 的第一方清单与 init.include.yaml 的单一事实源（同一份 yaml 还是复制清单）——建议 init.include.yaml 增加一节 `firstPartyModules`，两边共读。
2. C2 是否同步收 `api/src/_platform` 的对外契约面（contacts 等用户域端点是**要**开放的，不能收）——需逐端点分类：特权编排面（market/lifecycle）vs 用户域（contacts/notification list）。
3. 存量工程（0.2.8 之前 init 的）没有守卫——C1 若做成 `api --check` 的一部分，存量升级 cli 后自然获得，无需迁移。

---

## 6. 专家评审记录与方案修订（2026-10-19，实施以本节为准）

五位专家独立评审（架构师 / 安全工程师 / 产品经理 / 工程师 / 体验官，均为只读评审、grep 实证后下结论）。**结论一致：有保留通过**——C1 方向与编译分发/npm 化的否决判断成立；C2 的事实前提已过期须改写；C1 挂点与规则粒度需修正。以下为修订后方案，**未实施**。

### 6.1 全票修正：C2 改写为「删除 + 抑制再生成」

评审实证推翻本文 §2-F2：「web/src/_platform/__client 唯一消费者是 oj-market」**不成立**——模板全树零文件 import 它；oj-market 自带手写 DIP client（client.ts 拼 URL，data-sharing §3.5 本就自证「非 __client 生成」）。且该目录是 ojm api 的**生成物**：contract/run.ts 的 emit 循环按 openapi.json 模块全集逐个写 web/src/<模块>/__client，check.ts 对账循环对缺失报 artifact-stale——只删文件会被 ojm api 原样复活、--check 报假过期。

修订后 C2（四步，不动 oj-market）：

| # | 动作 | 落点 |
|---|---|---|
| 1 | emit 与对账两侧共享 EMIT_CLIENT_SKIP_MODULES = ["_platform"]，跳过 web client 发射与生成物核对 | contract/run.ts emit 循环 + contract/check.ts 对账循环 |
| 2 | 删模板目录 web/src/_platform | packages/cli/templates/ |
| 3 | 白名单删 web/src/_platform 行 | init.include.yaml |
| 4 | openapi.json 的 _platform 端点**保留**（route 双向对账与 stub 规划仍需要） | 不改 |

特权面叙事随之更干净：**_platform 不暴露任何前端生成 client**，而非「特权 client 特权模块自带」。

### 6.2 C1 修订：挂点、粒度、匹配、清单

**挂点（四消费点，同一扫描函数）**——只挂 api --check 对第三方是自愿守卫（评审实证：DEVELOPER.md 全文没让方案作者跑它；dev/build 流程均不调它）：

| 消费点 | 级别 | 理由 |
|---|---|---|
| ojm build | **error，fail-fast** | 主门：esbuild 会把跨模块 import 静默内联进 routes.js，build 是唯一自然拦截点 |
| ojm build --bundle（bundle.ts） | **error，fail-fast** | 第三方发布必经关口，沿用「构建即校验」模式 |
| ojm api --check | error kind boundary-import（新增，**不读 .ojm-api-exempt.json**——豁免文件语义是契约对账降级，不得扩权到纪律项） | CI 口径 |
| ojm dev 起动 | **warn 一次** | 最早反馈，不打断热更开发 |

**规则粒度**：从「import _platform」泛化为「**非第一方模块的跨模块源码 import 一律 error**」（现网非 _platform 第一方模块间零互导，同成本多挡 auth/_shared、system 内部等同级耦合）——但设**显式放行清单** _platform/_shared/respond：devkit 手册 §1.7-1 明文教所有 handler 用 respond() 收口错误信封，全拦会打断文档化流程、把守卫变成人人绕过的假门（体验官发现，产品/工程师附议）。

**匹配方式**：只认 import 语法位置（from "..." 静态与 export-from / 副作用 import "..." / 动态 import(...) / require(...)），相对路径归一后测目标模块；**禁子串扫描**——模板注释与 URL 字符串大量含 _platform 字样，裸 grep 全误报（评审实证）。无路径别名（模板 tsconfig 无 paths），无需别名解析。第二级：非第一方模块源文本出现 /api/_platform（或 /_platform/）URL 字符串 → **warn**（提示特权编排面不可仿照，注释不算）。

**扫描根**：api/src/<模块>/ 与 web/src/<模块>/ 模块目录内 .ts/.tsx（api/tests 合法引用 ../src/_platform，根限定避免误报）；不扫 api/modules（站点侧安装产物，宿主扫描无意义）。

**第一方清单单一事实源（裁决，原未决点 1）**：packages/cli/src/contract/first-party.ts 导出 FIRST_PARTY_MODULES = { api: [_platform, auth, notification, notifications, personal-center, system, web], web: [auth, login, notification, notifications, oj-market, personal-center, system, web, demo, home] }；release-manifest.test.ts 加双向断言（常量 ↔ include 收录的 api/src/*、web/src/* 顶层目录逐一对齐）防漂移。**弃「yaml 加 firstPartyModules 节两边共读」**：守卫在用户工程 cwd 运行，init.include.yaml 是模板自用元数据不进用户工程，dlx/pack 形态下回读 ojm 包内模板资产脆弱（架构师裁定，工程师/体验官附议）。

**报错文案（三段式，共用一份常量）**：① 越了什么界（文件:行、模块、import 描述符）；② 现实出路：数据/界面/权限走 manifest 契约声明（DEVELOPER.md §4），背景与失效形态 §7 R29；③ 跨模块直连走 data-sharing v2 直连轨（**标注「规划中」**，不给死链体验）。usage.ts 「四重对账」→「五重对账」。

### 6.3 配套（低优先级，随实施带上）

- DEVELOPER.md §7 从「警告」升级为「规则 + 守卫行为」小节（何时报、报什么、**明确不设豁免阀**，真需求等 v2）；§8.1 打包步骤前加「发布前必跑 ojm api --check」；
- api/src/_platform/manifest.yaml 加端点分类注释表：用户域（contacts，登录即可，第三方可合法 HTTP 调用）vs 特权编排面（market/*、生命周期，仅 superadmin）——供守卫文案与 v2 直连轨引用（原未决点 2 最小落法）；
- CHANGELOG 记新 error kind（方案作者升级 CLI 后首次 CI 见红不至于懵）；
- 诚实账写死：守卫只拦**构建期 import**，不拦 fetch 字符串直呼（该通道由 R9 运行时门兜底）；--check 绿 ≠ 边界安全——写进 §7 与 --check 通过输出。

### 6.4 待用户确认的裁决点

| # | 裁决 | 评审立场 |
|---|---|---|
| 1 | C2 动作 = 删除 + 抑制再生成（非「收进 oj-market」） | 五方一致，无分歧 |
| 2 | 守卫挂四点：build fail-fast / bundle fail-fast / dev warn / check CI（error，不可豁免） | 工程师+体验官主张，架构师附议；无反对 |
| 3 | 跨模块 import 全拦，**仅放行 _platform/_shared/respond** | 体验官提出（手册 §1.7-1 教学依赖），安全工程师原主张全拦——折中裁定 |
| 4 | 第一方清单 = cli 常量 + release-manifest 双向断言（弃 yaml 共读） | 架构师裁定，体验官附议；工程师/安全工程师原主张 yaml 节 |
| 5 | 非第一方模块 URL 字符串 warn（不阻断） | 安全工程师主张；无反对 |

### 6.5 评审原始立场存档

| 专家 | 结论 | 最高优先级发现 |
|---|---|---|
| 架构师 | 有保留通过 | C2 会被 emit/check 管线复活；清单用 cli 常量+测试锚定；规则泛化为跨模块全禁 |
| 安全工程师 | 有保留通过 | C2 是生成物须停发；新 kind 不得读豁免清单；端点分类表进 manifest 注释 |
| 产品经理 | 有保留通过 | C2 改「删除+防再生成」；守卫打不中方案作者（DEVELOPER.md §8.1 补必跑）；文案三段式不诺死链 |
| 工程师 | 有保留通过 | C1 须同挂 bundle（泄漏通道在 esbuild 内联进 routes.js 入包）；匹配限定 import 语法位；扫描范围查证 |
| 体验官 | 有保留通过 | api --check 无人主动跑，主门挂 build + dev warn；respond 放行否则假门；清单须 cli 常量（yaml 不进用户工程） |
