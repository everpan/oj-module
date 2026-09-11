# web 布局改名 + ojm api 生成目录更名 + 豁免清单注释

- 日期：2026-09-11 23:24
- 状态：已确认（用户决策：`_comment` 承载注释；根仓 `modules/` 一起改；硬切换只认 `web/`；产物协议 `modules.json` 保持不变；生成目录名 `client`）
- 分支：`feat/web-layout-rename`
- 关联：[[202609110947-oj-module-two-package-consolidation-design]]（两包整合）、`framework-verification-playbook.md`

## 1. 背景与目标

三个独立但同批落地的改进：

1. **豁免清单无说明**：`api/.ojm-api-exempt.json` 是 `ojm api --check` 的降级豁免清单（D12/F19），新人拿到文件不知道作用与配法。文件为严格 `JSON.parse`（check.ts `loadExemption`），写 `//` 注释会解析失败并**静默回退空豁免**——注释必须以 `_comment` 字段承载。
2. **布局改名 modules → web**：模块工程布局由「api 后端 + modules 前端」调整为「api 后端 + web 前端」，语义更直白。根仓 `modules/`（dogfooding）同步改。CLI 硬切换只认 `web/`，删除 layout.ts 的 legacy 分支（原定「下个 minor 删除」的里程碑顺势提前）。
3. **生成目录与后端同名冲突**：`ojm api` 生成的 client 产物落在前端模块的 `api/` 目录（`modules/src/<m>/api/`），与后端顶层 `api/` 同名，新人易混。更名为 `client/`。同时把契约生成的全链路逻辑落成新人指南文档。

## 2. 决策表

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| T1 | 豁免注释承载 | `_comment` 字段内嵌说明 | `loadExemption` 只读 `modules`/`paths`，多余字段忽略，零代码改动；`//` 会静默失效（反常识坑，check.ts 注释补警示） |
| T2 | 改名范围 | 根仓 `modules/`、`apps/playground(-oj)`、`packages/cli/templates`、CLI 源码全部改 | 用户指定根仓一起改 |
| T3 | 兼容策略 | 硬切换：layout.ts 只认 `web/src` + `web/dist`，删 legacy 分支 | 用户指定；存量工程须自行迁移 |
| T4 | 配置文件名 | `modules.config.ts` → `web.config.ts`（导出结构不变，仍叫 `modules` 列表） | 与目录改名配套 |
| T5 | 产物协议 | `modules.json`、`dist` 内 `modules/<name>/<version>/` **不改名** | build 产物与 shell-dist 运行时的内部 wire 协议，改名收益低 diff 大（用户确认） |
| T6 | 生成目录名 | `web/src/<m>/api/` → `web/src/<m>/client/`，且生成物 `client.ts`/`client.schemas.ts` → `client/api.ts`/`client/api.schemas.ts`（含纯前端契约 `client/contract.ts`；runtime 内部 role client 同规迁移） | 用户指定：目录 client + 文件 api.js 形态（`client/api.js`），与后端 `api/` 消歧 |
| T7 | 豁免旧名回退 | `.ram-api-exempt.json` 只读回退（R4）不动 | 与本批改名无关 |
| T8 | 历史文档 | `docs/archive/**` 与带日期历史 PRD 不改；只更新 living 文档（CLAUDE.md、README、framework-development-guide、oj-fullstack-tutorial、playbook） | 历史记录保持原样 |
| T9 | 新人指南 | 新增 `docs/prd/ojm-api-codegen-guide.md`：契约 → evaluate → IR → 四产物 → stub → `--check` 全链路 | 供新人学习，与 tutorial 互补（tutorial 讲用法，guide 讲机制） |

## 3. 用户故事与用例（BDD）

### US-1 豁免清单自说明

```gherkin
Given apps/playground-oj/api/.ojm-api-exempt.json 与 packages/cli/templates/api/.ojm-api-exempt.json
Then 两文件含 "_comment" 字段，说明文件作用、modules（整模块跳过对账）与 paths（/xxx/* 一层通配，否则精确前缀）的配法
And ojm api --check 行为不变（_comment 被忽略，豁免照常生效）
```

### US-2 web 布局硬切换

```gherkin
Given 根仓、apps/playground、apps/playground-oj、packages/cli/templates
Then 前端模块源码目录均为 web/（playground-oj 与模板为 web/src + web/dist 配对）
And 配置文件均名 web.config.ts，entry 路径指向 web/...
And packages/cli/src/layout.ts 只探测 web/src，无 modules legacy 分支
And manifest.json（根仓）entry 路径为 /web/<m>/entry.ts
And 全仓 grep "modules/" 不再命中源码与 living 文档（产物协议 modules.json、dist/modules/<n>/<v>/ 除外）
```

### US-3 生成目录更名 client

```gherkin
Given uni-dev 工程（api/src/<m>/contract.ts）
When 执行 ojm api
Then api.ts / api.schemas.ts 落 web/src/<m>/client/
And routes.json / openapi.yaml 落契约旁（不变）
Given 纯前端工程
Then 契约位于 web/src/<m>/client/contract.ts，四产物落同目录
And 模块源码导入为 ./client/api（playground-oj 与模板全部更新）
And runtime 内部 role client 迁至 packages/runtime/src/api/system/role/client/{api.ts,api.schemas.ts}
```

### US-4 新人指南

```gherkin
Given docs/prd/ojm-api-codegen-guide.md
Then 覆盖：两种工程形态（uni-dev / 纯前端）、契约发现规则、defineApi → IR、四产物与落盘位置、stub 镜像树与人碰保护、ojm api --check 与豁免清单配法
```

## 4. 实现任务

| # | 任务 | 状态 |
|---|------|------|
| 1 | 本设计文档 | ✅ 完成 |
| 2 | 豁免文件 `_comment` + check.ts 警示注释 | ✅ 完成 |
| 3 | modules → web 硬切换（含 web.config.ts、layout.ts 删 legacy） | ✅ 完成（补 flat 分支撑根仓平铺形态，见 R5） |
| 4 | 生成目录 api/ → client/（文件为 api.ts/api.schemas.ts，含模块导入更新） | ✅ 完成 |
| 5 | ojm-api-codegen-guide.md 新人指南 | ✅ 完成 |
| 6 | typecheck/lint/test 验证 + 文档收尾 | ✅ 完成 |

## 5. 风险与反常识记录

- **R1（反常识）**：JSON 配置写 `//` 注释 → `loadExemption` catch 静默回退空豁免，豁免全失效且无任何报错。T1 的 `_comment` 方案规避；check.ts 注释补警示。
- **R2**：改名后工程里存在两个 "web"——`web/`（前端源码）与 `api/src/web`（oj 后端 web 模块，提供 user-info 等）。不同目录不冲突，但豁免清单 `"modules": ["web"]` 指的是后者，指南文档需点明。
- **R3**：layout.ts 删 legacy 分支后，存量 `modules/` 工程跑 `ojm dev/build` 会报「未发现 web/src」类人话错误——报错文案需显式提示迁移（`modules/` → `web/`，`modules.config.ts` → `web.config.ts`）。
- **R4**：`ojm api` 发现规则变更后，存量工程 `modules/src/<m>/api/contract.ts` 不再被发现；报错文案同样提示迁移。
- **R5（反常识，实现中暴露）**：框架根仓自身是**平铺** `web/<name>/`（无 src/dist 分层），`readModuleDefinition` 的裸说明符扫描复用 `resolveLayout`（B10）——硬切换若只认 `web/src` 会把根仓打成「存量工程」。layout.ts 因此保留 `kind: "flat"` 分支（平铺 `web/` → 产物 `build/`），这不是 legacy 复活，是框架仓自身形态。
- **R6（反常规，实现中暴露）**：eslint 对生成物的忽略按**路径**登记（`**/api/client.ts`），目录改名后忽略静默失效、生成物被 lint 报错。已同步为 `**/client/api.ts`；今后生成物改名必须连带 eslint.config.js。

## 6. 总结

- **关键过程**：设计文档先行 → 豁免 `_comment`（零代码）→ 目录 `git mv` 平移 →
  CLI 源码（layout/config/run/emit-client/check）改名 → 生成物实跑再生
  （playground-oj `ojm api` 幂等 0 写入，证明手工改名与生成器输出逐字节一致；
  runtime role client 由 gen 脚本重生成）→ 测试与 living 文档同步 → 全量验证。
- **验证结果**：typecheck 干净；vitest 92 文件 573 用例全绿（含重建的 emit-client 快照）；
  eslint 0 error（63 个存量 warning 与本次无关）；playground-oj `ojm api --check`
  0 error/0 warn；playground 与 playground-oj `ojm build`、根仓 `pnpm build:modules` 均通过。
- **暴露的两个反常规问题**（已记入 §5）：根仓平铺 `web/` 形态差点被硬切换误杀（R5）；
  eslint 生成物忽略按路径登记、改名即失效（R6）。
- **耗时**：2026-09-11 23:24 设计落档 → 2026-09-12 00:08 验证收尾，约 45 分钟。
- **未做**（刻意排除）：产物协议 `modules.json` 与 `dist/modules/<n>/<v>/` 不改名（T5）；
  `docs/archive/**` 与历史 PRD 不动（T8）；`.ram-api-exempt.json` 回退保留（T7）。

## 7. 发布结果（v0.1.8，2026-09-12）

| 包 | 版本 | registry 复核 |
|---|---|---|
| `@oj-module/runtime` | 0.1.8 | 重发 409「previously staged」确证 → packument 约 3 分钟后含 0.1.8 |
| `@oj-module/cli` | 0.1.8 | 重发 403「previously published」确证 → `dist-tags.latest=0.1.8` |

发布顺序 runtime → cli（lockstep，`pnpm publish`，cli 依赖被改写为精确 `0.1.8`）。
**git tag**：`v0.1.8`（已推 origin，随 `feat/ojm` 分支同推）。
