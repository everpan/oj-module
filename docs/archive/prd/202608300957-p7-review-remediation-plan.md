# P7 评审整改计划（框架 npm 包化）

> 创建时间: 2026-08-30 09:57
> 来源: `202608300957-review-report-framework-npm-package.md`（评审报告，编号 S*/F*/P* 逐条追溯）
> 基准: `202608291025-framework-npm-package-design.md`（D*/B*/C*/US*/R*）、`module-development-guide.md`
> 分支: `feature/pkg-p7-review-fixes`（自 modularization 切出）
> 方法: TDD——每项先补失败用例，再实现；完成判据 = 用例通过 + 报告对应条目闭环

## 任务表

| # | 任务 | 来源 | 完成判据 | 状态 |
|---|------|------|----------|------|
| P7.1 | trust.ts 改 `new URL(url, location.origin)` 归一化比对；显式拒绝 `//`、`data:`、`blob:` | S1 | tests/trust 新增绕过用例（协议相对/反斜杠/data/blob）全拒绝 | ✅ 完成（协议相对/反斜杠/data/blob 用例全拒绝） |
| P7.2 | scoped.ts：URL 归一化后按段匹配；剥离逐请求 options 中的 prefix/prefixUrl | S2 | 三绕过用例（兄弟前缀、`../`、逐请求 prefix）全拒绝 | ✅ 完成（4 组绕过用例全拒绝） |
| P7.3 | entry 并入 chunks[]（lazy:false）走同一 modulepreload+integrity 链路；设计文档回写「动态 import 无法携带 SRI」机制缺陷 | S3 + 报告§已排除 | modules.json entry 出现在 chunks 且 preload 覆盖；设计文档 §4.7/US-6 已修订 | ✅ 完成（entry 入 chunks + §4.7/US-6 回写） |
| P7.4 | CSP trustedOrigins 同步进 style-src/connect-src；iframe 白名单补 condorheroblog.github.io；新增一致性测试 | S4/S5 | 一致性测试红→绿 | ✅ 完成（tests/iframe-whitelist-consistency.test.ts） |
| P7.5 | CI 增加 test job；ci.yml 分支触发器改 `[main, modularization, feature/*]`；no-fake-in-dist 测试去掉静默 skip | S6/P1 | workflow 含 pnpm test 且顺序正确；测试在产物缺失时失败 | ✅ 完成 |
| P7.6 | peerRuntime 校验落地：加载前 semver satisfies 比对，不兼容→显式人话报错 | F1 | US-5 场景测试通过 | ✅ 完成（最小 satisfiesSemver + p7-module-contracts 测试） |
| P7.7 | host.tsx 停止裁剪清单：原样透传 enabled/dependencies/peerRuntime/integrity/chunks/css | F2/F3(部分) | enabled:false 模块不被加载 | ✅ 完成（toLoaderManifest 全字段透传 + 测试） |
| P7.8 | module-loader 新增 `status: "missing-deps"`：依赖缺失跳过生命周期与路由注册 | F3 | US-9 依赖缺失场景测试通过 | ✅ 完成 |
| P7.9 | 构建期卡口：模块产物裸说明符必须 ⊆ importmap 键集合（深路径报错；尾斜杠前缀键经评估不改 importmap，见执行小结） | F4 | `dayjs/plugin/utc` 用例构建期即报错 | ✅ 完成（assertResolvableSpecifiers 构建期报错 + C8 告警） |
| P7.10 | shell 取消 private + publishConfig；build-modules.ts 失败 exit(1) | F5/F8 | shell pack 可行；构建失败退出码非 0 | ✅ 完成（翻转 P6.6 决策，测试已注记） |
| P7.11 | CLI 新增 `ram info`；create-module 包降级决策（D-P7-1），文档矛盾消除 | F6 | ram info 输出可用 | ✅ 完成（ram info + US-1 改述 playground 拷贝） |
| P7.12 | runtime 入口补导出 unloadModule/useSlotNodes；requiredPermissions 实现 | F7 + 次要项 | 出口全部可 import；requiredPermissions 有过滤测试 | ✅ 完成 |
| P7.13 | create-module 模板重写为现行契约；修 hasI18n=n ENOENT；加模板快照测试 | F9/F10 | 向导两种选择均产出可构建模块 | ✅ 完成（tests/create-module-template.test.ts） |
| P7.14 | 框架内置 /exception/403\|404\|500 core 路由兜底，exception 模块降级为可选覆盖 | F11 | 禁用 exception 模块后 403/500 跳转正常 | ✅ 完成（ensureBuiltinExceptionRoutes + 测试） |
| P7.15 | 契约断言层：CLAUDE.md 架构路径改写；lazy chunk 构建期提示；模块 CSS insertBefore；`ram merge` 接线；死分支与过时注释清理；深路径版本比对取包名 | F2/P2-P5 + 次要项 | 全部落地 | ✅ 完成（含 prod manifest.json 消费链路 P5） |
| P7.16 | 文档回写：设计文档 §4.7/US-6、手册同步 P7 行为变化、交接手册补 P7 章节、本计划回填 | 报告§改进意见 | 文档与实现一致 | ✅ 完成 |

## 关键 BDD 验收场景

```gherkin
Feature: D10 来源白名单不可绕过（P7.1）
  Scenario Outline: 恶意 entry URL 被拒绝
    Given 宿主 moduleOrigins = ["https://modules.cdn.example.com"]
    When 清单 entry = <url>
    Then assertTrustedModules 抛错并提示来源未登记
    Examples:
      | url                                |
      | //evil.com/entry.js                |
      | https:\\evil.com\x.js              |
      | data:text/javascript,alert(1)      |
      | blob:https://x.com/1               |

Feature: scoped request 收敛不可绕过（P7.2）
  Scenario: 兄弟前缀越界
    Given 已登记 apiPrefix "/sys"
    When 请求 "/sysadmin/users"
    Then 抛「请求越界」错误
  Scenario: 路径穿越
    When 请求 "/sys/../admin/x"
    Then 抛「请求越界」错误
  Scenario: 逐请求 prefix 覆盖
    When request.get("/sys/x", { prefix: "https://evil.com" })
    Then 抛错且请求不发出

Feature: 清单字段透传与版本门禁（P7.6/P7.7）
  Scenario: enabled:false 不加载
    Given modules.json 中 order.enabled = false
    When 宿主加载
    Then order 不进入 loadAll，路由/菜单不出现
  Scenario: peerRuntime 不兼容显式失败
    Given 宿主 runtime "1.2.0" 且模块 peerRuntime "^2.0.0"
    When 宿主加载
    Then 该模块标 error，提示含模块名/期望/实际版本

Feature: 依赖缺失不半加载（P7.8）
  Scenario: B 加载失败时 A 标 missing-deps
    Given A.dependencies = ["B"] 且 B 加载失败
    When loadAll 执行
    Then A.status = "missing-deps"，A 不执行 onInit、不注册路由
    And 提示包含缺失依赖名 "B"
```

## 风险与决策记录

| # | 事项 | 决策 |
|---|------|------|
| D-P7-1 | create-module 独立包（US-1 npm create） | 本期降级：不做独立包，手册改述为「复制 apps/playground 起步」；脚本 scripts/create-module.ts 修复后仅供 monorepo 内使用 |
| D-P7-2 | 动态 import 无法携带 SRI | 回写设计文档：L2 入口保护改由「entry 并入 chunks 全量 modulepreload+integrity + 加载前 fetch 校验」组合，US-6 表述修订 |
| D-P7-3 | 静态 CSP nonce | 维持构建期 nonce（静态托管约束），在设计文档 §4.8 补注取舍理由 |

## 执行小结（回填）

**执行时间：2026-08-30，评审（含报告）约 2.5h，整改约 3.5h，合计约 6h。**
16 个任务全部完成，分支 `feature/pkg-p7-review-fixes`（3 个代码提交 + 1 个文档提交）。
收尾全量：209 用例绿，`tsc --noEmit` 0 错误，lint 0 错误，`pnpm build` 通过。

### 关键过程

1. **评审先于整改**：先把 41 条原始发现去重为 36 项、逐项置信度打分（22×75 / 10×50-60 / 40 / 20），
   报告归档后才规划任务——避免「边改边发现」导致的范围失控。
2. **根因归一**：9/22 确认问题同根——「文档承诺了但实现漂移」（peerRuntime、requiredPermissions、
   ram info/merge、深路径报错均只存在于纸面）。整改主线因此是**给每条承诺补测试卡口**，
   而非逐条打补丁。
3. **TDD 落地**：每个修复先有失败用例（shell-trust 绕过组、scoped-request 绕过组、
   p7-module-contracts 20 例、iframe-whitelist-consistency 等），再实现到绿。

### 执行中的偏差与修正（相对本计划初稿）

- **P7.9 方案收窄（反常规问题记录）**：初稿要求 importmap 补 `包名/` 尾斜杠前缀键。
  经查 importmap 规范，尾斜杠键只做路径前缀映射，指向 dist **目录**会导致子路径解析出
  不存在的文件——收益不抵复杂度。最终只做「构建期卡口」半边：`assertResolvableSpecifiers`
  对产物真实 import 分析，深路径裸说明符构建期报错。判据「构建期即提示」达成，前缀键不做。
- **P7.10 翻转历史决策**：P6.6 曾有意将 shell 设为 `private: true` 并写入测试；但 §4.1
  的外部工程链路（ram dev/build 从 node_modules 取 shell dist）要求 shell 可发布。
  两处冲突以「shell 可发布」为准，原测试改注记说明翻转原因。评审报告编号 F5。
- **P7.14 实现方式微调**：内置异常页组件用 antd Result + createElement（`.ts` 而非 `.tsx`），
  规避 react-refresh/only-export-components 规则对「同文件导出路由数组 + 组件」的限制。
- **blob: URL 的信任绕过（执行中新发现）**：`new URL("blob:https://...").origin` 会解包出
  内层 origin 骗过白名单——归一化后必须显式校验 protocol ∈ {http, https}。

### 新增决策

D-P7-1/2/3 见上表，均已写回设计文档与手册。其中 D-P7-2（动态 import 无法携带 SRI）
属浏览器机制层面的硬约束，设计文档 §4.7 完整性表与 US-6 表述均已修订，
「拒绝执行」语义明确降级为「预载拒绝 + 可观测」，真正拒绝执行需 L3 SW。

### 问题分类汇总（按仓库约定）

- **反常识**：动态 import() 无法携带 integrity（W3C 现状）；importmap 无前缀通配（尾斜杠键≠通配）。
- **反常规**：ky 2.x 允许逐请求覆盖 prefixUrl，使 scoped client 形同虚设（已堵）；
  `blob:` URL 的 origin 解包行为（已堵）。
- **与业界不符**：P6.6 将对外消费链路上的 shell 包设 private（已翻转）。
