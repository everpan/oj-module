# 普通 ojm build 接入表前缀门禁（C2-12c 构建期 fail-fast 补口）

- 日期：2026-11-10 09:32
- 分支：`fix/plain-build-prefix-gate`（自 `feat/ojm` 切出，完成后 `--no-ff` 并回并删）
- 契约真源：docs/prd/solution/archive/202610171254-lifecycle-manifest-contract.md §2.3（C2-12a/12c）、§4.1 构建列

## 0. 需求原话与解读

> 对于 'ojm build' 中，关于表前缀的门禁似乎失效了，请查明原因，同时确保门禁检查表前缀。

解读：普通 `ojm build` 对方案表前缀违规零报错，门禁形同虚设；要求查明原因并让 `ojm build` 真正检查表前缀。

## 1. 排查结论（Phase 1–3 证据）

| 验证 | 手段 | 结果 |
|---|---|---|
| `--bundle` 门禁本体 | fixture-valid 复制到 /tmp 四组负例实跑 `buildBundle` | 全部正确触发（缺 prefix / 保留段 `oj_evil_` / 语法 `Bad_` / 引用式无 api.tables + 保留段）；合法夹具放行到组装段 |
| 普通 build 门禁 | 读 cli.ts build action → build.ts → module-build.ts 全链 | **零检查点**：action 只跑 scaffold-guard → buildBackend → buildModules → summarize；`checkTables`/`checkTablesAgainstSchema` 无任何调用路径 |
| 契约定版 | 契约文档首部 + §4.1 | 构建期执行点写明是 `ojm build --bundle`（P1-11），普通 build 未列入——**不是回归，是本来就只接了 bundle 一侧** |

**根因**：C2-12c 的构建期执行点只接在 `ojm build --bundle` 校验段；普通 `ojm build`（开发者每轮先跑的命令，`ojm new` 提示 `ojm build && ojm build --bundle <name>`）不含该门禁，前缀违规要到第二步才暴露，第一步零报错即"失效"观感。

## 2. 设计

普通 build 在 scaffold-guard 之后、任何产物写入之前，对**全部用户方案契约**跑与 bundle 校验段同源的文件面契约（C2-12a tables↔schema.yaml、C2-12c 前缀、C2-25 locales）——同一块代码，两处执行（DRY）。

- 新导出 `assertSolutionFileContract(projectRoot)`（bundle.ts）：枚举用户契约（工程根契约优先，与 bundle 同矩阵；零契约静默返回——脚手架/纯前端工程不受扰）→ `resolveLayout` → 逐契约 `checkTables` + `checkLocales` → 违规聚合抛错（exit 1，零产物）。
- `resolveContractTargets` 拆出共享枚举 `collectContractTargets`：bundle 侧保留既有报错/提示日志，gate 侧静默（不往普通 build 输出里掺打包提示噪音）。
- cli.ts build action 普通分支在 guard 后插入一行调用。
- 边界（不在本 round）：manifest 内在规则（`validateContract`）仍只在 `--bundle` 执行——契约文档本就把构建列锚在 P1-11；本 round 只补文件面（含前缀）。

## 3. 任务

| # | 任务 | 状态 |
|---|---|---|
| T1 | 失败测试先行：`build-solution-gate.test.ts`（违规 → 抛 C2-12c；合法 → 放行；零契约 → 静默；引用式 → 仍查） | ✅ |
| T2 | cli.test.ts 补 mock 导出 + 门禁失败 → buildBackend 不执行、exit 1 | ✅ |
| T3 | 实现 `collectContractTargets` 拆分 + `assertSolutionFileContract` + cli.ts 接线 | ✅ |
| T4 | 全量 vitest（packages/cli）+ lint + typecheck | ✅ |
| T5 | 并回 feat/ojm（--no-ff）并删分支 | ✅ |

## 4. 总结

- 关键过程：Phase 1 用 /tmp 探针工程实跑 `buildBundle` 四负例一正例钉死"门禁本体完好、执行点缺失"；根因为契约把构建列只锚在 `--bundle`（P1-11），普通 build 从未接入，非回归。
- 实现：共享枚举拆分 + `assertSolutionFileContract`（约 40 行，全部复用 `checkTables`/`checkLocales`/`resolveLayout`），cli.ts 一行接线；TDD 两层测试（真模块单测 + cli action 集成）。
- 耗时：排查约 25 min（含四组复现），实现+测试约 20 min。
