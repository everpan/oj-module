# _platform 分发形态脑暴：源码 vs 编译 vs 机制护栏

> 日期：2026-10-19 · 状态：脑暴（未实现） · 触发：oj-market 默认进脚手架后，_platform 以源码随 scaffold 下发，R29「第三方不得仿照/直呼特权面」只是约定，无法阻止开发者直接 import。
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
