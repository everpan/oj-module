# _platform 分发形态脑暴：源码 vs 编译 vs 机制护栏

> 日期：2026-10-19 · 状态：**第二轮评审完成，五裁决点已拍板（见 §7.12，优先级最高）**，待实施。§0～§5 为原始脑暴、§6 为第一轮五专家评审，均已过期；**实施以 §7 为准，§7 内部冲突以 §7.12 为准**。触发：oj-market 默认进脚手架后，_platform 以源码随 scaffold 下发，R29「第三方不得仿照/直呼特权面」只是约定，无法阻止开发者直接 import。
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

---

## 7. 第二轮开放性评审（2026-10-19 晚 · 本轮取代 §6，实施以本节为准）

> **为什么要重评**：上一轮五项裁决全部「五方一致、无分歧」，这个结果本身可疑——高度一致通常意味着讨论收敛过早或被首轮假设锚定。故本轮换了一组**视角完全不同**的专家（红队 / 开源治理 / 演化架构经济 / 发布运维 / DX），并强制：不许引用上一轮的论证链条，必须自行 grep 或 /tmp 实测取证；鼓励推翻问题定义本身。结果：**推翻了原来的问题定义，也推翻了 §6 的多数裁决**。
> 术语白话：下文的「别名」指 oj 支持的 `#/模块名/路径` 写法；`deps` 指模块清单里的「我依赖谁」声明；S003 / S008 是 oj 构建期的两类结构检查（表归属 / 依赖声明）；`ownership_guard` 是 oj 的运行期数据表所有权开关。

### 7.0 结论先行

| 问题 | 本轮结论（对比 §6） |
|---|---|
| 编译 / 闭源 / npm 包化分发 | **继续否决**，理由变了：cli 已公开发布到 npm 且包内含 templates，`_platform` 源码**已在公共通道上**（`packages/cli/package.json` license=MIT、publishConfig 公共、`files` 含 templates）。闭源对未来版本也只有名义收益，却要付「许可双轨」代价 → **净收益为负**（见 §7.9 的精确账） |
| 自研 import 扫描器（§6 的 C1） | **推翻**。oj 上游已内置同目标机制（别名 + 顶层 `deps` + S008 + `oj build --check`，实测 22ms），且本仓 manifest 里的 `deps` **早就写好了**，只是用了相对导入绕开它。自研 = 第三份「谁依赖谁」的事实源 |
| 把纪律做成 build 硬门（§6 裁决 2） | **推翻**。宿主用户的那份 `_platform` 是「冻结的 fork」（init 纯 skip + 全 CLI 无升级命令），对他既无管辖权、也无逃生通道 → 挂 fail-fast 是条件式死锁。真门改放 `ojm install`（第三方必经、本仓可改） |
| `_platform` 真正的风险 | **改了**：不是「第三方仿照」，而是 ①**补丁/升级通道断开**（修改类补丁到达率 0）；②**两处端点实际无 superadmin 门**（history / meta）；③**数据表边界裸奔**（第三方零 import 即可 `db.query` 读到 contacts 红线禁止的 email） |
| `FIRST_PARTY_MODULES` 常量（§6 裁决 4） | **推翻**。来源侧判定用路径谓词（`api/src/*` 自有 vs `api/modules/*` 安装产物），目标侧用 `_shared/index.ts` 收口；且第一方清单**已经存在且已被测试钉住**（`init.include.yaml` + `tests/cli/release-manifest.test.ts`），再建常量是同一事实的第二份 |
| C2 删 `web/src/_platform` | **保留**（§6.1 结论成立，独立复核：零消费者 + 是生成物）。是否保留 contacts 的 typed client 是本轮唯一未完全收敛的点，见 §7.10 |

### 7.1 本轮新发现的十条硬事实（决定取舍，编号接 §2 的 F1～F6）

| # | 事实 | 证据 |
|---|---|---|
| F7 | **上层机制已存在，且本仓已用了一半**：oj 支持 `#/m/x` 别名跨模块引用，缺顶层 `deps` 即构建期报 S008；`oj build --check` 跑 S001–S008 只要 22ms。但**祖父条款**：既有相对跨模块引用不追溯 → 本仓 36 行相对导入恒不被查 | devkit `api-manual.md:841-885`；/tmp 实验：别名 + 删 deps → S008 fail-fast；相对 + 删 deps → 照样 OK |
| F8 | **`deps` 声明早就就位**，缺的只是执行轨：auth / personal-center / system / web 四个模块的 manifest 顶层都已写 `deps: { _platform: ^0.1.0 }` | 各模块 `manifest.yaml` |
| F9 | **跨模块相对导入是上游一等公民写法，不是漏洞**：「跨模块相对导入……dev 下直接可跑；build 时改写为指向目标模块版本目录」→ §6 的「全禁」规则与上游语义正面对撞 | devkit `api-manual.md:883-885` |
| F10 | **依赖图是纯单向星形**：36 条跨模块边全部指向 `_platform`，反向 0 条、业务模块互导 0 条。目标导出面 8 个：respond 12 / access 10 / users 4 / roles 3 / audit 3 / settings 2 / rate 1 / oplog 1 | `templates/api/src` 全量 grep（两位专家独立复核、计数已对齐：36 条 / 14 文件 / 2 个源模块 / 8 个面） |
| F11 | **补丁通道确实断开，且比 §2-F5 更精确**：只有**新增文件**能到用户工程，**修改文件**永远不到。DB 迁移能到、读它的代码不能 → 一次「迁移 + 配套代码」的补丁会**确定性地制造开机失败**（oj 的 schema 漂移检查不放行，oj serve 直接退出） | `init.ts:246-249`；`build.ts:495-498`；/tmp 实验 |
| F12 | **真实的越权读：两处 market 端点没有 superadmin 门**。`market` 共 9 个端点、11 处 `assertSuperAdmin`；`history`（869-879）与 `meta`（737-747）**一处都没有**，仅靠「非匿名名单 + Bearer」。history 会返回方案名 / 版本 / 动作 / **操作者用户名** / 失败信息 → 任意登录用户可读全站安装史 | `market/api.ts` 逐端点核对（本文作者复核属实） |
| F13 | **文档称「双重校验」，代码里第二道门不存在**：DEVELOPER.md §7 写「assertSuperAdmin 独占 + module=market 已安装启用双重校验」，但 handler 里没有 enabled 前置校验（enabled 只用于对账显示，`market/api.ts:274-289`） | `docs/prd/solution/DEVELOPER.md` §7；`market/api.ts` |
| F14 | **真数据边界不在 import，在 `db` 全局原语**：第三方解决方案不 import 任何东西、不写 URL 字符串，只写 `db.query("select ... from users")` 就能拿到 email，组装期/运行期都已实测通过；且用户工程 `api/config.yaml` 无 `ownership_guard` 段（上游默认 warn）。**任何构建期扫描对此零覆盖** | /tmp 实测：build 退出码 0、运行时 200 且返回字段比官方出口还多一个 |
| F15 | **随包文档在教 R29 禁止的事**：每个用户工程都会收到 `.claude/skills/ojm-module-dev/manual.md`，其中 131-138 行是一张**明文教人跨模块 import `_platform/_shared`** 的路径表，且不区分第一方 / 第三方；`contacts.ts:4` 注释甚至写「solutions 同 isolate import searchContacts 直调」 | `docs/devkit/manual.md:131-138`；`api/src/_platform/_shared/service/contacts.ts:4`（本文作者复核属实） |
| F16 | **现有打包管线会静默剥离许可通知**（emit 后实测，本文作者复核）：入库产物 `packages/editor-standalone/dist/editor.js` 含 **128 处** `SPDX-License-Identifier: AGPL-3.0-only`（裸 JSDoc，无 `@license`/`@preserve` 标记）与 166 处 `@license`；真正随 cli 包对外分发的 `packages/cli/shell-dist/assets/editor.js` 含 **0 处 SPDX**、仅 6 处 `@license`。**结论：许可声明写进注释等于没写，必须落成 LICENSE 文件** | 两个产物逐字节比对；另 `packages/cli` 下五个包与 templates 的 LICENSE 文件 glob 均零命中，`grep -i license` 于 `npm pack --dry-run` 输出零命中（503 文件） |

### 7.2 问题定义被推翻：这不是「分发形态」问题

本轮四方从不同路径独立得出同一结论：

- **红队（威胁建模）**：守卫的实际受益者是**站点所有者本人**（守卫跑在他控制的机器上、规则常量在他的 CLI、豁免文件在他的工程），而站点所有者对 `_platform` 拥有完全所有权——他既能改它，也能把它停在旧版。**构建期 import 守卫对三类攻击者的安全收益全部为 0。**
- **演化架构（成本归因）**：真正会痛的是 `_shared` 的**签名漂移**（data-sharing 设计已登记为 AR-M4），正解是**收口导出面**，不是扫描禁止。
- **发布运维（补丁通道）**：`_platform` 修改类补丁到达率 0——这不是风险，是**已确定的事实**，且随每个新工程线性累积、无法统计、无法公告、无法验证修复率；而 §6 的五项裁决没有一条触及它。
- **开源治理（所有权）**：`_platform` 源码已随 MIT 的公共 npm 包分发，**已给出的授权不可收回**。真正该投入的是「让源码分发也能被审计」（哈希清单），成本比闭源低一个数量级。

一句话：**把源码变成黑盒，既挡不住有心人，也救不了躺在旧版的人。**

### 7.3 五位专家的原始立场（本轮）

| 专家视角 | 结论 | 最高优先级发现 |
|---|---|---|
| 红队 | 推翻问题定义，新缺口多于原议题 | 第三方模块被动态 import 进**同一 realm**，而 token 存在 localStorage（非 httpOnly）→ 第三方模块可读走超管 token；`market/history` 无门；文档给运维配 `fs: {root: "."}` 等于给每个已装方案发全工程读写权 |
| 开源治理 | 有保留通过，但优先级排反了 | `packages/cli/templates/` 下**无任何 LICENSE**（564KB 源码进用户工程零归因）；editor-standalone 的 AGPL 产物（5.1MB、不可重建）经 MIT 的 cli 包公共再分发 |
| 演化架构 | 推翻重写 | 上游 S008 + 别名 + deps 已存在，零自研零依赖就能开；TS Project References / eslint 边界插件在脚手架里均不可行 |
| 发布运维 | 推翻重写 | 补丁通道断开；「迁移能到、代码不能」会确定性制造开机失败；`ojm vendor` 对二进制有版本标记 + `--force`，源码侧是纯遗漏 |
| DX（/tmp 实测） | 推翻重写（有条件） | 守卫是**假门**（零 import 的 db 直读完全绕过）；随包手册在教禁止的事；DEVELOPER.md 触达率为 0（它根本不进用户工程） |

### 7.4 交叉质辩后收敛的修订方案

> 每个动作给「一句话 + 落点 + 投资」；用中文短名，方便排工期。

| # | 动作 | 一句话 | 落点 | 投资 |
|---|---|---|---|---|
| **A1** | **补 LICENSE 文件（五个包 + 模板）** | 564KB 源码拷进用户工程却不带许可声明，是正在进行的 MIT 归因违约；实测发布包 503 个文件里 **0 个 LICENSE**。**必须用文件承载，不能用注释承载**（见 F16：注释会被打包管线剥掉） | 新增 `packages/cli/templates/LICENSE`（让落地的脚手架自带）+ `packages/{cli,core,kit,runtime,editor-standalone}/LICENSE`；`init.include.yaml` 加 `- LICENSE`；`tests/cli/release-manifest.test.ts` 加断言 | 几个文件 + 几行，**bug 级，可立即合** |
| **A2** | **写脚手架基线文件（本地可读，不含回传）** | init 时把 cli 版本 + 每个模板文件的 sha256 写进工程根，让「这份 `_platform` 是哪个版本、有没有被改」第一次可被回答；同时作为「该不该编译」的前置测量。**明确定界：只做本地测量能力，不做 telemetry**——加回传等于为终止一场技术争论新开一个「数据离开用户工程」的合规面，不能顺手开 | `packages/cli/src/init.ts` 的模板写盘路径 + `ojm doctor` 输出 drift（未改动 / 已漂移文件清单）。aggregate 统计若真要做，另立议题并先过合规评估；零成本替代是 drift 状态随工单自然带出（样本偏但够判量级） | 最便宜，且**越晚做越贵**（晚一版就少一批可比工程） |
| **A3** | **改用上游依赖门禁（替代 §6 的 C1）** | 把 36 行相对跨模块 import 改成 `#/m/x` 别名，让 oj 的 S008 接管；`deps` 已存在，不用补。**实施坑（必读）**：`deps` 有两个命名空间——必须写**顶层 `deps:`**（oj 读，S008 消费），不是 `api.deps:`（ojm 的 C2 契约读，`preflight.ts:290`、`deploy-web.ts:45`）；写错则 S008 不会满足 | `templates/api/src/{auth,system}` 的 14 个文件 + CI 串一行 `oj build --check`（22ms） | ~36 行改动 + 1 行 CI，**零自研代码** |
| **A4** | **收口 `_shared/index.ts`** | 8 个导出面收成一个入口，消灭「能 import 什么」的目标侧清单；先收 respond+access+audit+rate（26/36），RBAC 四面向后放 | 新增 `templates/api/src/_platform/_shared/index.ts` + 改调用点 | ~2 天（收益是消灭清单，不是防越权） |
| **A5** | **删 `web/src/_platform` + 用 allowlist 停发** | 用「默认不生成、只显式放行」而非「黑名单屏蔽」或「整删」，避免将来新编排端点忘了进表就默认暴露 | `contract/run.ts` 与 `contract/check.ts`（**两者共用 `emitClient`，实测 ~15 行**）+ 删模板目录 + 白名单删一行 | ~15 行 + 删文件 |
| **A6** | **把 `ojm install` 做成真门** | 第三方解决方案**必经**这一步：其 manifest 声明依赖 `_platform`，或包内出现跨模块 import / 表归属赦免注释 → 需 superadmin 显式授权记录，否则拒装 | `packages/cli/src/install.ts` 与 lifecycle 的 preflight 环节（已有 manifest 契约校验管线） | ~1～2 天，是本轮唯一打到真实目标对象的门 |
| **A7** | **补 `ojm upgrade`** | 三态对比（模板哈希 / 工程当前哈希 / 基线哈希）→ 未改过的自动覆盖、改过的只报告；先铺通道，再谈任何形态变更 | 新增 `packages/cli/src/upgrade.ts` + `usage.ts` 一行 + 测试 | 需两版 CLI 见效（第一版只写基线） |
| **A8** | **修随包文档（本轮性价比最高的一条）** | 我们自己的手册在教 R29 禁止的事，而 DEVELOPER.md 的触达率是 0 | `docs/devkit/manual.md:131-138` 加「仅第一方」限定 + 新增「第三方可用端点」小节；改写 `contacts.ts:4` 注释 | ~32 行，**100% 触达每个新工程** |
| **A9** | **补 R9 门 / 改文档（二选一）** | `market/history` 与 `meta` 现在只要登录就能读；DEVELOPER.md 声称的「双重校验」在代码里不存在。**必须二选一，不许两头空** | `templates/api/src/_platform/market/api.ts:737-747、869-879`；`docs/prd/solution/DEVELOPER.md` §7 | 2 行代码，或 1 段文档 |
| **A10** | **发版纪律：迁移与代码成对到达** | 迁移能到用户工程、代码不能；A7 落地前禁止只发「需要配套代码」的新迁移 | CHANGELOG + 发布 checklist | 1 段话 |
| **A11** | **把「许可通知保留」做成有守卫的构建步骤** | 现有打包管线在保留许可通知上实测成功率 0/1（F16），任何新增产物形态都会复制这个缺陷。**修法已校正**：设 esbuild 的 `legalComments` **无效**（它只决定「已判定为 legal 的注释放到哪」，而上游那份是裸 JSDoc + SPDX，压根没进判定集——对照组可证：同一次构建下 lucide 的 `@license` 注释 161→1 保留，AGPL 128→0 全删），**必须走 banner 注入** + LICENSE 伴生文件兜底 | `packages/cli/shell/scripts/build.mts:151` 的 banner 钩子（`bundleShim` 定义于 :131，:197 **已有传 banner 的先例**）→ **在 :312 与 :325 两处补第 4 个 banner 参数**，内容写 AGPL 通知 + 源码获取要约；（**验收标准，不是措辞问题**：banner 必须带稳定的**源码获取指针**——上游仓库 + commit，即 A12 的 PROVENANCE 第 1 项。只写一行 SPDX 不卸责：AGPL §13 要的是源码获取途径，而该产物明确不可重建（`tests/global-setup.ts:8-9`），**「写了 AGPL 却给不出源码途径」比「不写」更糟**——性质从不知情变成明知而未履行） |`tests/cli/package-guards.test.ts` 加「产物必须含 AGPL 通知」守卫 | ~20 行，**不等法务，可立即合** |
| **A12** | **补 editor 产物的溯源文件** | 义务面不是「一个包」而是「一批上游文件」（128 处 Plane SPDX 头为证）；先把可陈述的事实写下来，法务结论后补 | 新增 `packages/editor-standalone/PROVENANCE.md`：构建者 / 源仓库与 commit / 上游版本与许可来源（注明「自述，待法务确认」）/ 内联依赖清单及其许可 | 1 篇文档 |

### 7.5 投资排序（两位以上专家独立给出的顺序一致）

| 档位 | 动作 | 买到什么 |
|---|---|---|
| **立刻（同一批，互不阻塞）** | A1 LICENSE 文件、**A2 基线文件（同时作「该不该编译」的前置测量，见 §7.9）**、A3 改用上游门禁、A8 修随包文档、A9 补 history 门、**A11 许可通知守卫 + banner 注入**、A12 溯源文档 | 止血 + 零自研地拿到一门可用的依赖门禁 + 停止自伤 + 把「许可保留」从 0/1 失败变成有守卫的步骤 + **为「是否编译」这场争论铺一条能被数据终止的路** |
| **下一版** | A7 `ojm upgrade`（此时才首次有基线可比）、A5 删 `web/src/_platform`、A6 install 授权门禁 | 补丁通道 + 真打到第三方的门 |
| **之后** | A4 收口 `_shared/index.ts` | 消灭目标侧清单，长期维护成本下降 |
| **不做** | 自研 import 扫描器（A3 取代）、`FIRST_PARTY_MODULES` 常量（路径谓词取代）、编译分发 / npm 包化（§7.0）、第一方模块整体切 dist（除非将来遥测显示用户修改比例高） | — |

### 7.6 对 §6 五项裁决的终裁

| # | §6 裁决 | 终裁 | 一句理由 |
|---|---|---|---|
| 1 | C2 = 删除 + 抑制再生成 | **保留，实现方式改为 allowlist** | 删的前提（零消费者 + 是生成物）本轮复核成立；但「黑名单屏蔽」会 fail-open、「整删」会误伤唯一合法的用户域端点，allowlist 兼得且成本同量级（~15 行，因 emit 与对账共用同一个生成函数） |
| 2 | 挂四点：build / bundle fail-fast、check 不可豁免 | **改写**：bundle=error，check=error 但**可豁免**，build=warn（三个前置满足后才升 error），dev=每次起动报告 | 无逃生通道的系统里，对无管辖权的主体施加 fail-fast = 条件式死锁；check 不给逃生门会让用户**整体关掉 check**，连带丢掉契约对账，净损失更大 |
| 3 | 跨模块全禁，仅放行 respond | **推翻** | 会先把自己 36 行打红；且相对跨模块 import 是上游支持的写法（F9）。改用上游 S008 的**模块粒度**规则 |
| 4 | 第一方清单 = cli 常量 + 双向断言 | **推翻** | 来源侧用路径谓词（`api/src/*` vs `api/modules/*`），目标侧用 `_shared/index.ts` 收口；那份清单**已经存在且已被 `release-manifest.test.ts` 钉住**，再建常量是同一事实的第二份 |
| 5 | 非第一方 URL 字符串 warn | **推翻** | 模板注释与 openapi.json 的 16 条 `_platform` 路径会把它淹成噪音；R9 已 fail-safe；且真正的通道连 URL 字符串都不需要（F14） |

### 7.7 对外依赖清单（上游 oj，本仓不改，只提诉求）

1. `ownership_guard` 默认值从 `warn` 改为 `deny`（当前用户工程的 config 里根本没这一段）——这是 F14 的真门；
2. `deps`（声明）与「授权」分离，例如新增 `grants:`（data-sharing 设计里的 D14 目前明确反对，需上游裁决）；
3. 表归属赦免注释（`/* oj:allow-table=... */`）提供全局禁用开关，否则一行注释就能绕过检查；
4. 确认第三方解决方案安装后的 api 落点与路由 discover 链路（本轮未追通）。

### 7.8 建议独立立项（不挂本文档）

| 事项 | 为什么独立 | 建议载体与 owner |
|---|---|---|
| editor-standalone 的 AGPL 产物经 MIT 的 cli 包公共再分发、对应源码不可得 | 唯一可能引来外部法律函；**本仓内无解**（产物自述不可重建）；与本议题正交。补充实证 F16：产物内原有 128 处 AGPL SPDX 头已被打包管线剥到 0 处，义务面不是「一个包」而是「一批上游文件」 | 独立决策记录 + issue；owner = 仓库 owner 决策 + 法务接口人复核（**不应指派 CLI maintainer，他改不了**）。需补 `PROVENANCE.md`（构建者 / 源仓库与 commit / 上游版本与许可来源 / **内联依赖清单及许可**） |
| 第三方模块被加载进同一 realm + token 存 localStorage | 这是真正的越权边界，本方案零覆盖；改动面跨 runtime 与宿主 | 单独安全议题（第三方隔离 / httpOnly / 短 TTL 轮换） |

**editor-standalone 补充实证（第二轮复核新发现，均为 2026-10-19 本机实测）**

| # | 不一致 | 实证 | 后果 |
|---|---|---|---|
| E1 | **包自述过期** | `packages/editor-standalone/package.json:5` 写「RichText / LiteText / Document 三种**非协作**编辑器」，但对外导出面是 **8 个**：除上述三个外还有 `CollaborativeDocumentEditorWithRef` 与 `OjRelayProvider`（见 `dist/editor.d.ts` 末尾 export 块）；产物内协作指纹实测 `yjs` 91 处（大小写不敏感）、`y-*` 15 处、`collaborat*` 43 处 | 自述的「再分发了什么」与实际不符，AGPL 语境下这会直接抬高合规尽调成本。`PROVENANCE.md`（A12）因此不能只写许可证，必须写**完整导出面 + 内联依赖清单** |
| E2 | **版本钉不齐** | `versions.json` 三份：`packages/cli/shell-dist/versions.json:13-14` 与 `apps/playground/web/dist/versions.json:13-14` 钉 `@plane/{kit,editor}` = **0.1.20**；`apps/playground-oj/web/dist/versions.json:13-14` 钉 **0.1.17**（连带 `@oj-module/runtime*` 也是 0.1.17） | 同一个 monorepo 里存在两套已落盘的 assets 世代。若将来以「版本号」作为 upgrade/patch 通道（A7）的依据，**这三个文件必须先对齐**，否则会按错误基线判定漂移 |

> **更正（诚实账）**：上一轮口头汇报中我把 E2 的载体说成「三份 `index.html` 钉版本」，**不准确**——`index.html` 里只有 `@plane/editor": "/assets/editor.js"` 这样的相对 importmap，不含版本号；真正的版本载体是 **`versions.json`**。同一条里的 yjs 计数偏差也一并更正：上一轮报的「yjs 125 / 65 处」取自不同 grep 口径，本轮统一为上面的单一命令口径。**进文档的数字以本表为准。**

### 7.9 诚实账（本方案不解决什么）

- **任何构建期手段都不解决 F14**：第三方零 import 的 `db.query` 直读，只有运行期表所有权（上游 `ownership_guard: deny`）能挡。本方案对真实数据边界**零覆盖**。
- **A3 不是授权门**：`deps` 是自声明的登记表，第三方自己写一行就能过关；实测靠一句表归属赦免注释同样能绕过。它买到的是「代码依赖可声明、可版本钉」，**买不到「谁有资格」**——后者只有 A6（install 授权门禁）能给。
- **A7 落地前，补丁通道仍断**：修改类补丁到达率仍是 0；此间发布需要配套代码的新迁移 = 确定性制造开机失败（A10 是这段时间的纪律替身）。
- **A8 是止血不是治疗**：它止的是「平台自己把人往墙上引」，零机制产出，不堵 db 直读。它是本轮**最便宜**的一条，不是**最重要**的一条。
- **闭源「净收益为负」的精确账**（本轮由红队自我驳回掉一条错误论证后收敛）：
  - 站得住的代价 = **许可双轨不可逆**：已发布的 MIT 源码副本撤不回，编译只对未来版本生效，永久存在「老副本是源码 / 新版本是产物」的不一致。这是对自己产生的、不可逆的义务。
  - 已被驳回的论证 = 「闭源会让攻击者 diff 出漏洞位置」。方向反了：源码分发时补丁就是一个公开 commit，攻击者拿到的是精确到行的 diff，**编译反而让他丢掉最精确的那张图**。
  - 补丁时间窗确实存在，但根因是**没有升级通道**（F11），在两种分发形态下完全相同，不该记到编译头上。
  - 第三条负项（已上机实证）= **打包管线静默剥离许可通知**（F16），实测成功率 0/1。中性地说，这不是编译的原罪，但它给了被测出来的基线：若将来选编译，必须同时做 A11，否则不是引入新缺陷，而是**把一个已存在的缺陷复制一份**。
  - **记账口径**：闭源的收益端只有 obscurity（抬高理解成本），按 Kerckhoffs 原则**不入账**——它可在可计入项打平时打破平局，不能用来 justify 成本。因此这个决策应由「许可 / 通知保留 / 可验证性」定音，**obscurity 不该进讨论**。
  - 第四条：还剩一个**账面更优但未被采纳的第三种解**——「给 `_platform` 加 DO-NOT-EDIT 文件头 + 一条 lint」能拿到编译的大部分收益，且不付任何负项。它与编译的差额（编译才有的、标注拿不到的）只剩两片：**机器驱动的非故意改动**（IDE rename-symbol / codemod / AI agent 批量重构不看文件头，但也不会去扫 `dist/`）与**噪声**（69+ 个文件进每个 grep、每份 review、每个 agent 上下文，标注不减噪、编译减噪）。因此诚实结论是「标注 + lint 单独做」**账面更优，但不是严格占优**。
  - **这个差额是可测的**：见 §7.5 —— A2 的基线文件落地后，直接统计「用户工程里 `_platform` 与基线不一致的比例」即可判定机器/随手改动是否真的在发生。**建议把 A2 从投资项升格为「该不该编译」的前置测量**，让这场争论第一次有能被数据终止的方式。
  - 上一条必须守住边界：**A2 只买「测量能力」，不买「比例」**。统计比例需要回传通道，而本仓没有 telemetry；为终止一场技术争论而新开一个「数据离开用户工程」的合规面是不划算的。故 A2 明确定界为「init 写基线 + `ojm doctor` 可读 drift，不含回传」，aggregate 统计另立议题并先过合规评估。

### 7.10 待你确认的裁决点

| # | 裁决 | 各方立场 |
|---|---|---|
| 1 | 采用上游 S008 替代自研扫描器（A3） | 五方收敛一致，无反对 |
| 2 | 宿主侧不挂 build fail-fast，真门放 `ojm install`（A6） | 演化架构 + 发布运维主张；DX **反对**（理由：目标是第三方方案工程，作者对自己的源码有完全编辑权，死锁推不到他身上）。建议处理方式见 §7.6-2：bundle=error、build=warn |
| 3 | C2 用 allowlist 保留 contacts 的 typed client，还是整删 | 演化架构主张 allowlist（防 fail-open）；治理与 DX 主张整删（零消费者，且该 client 是「一个工厂认领整个 `/_platform` 前缀」的形态，它自己的注释就把这判为反模式）。**本文倾向：整删 + 在随包手册给手写 client 片段**（更便宜、少一条维护路径） |
| 4 | `market/history` 与 `meta` 是补门，还是承认「只读观测面」现状并改文档 | 红队主张补门；代码注释显示是刻意设计。**必须二选一，不许两头空** |
| 5 | A1 LICENSE 与 A2 基线是否并入本议题 | 五方一致：先做，不依赖任何形态决策 |

> **以上五点已于 2026-10-19 拍板，结果见 §7.12**（该节为最高优先级，与本表推荐不一致处以 §7.12 为准）。其中第 5 点推翻了本表原推荐。

### 7.11 未收敛的分歧存档

- **迁移文件数量**：三方报告分别为 29 / 30 / 33，口径（是否含三方言展开、是否含 region 拆分）未对齐，本文不取单一值。
- **`platform.modules` 缺失是否会让新工程安装挂在 reloading 段**：红队据模板 config 与 devkit 手册推断会，但 DEVELOPER.md §9 称十阶段全绿，二者冲突，**未真机实证**。
- **用户实际修改 `_platform` 的比例**：无遥测。该数字决定 A7 的「已漂移」占比，也决定「是否要整体切 dist」——今天没有数据，故该形态不上线。
- **第三方方案的 api 目录在目标站点如何被路由发现**：本轮未追到完整链路。

### 7.12 用户裁决记录（2026-10-19 拍板）

> 本节记录用户对 §7.10 五个裁决点的答复。**优先级高于 §7.4 / §7.5 / §7.6 中与之冲突的任何表述**，冲突处一律以本节为准。

| # | §7.10 裁决点 | 裁决 | 落地口径 |
|---|---|---|---|
| 1 | A3 是否用上游 S008 替代自研扫描器 | **同意，采用 A3** | 36 行相对 import 改 `#/m/x` 别名（14 个文件）+ 写**顶层 `deps:`**（不是 `api.deps:`）+ CI 串一行 `oj build --check`。§6 的 C1 自研扫描器正式作废，维持 §7.5「不做」栏的原判 |
| 2 | build 是否 fail-fast、真门放哪 | **遵循 §7.6-2 建议** | host 侧：bundle=error、check=error 但可豁免、build=warn（§7.6-2 三个前置满足后才升 error）、dev 起动报告；真门 = `ojm install`（A6）。DX 方反对降级的意见记录在案未采纳，理由是「无逃生通道时对无管辖权的主体施加 fail-fast = 条件式死锁」。**保留触发条件：若 A7（upgrade）长期不落地，本条需重开** |
| 3 | contacts 的 typed client 是 allowlist 保留还是整删 | **整删**（采纳本文倾向） | 不给 contacts 开 allowlist 例外：删 `__client` 工厂里 contacts 的 3 个方法；在每个新工程的随包手册（A8 的同一落点）补一段手写 client 片段。与 §7.6-1 的关系不冲突——allowlist 仍是 `__client` 的生成口径，本次只是判定 contacts 不进表 |
| 4 | `market/history` 与 `meta` 补门还是改文档 | **补门**（不走文档侧） | 落 A9 上半条：`templates/api/src/_platform/market/api.ts:737-747`（meta）与 `:869-879`（history）各补一处 `assertSuperAdmin()`，与其余 11 处对齐。**遗留待议见下方「连带影响」第 3 条** |
| 5 | A1（LICENSE）与 A2（基线文件）是否并入本议题 | **不并入本议题** | 从 §7.5「立刻」档出列。连带后果见下方「连带影响」第 1、2 条 |

#### 连带影响（裁决落地的确定性后果，需一并记账）

1. **「该不该编译」重新失去被数据终止的路径**。§7.9 最后一条把 A2 基线文件定为这场争论的前置测量手段（「用户工程里 `_platform` 与基线不一致的比例」），A2 出列后该测量不成立。**本次不推翻 §7.9 编译「净收益为负」的结论**（它由许可 / 通知保留 / 可验证性三条独立支撑），但要承认：将来若有人重开编译议题，仍需另找测量方式。
2. **两条义务不随出列而消失**。A1 对应的是「564KB 源码进用户工程零归因」（F16 实测，`packages/cli/templates/` 下无 LICENSE）；A2 对应的是 F6/F11 的升级通道前提。**出列只是变更归属，不是取消事实**——本报告仍把它们列为未闭合项。
3. **第 4 项补门不解除文档校正义务**。`docs/prd/solution/DEVELOPER.md` §7 写的「assertSuperAdmin + module=market 已安装启用**双重校验**」，其中第二道在代码里不存在（grep `isEnabled` / `enabled ===` 零命中，`market/api.ts:274-289` 的 enabled 仅用于对账显示）。补一道之后的核对结果是：哪怕补完这道，那句描述依然不实。**建议随本次一并改准**（一行），否则等于保留一处已知不实描述——此项是 §7.10-4 之外新开的一条，待你确认是否纳入本次范围。

### 7.13 尚未拍板（本次未覆盖）

- §7.12 连带影响第 3 条的 DEVELOPER.md 是否一并改准；
- AGPL 再分发是否需要法务结论、owner 是否确定为「仓库 owner + 法务接口人」；
- §7.11 存档的四个未收敛项（迁移文件数量口径 / `platform.modules` 缺失是否卡 reloading / 用户修改比例无遥测 / 第三方 api 目录的路由发现链路）。
