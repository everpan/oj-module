# ojm build 明确列出用户方案摘要

日期：2026-11-03 09:25 · 分支：`feat/build-solution-summary`（并入 feat/ojm）

## 1. 背景与问题

`ojm build`（无 `--bundle`）逐模块打印 `[ojm] 构建 <name>@<version> ...`，用户方案与框架自带模块
（home/login/…）混在一起。用户看完构建日志搞不清：**我的方案到底构建进去了没有？接下来能不能直接
打包？** 要等到 `ojm build --bundle` 报「缺少本方案的站点产物」才发现方案根本没进构建
（web.config.ts 未登记 / `enabled: false` / 缺方案契约），发现太晚。

## 2. 目标 / 非目标

**目标**：`ojm build` 结束时追加一段**用户方案摘要**，一眼回答「哪些方案可打包、哪些没进构建」。

**非目标**：
- 不改变 `--bundle` 路径的既有输出（逐包已列名 + 共打包 N 份）；
- 不做构建行为变更（摘要纯读，任何情况下不 fail——摘要只报告，不裁决）；
- dev 热重建路径不打印（只在 CLI `ojm build` 动作末尾，由 cli.ts 控制）。

## 3. 设计

### 3.1 判定口径（与 `--bundle` 打包对象同源，DRY）

「用户方案」= `--bundle` 会打包的那一批：
- 模块级契约 `src/<name>/solution.yaml | manifest.yaml` 且不在内置名单（`src/.ojm-builtin.json`）；
- 或工程根契约（`solution.yaml | manifest.yaml`）的 `name`（旧单方案写法）。

与 `bundle.ts` 的 `resolveContractTargets` 共用 `collectModuleContracts` / `peekContractName` /
`readBuiltinModules`，不另立名单。

### 3.2 输出形态（一行优先，异常才展开）

| 场景 | 输出 |
|---|---|
| 全部构建成功 | `[ojm] 用户方案 2 份已构建：crm@1.0.0、erp@0.2.0（ojm build --bundle 打包）` |
| 有方案没进构建 | `[ojm] 用户方案 2 份中 1 份已构建：crm@1.0.0；未构建：erp（有契约但没进构建——查 web.config.ts 登记/enabled）` |
| 零用户方案 | `[ojm] 用户方案 0 份（ojm new <name> 创建后即可 ojm build --bundle 打包）` |
| 内置模块（有则一行） | `[ojm] 框架自带模块 6 份已构建（不参与用户打包）` |
| module-root 下非内置模块缺契约 | `[ojm] ⚠️ 模块 foo@0.1.0 缺方案契约（src/foo/solution.yaml），不会被打包` |

### 3.3 实现点

- `bundle.ts` 新增导出 `summarizeBuiltSolutions(projectRoot, built, log?)`：
  纯读函数，`log` 可注入（测试断言）；不调 `resolveLayout`（构建末尾不因摘要崩溃），
  「src/ 目录存在」即视为 module-root 口径做缺契约检查。
- `cli.ts` build 动作（非 bundle 路径）：接住 `buildModules` 返回的 `BuiltModule[]`，末尾调用摘要。

## 4. BDD 场景

```gherkin
功能: ojm build 用户方案摘要
  作为方案开发者
  我要在构建日志末尾看到我的方案的构建状态
  以便确认它们能被 ojm build --bundle 打包

  背景:
    假如 module-root 工程 src/ 下有契约 crm、erp 与内置名单 [home, login]

  场景: 全部构建成功
    当 构建产物含 crm@1.0.0、erp@0.2.0、home@x、login@y
    那么 摘要一行列出「用户方案 2 份已构建：crm@1.0.0、erp@0.2.0」
    并且 一行列出「框架自带模块 2 份已构建」

  场景: 方案没进构建（未登记或 enabled:false）
    当 构建产物缺 erp
    那么 摘要点名 erp 未构建并给出排查方向

  场景: 零用户方案
    当 工程只有内置方案契约
    那么 摘要提示 0 份并指向 ojm new

  场景: 非内置模块缺契约（不会被打包的陷阱）
    当 构建产物含无契约模块 foo
    那么 摘要警告 foo 缺 src/foo/solution.yaml

  场景: 旧单方案工程（根契约，flat 布局）
    当 工程根有 manifest.yaml（name=demo-solution）且构建产物含 demo-solution@0.1.0
    那么 摘要列出 demo-solution@0.1.0，且不因缺 src/ 契约误报
```

## 5. 验收

- [x] 新增用例全绿（`summarizeBuiltSolutions` 注入 log 断言，6 场景含新脚手架 src/app 形态）；
- [x] `ojm build` 动作末尾调用摘要（cli.ts 接住 `buildModules` 返回值）；
- [x] `tsc --noEmit` / 受影响文件 lint / 既有 bundle 用例回归通过；
- [x] 手册 §7 命令注释补一行输出说明。

## 6. 记录

- 关键过程：读 bundle.ts/build.ts/cli.ts 定判定口径（与 `resolveContractTargets` 同源，DRY）→
  计划文档 → TDD（6 用例先红后绿）→ cli.ts 接线 → lint 拉锯（续行规则互斥，拆变量消掉）。
- 补充信息落地：内置模块已收敛 `src/app`（平台聚合树、无契约、内置名单派生含 app/oj-market）——
  契约驱动的判定天然兼容，新增第 6 个用例锁死「src/app 不被误判为用户方案」。
- 耗时：约 35 分钟（2026-11-03 09:00–09:20，含读码与规则拉锯）。
- 未做（非目标）：`--bundle` 路径输出不变；dev 热重建不打印摘要。
