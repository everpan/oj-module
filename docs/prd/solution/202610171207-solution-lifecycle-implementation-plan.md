# 解决方案全生命周期管理 · 实施计划（P0–P3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 状态：待评审 · 日期：2026-10-17 · 上游设计：[`202610171138-solution-lifecycle-implementation-design.md`](202610171138-solution-lifecycle-implementation-design.md)（**v3，执行器=oj 原生**；本文决策编号 D1–D13、评审处置 R1–R31 均指该文）
> **本文档只定计划，不开工。** 任务表是**唯一跟踪源**：状态（未开始→进行中→已完成/阻塞）+ 开始 + 耗时就地更新；实现期偏差记入设计文档 §10 追加行；每期全部完成后写阶段小结。P2/P3 在期门评审时按同粒度细化展开（P0+P1 先行细化——P1 产出即首个可用闭环）。

---

## 1. 总体策略

| 维度 | 约定 |
|---|---|
| 分支 | 每期一条 `feat/lifecycle-p<0..3>`，自集成分支切出（**P0 开工首日确认 `feat/system-admin-web` 合并顺序定基线**）；集中评审通过后合并 |
| 方法 | **TDD/BDD 先行**（AC 锚点即需求，红→绿）；纯函数主战场：semver/tgz 守卫/文本锚点/原子写/确定性 tar/状态机转移 |
| 架构原则 | SOLID/DRY 落点见 §1.2（每个任务标注其原则） |
| 集中评审 | 每期 typecheck + lint + test（`pnpm test` + `pnpm test:cli`）+ mermaid 门禁全绿 → 一次全量 diff 评审 → 合并 |
| 两运行时取舍 | manifest 校验、白名单规则在 **Node CLI（build 期）与 oj isolate（安装预检）各有一份**（跨运行时无共享模块机制）——以**同一组夹具 bundle 双端测试**钉一致性（DRY 于夹具而非运行时） |

### 1.1 文件结构图（P1 范围，单一职责）

```text
packages/cli/src/                        # Node 工具链面
├── manifest-contract.ts                 # [新建] manifest.yaml 解析+契约校验（纯函数）
├── deterministic-tar.ts                 # [新建] 确定性 tgz（固定 mtime/字典序/权限）+ sha256
├── bundle.ts                            # [新建] ojm build --bundle 编排（后端产物+前端产物+组装）
├── install.ts                           # [新建] ojm install 瘦客户端（登录→触发→轮询）
├── enable.ts                            # [新建] ojm enable/disable/uninstall 瘦客户端（P3 补 uninstall）
├── index.ts                             # [修改] 命令表接线
└── usage.ts                             # [修改] 帮助文本

packages/cli/templates/api/              # 框架后端模板（oj isolate 面）
├── config.yaml                          # [修改] 预置 server.reload_api: true（新工程免注入）
└── src/_platform/
    ├── _lifecycle/                      # [新建] 安装器（特权模块内部件，全部单一职责）
    │   ├── types.ts                     # StageName/StageResult/InstallRequest/TaskRecord
    │   ├── semver.ts                    # compareVersions 纯函数（含 prerelease）
    │   ├── tgz-guard.ts                 # validateTarListing 纯函数（zip-slip 防护 R1）
    │   ├── text-edit.ts                 # insertAnchor/hasAnchor 纯函数（R18 文本锚点）
    │   ├── atomic.ts                    # 原子写文本（tmp+rename，D13）
    │   ├── state.ts                     # sidecar .solutions/state.yaml 读写（D12）
    │   ├── lock.ts                      # 进程内互斥 + .lock（R17/R31）
    │   ├── tasks.ts                     # 任务注册表（.install-tasks 状态文件，R13）
    │   ├── steps/                       # 十阶段步骤（每 stage 一个纯步骤函数）
    │   │   ├── preflight.ts             # 白名单/保留名/占用/兼容/段内收敛（R7/R8/R24）
    │   │   ├── download.ts              # CDN 拉取（http 模块或 exec.run curl，S1-2 裁决）
    │   │   ├── verify.ts                # sha256 +（P2 起）verifyEd25519 + integrity 计算
    │   │   ├── extract.ts               # list→validate→extract 三步（exec.run tar）
    │   │   ├── migrate.ts               # 备份+exec.run oj migrate+seq 校验（R2/R14）
    │   │   ├── register.ts              # D10 唯一出口：solution-perms/settings/solution_route
    │   │   ├── deploy-web.ts            # modules.json 原子 upsert + web 产物落位（POSIX 路径 R30）
    │   │   ├── reload.ts                # anonymous 并入 + vars++ + reloadConfig 终态断言（R18）
    │   │   └── smoke.ts                 # 冒烟四项（§4.1）
    │   └── installer.ts                 # 状态机编排（声明式 stage 表，OCP；D11 失败语义三分）
    ├── market/api.ts                    # [新建] 编排端点（meta/index/install/task/verify；superadmin 门 R9）
    └── _shared/service/solution-perms.ts# [复用] 注册唯一出口（进程内直调，D10）

packages/runtime/src/                    # 浏览器面
├── store/solution-routes.ts             # [新建] 归并 store + mergeSolutionCategories 纯函数（R21）
├── store/access.ts                      # [修改] 菜单装配消费归并结果
└── api/                                 # [修改] solution-routes 客户端

web/system/                              # 系统设置页三层嵌套改造（R20）
../oj-market/                            # [新建·独立仓] 市场方案（第三方作者形态；脚手架对齐 apps/playground-oj）
scripts/lifecycle-e2e.mjs                # [新建] P1 端到端脚本（本地 oj 分发源）
```

### 1.2 SOLID/DRY 落点

| 原则 | 落点 |
|---|---|
| SRP | 状态机编排（installer.ts）与步骤执行（steps/*）、状态持久（state/tasks）、互斥（lock）分离；每文件一个职责 |
| OCP | 状态机 = 声明式 stage 表（`StageDef[]`）；P3 升级/降级/卸载=同表参数化，不加分支不改编排 |
| LSP | 所有步骤满足同一签名 `(ctx: InstallContext) => Promise<StageResult>`，可独立单测可替换 |
| ISP | 端点按消费方拆分：solution-routes（所有登录用户）/ market 编排（superadmin）/ verify（admin）各自独立契约 |
| DIP | installer 依赖 `StepRunner` 与 `StateStore` 接口而非具体实现；exec.run 命令经 `buildXxxCmd()` 纯函数构造（可测、可 stub） |
| DRY | semver/原子写/脱敏/文案模板/白名单正则/tgz 守卫各一处实现；夹具 bundle 一组双端共用；失败文案 key（`lifecycle.stage.*`）单一来源 |

### 1.3 全局约束（每个任务隐含）

- oj 0.1.76 能力面：`exec.run`（platform 白名单）/`server.reloadConfig()`/`crypto.verifyEd25519`/`http` 模块可用；迁移无 down；release `migrate verify` 拒启（M003/M004）
- 锁格式 oj 原生扁平 `name: version`（D12）；状态文件 tmp+rename（D13）；失败语义三分（D11）
- 代码风格：Tab 缩进、双引号、分号；conventional commits；commit 尾行 `unix@vip.qq.com ai`
- 文档门禁：`pnpm check:mermaid` 绿才可提交含 mermaid 的文档

---

## 2. P0 · 契约与需求周（分支 `feat/lifecycle-p0`）

| # | 任务 | 产出 / 验收 | 原则 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| C1 | 共享根裁决 spike | 裁决记录回填设计文档 §9（S1-1/2/3/5/6/7 逐项结论）：① 单 mount 自洽形态（api 前缀重复/空锁拒启/save_lock 互斥实测）② exec.run tar list→validate→extract + 下载形态 ③ 长任务形态（tasks 轴 vs 分段）④ 冒烟凭证 ⑤ reload_api 注入实测 ⑥ M003/M004 实测与对账规则 | DIP（裁决先于实现） | 已完成（2d7f1b37+9856deef，评审 ALL CLEAR；202610171245 findings 六节 + spike 源码附录 A） | 1149 | ≈65min（含评审修复环） |
| C2 | manifest.yaml 契约定稿 | 契约文档（PRD §5.2 为底 + changelog 字段 + name/version 白名单 + settings key 所有权 + i18n key + 文案 key `lifecycle.stage.*` 全表）；夹具 bundle 两枚（合法/非法各一，入 `packages/cli/src/lifecycle/__tests__/fixtures/`） | ISP（契约按消费方列字段） | 已完成（9f63e6ed+20ab76d7，v1.1 后 b7137507；评审 ALL CLEAR；C2-01~33 + 双夹具） | 1255 | ≈31min（含评审修复环） |
| C3 | 开放问题拍板落档 | Q-A（health 不强制）/GC N=3 时间序/菜单三值/market.view+verify 初始绑定 admin+superadmin——回写设计文档 §0 | — | 已完成（fbc36aed，评审 Approved；D14） | 1327 | ≈5min |
| C4 | 上游需求提交 | `202610161500-oj-bin-feature-requests-pr.md` 追加 OJ-9（down 迁移，低优，含 D10 豁免面注记）；OJ-8/OJ-6 提交稿投 oj-bin 仓 | D9 | 已完成（ac4f5ad1+313bce04，评审 Approved；三份自包含提交稿在 202610171400-oj-bin-submissions/，**跨仓提交由用户手动执行**） | 1411 | ≈12min（含微调） |
| C5 | 下游契约承接清单 | devkit 手册章节提纲：「打包与分发」「第一方特权面不可复制（R29）」「persona 部署引导」 | — | 已完成（c6d0e43d，202610171333 提纲；评审 Approved） | 1332 | ≈7min |
| C6 | 基线回写 | lifecycle 文档：§3 锁顺序→迁移后落锁、§5 禁用语义→锁摘除+sidecar、Q-A 拍板；状态行→已评审；**并**：统一 verify 端点口径（§5.1 图移除 verify，以 §4.2 `POST /api/_platform/solutions/:name/verify` 为准）；处理工作区既有未提交改动（202610161300） | — | 已完成（461c977+c010b202，评审 Approved） | 1340 | ≈12min（含 D11 收口） |
| C7 | **生命周期总览文档**（用户追加） | 面向三视角——开发者（打包/契约/发布）、运维（引导安装/升级/回滚/禁用/卸载/备份/故障恢复）、普通用户（市场页安装/菜单与设置/深检/失败语义）；基于 C2 契约 + C5 提纲 + C6 回写后口径 | — | 已完成（a06578ba+6ce5ec21+deb1850a，评审 Approved；202610171354 三视角指南，钉出并推动契约 v1.1 C2-33） | 1353 | ≈18min（含契约缺口联动） |

**DoD**：六项产出齐 + 两枚夹具 bundle 可被后续任务直接引用 + 裁决记录无「待验证」残留。

---

## 3. P1 · 打包→安装闭环（分支 `feat/lifecycle-p1`）

> 每个任务先写失败测试再实现；测试命令统一 `pnpm test:cli -- <file>`（CLI 面）/ 模板套件（isolate 面，沿 RBAC 先例）。

### Task P1-1：semver 比较器（R25，DRY）

**Files**: Create `templates/api/src/_platform/_lifecycle/semver.ts`；Test `templates/api/tests/lifecycle/semver.spec.ts`
**Interfaces — Produces**: `compareVersions(a: string, b: string): -1 | 0 | 1`（prerelease：`1.0.0-alpha < 1.0.0`；数字段数值比较：`0.1.10 > 0.1.9`）

- [ ] 失败测试（表驱动 ≥10 组断言）：`expect(compareVersions("0.1.10", "0.1.9")).toBe(1)`、`expect(compareVersions("1.0.0-alpha", "1.0.0")).toBe(-1)`、`expect(compareVersions("1.0", "1.0.0")).toBe(0)`
- [ ] 跑红 → 实现（纯字符串解析，无依赖）→ 跑绿 → commit `feat(lifecycle): semver 比较器纯函数`

### Task P1-2：tgz 成员守卫（R1，SRP）

**Files**: Create `_lifecycle/tgz-guard.ts`；Test `templates/api/tests/lifecycle/tgz-guard.spec.ts`
**Interfaces — Produces**: `validateTarListing(lines: string[]): { ok: true } | { ok: false; offender: string }`（拒绝：绝对路径、含 `..` 段、`-tvzf` 首列 `l`/`h` 开头条目（symlink/hardlink）、空成员名）

- [ ] 失败测试：`../evil`、`/etc/passwd`、`link -> /etc`（l 类型）、正常 `wiki-0.2.0/src/manifest.yaml` 通过、嵌套合法相对路径通过
- [ ] 跑红 → 实现 → 跑绿 → commit

### Task P1-3：text-edit 文本锚点（R18，DRY）

**Files**: Create `_lifecycle/text-edit.ts`；Test `templates/api/tests/lifecycle/text-edit.spec.ts`
**Interfaces — Produces**: `insertAnchor(content: string, anchorComment: string, block: string): string`（锚点已存在=原样返回，幂等）、`hasAnchor(content: string, anchor: string): boolean`

- [ ] 失败测试：对带注释的 config.yaml 样例插入 mount 行后注释/缩进/空行逐字保留；二次插入幂等；缺锚点报可读错误
- [ ] 跑红 → 实现 → 跑绿 → commit

### Task P1-4：原子写 + sidecar 状态（D12/D13，DIP）

**Files**: Create `_lifecycle/atomic.ts`、`_lifecycle/state.ts`；Test `templates/api/tests/lifecycle/atomic-state.spec.ts`
**Interfaces — Produces**: `atomicWriteText(path: string, content: string): Promise<void>`（同目录 tmp+rename）；`StateStore` 接口 `{ read(): SolutionState; write(patch: Partial<SolutionState>): Promise<void> }`，`SolutionState = { solutions: Record<string, { version: string; enabled: boolean; installedAt: number }> }`

- [ ] 失败测试：写入后内容完整（无半截态）；patch 合并不丢其他方案键；损坏 yaml 返回空状态+告警不炸
- [ ] 跑红 → 实现（fs 经 exec.run 步骤或可用 fs 面，S1-2 裁决定）→ 跑绿 → commit

### Task P1-5：预检 preflight（R7/R8/R9/R24，ISP）

**Files**: Create `_lifecycle/steps/preflight.ts`；Test `templates/api/tests/lifecycle/preflight.spec.ts`
**Interfaces — Consumes**: `compareVersions`、`StateStore`；**Produces**: `preflight(ctx: InstallContext): Promise<StageResult>`，ctx 含 `{ manifest, name, version, state, db }`
规则（全部可读中文 reason + retryable=false）：name `^[a-z][a-z0-9-]*$`；version `^[0-9A-Za-z.+-]+$`；保留名（含 `market`）与占用拒装；`sys_solution_route`/`sys_setting` 键命名空间 `moduleOf(key)===name`；anonymous 声明条目前缀 ∈ `<name>/`；`peerRuntime` 对 versions.json

- [x] 失败测试表驱动：每条规则一拒例 + 一过例（复用 C2 夹具）
- [x] 跑红 → 实现 → 跑绿 → commit

> **P1-5 完成（2026-10-17）**：`_lifecycle/steps/preflight.ts` + 51 组用例（21 规则表行 + C2-09 算子语义 7 组 + C2 夹具 2 组）；fixture-valid 零违规、fixture-invalid 七码齐报（C2-01/02/16/17/22/23/26 同现一条 message = 收集全部违规纪律的测试证据）；ctx 较简报增补可选 `hostVersions`（C2-09 比对真源注入位，P1-10 收敛 types.ts 时一并迁移）。详见 `task-P1-5-report.md`。

### Task P1-6：下载/校验/解压步骤（S1-2，LSP）

**Files**: Create `steps/download.ts`、`steps/verify.ts`、`steps/extract.ts` + `buildTarCmd()` 纯命令构造；Test `templates/api/tests/lifecycle/steps-fs.spec.ts`
**Interfaces — Produces**: 三步同签名 `(ctx) => Promise<StageResult>`；`buildListCmd(file) / buildExtractCmd(file, staging)` 返回 argv 数组（可 stub）
- [x] 命令构造纯函数测试（无 exec）：argv 逐字断言
- [x] extract 步骤集成测试：合法夹具解压后目录树断言；恶意夹具（`..`/symlink 成员）在 validate 段被拒、**零解压**
- [x] 跑绿 → commit

> **P1-6 完成（2026-10-17）**：`steps/download.ts`（fetch→fs.writeFile 落 `.staging/<archive.file>`，S1-2.3）+ `steps/verify.ts`（sha256 fail-closed 比对，C2-29；注释钉「P1 无签名阶段同信任域，仅防传输损坏」）+ `steps/extract.ts`（list→validate→extract 三步，R1；`buildListCmd`/`buildExtractCmd` argv 逐字断言、与 S1-2 exec 白名单对齐）+ 21 组用例（含真实系统 tar 集成、恶意 listing 零解压 stub 计数、两条消费方铁律①verbose/②尾部空行 trim 的专例）。三步失败 StageResult 均带附录 A/C2-29/R1 引用；archive 身份提取（`archiveFileOf`，C2-29 安全形态守卫）三步共用。详见 `task-P1-6-report.md`。

### Task P1-7：迁移步骤（R2/R14，D11 核心）

**Files**: Create `steps/migrate.ts`；Test `templates/api/tests/lifecycle/migrate.spec.ts`
**Interfaces — Consumes**: `buildMigrateCmd(dir, module)`（`["oj","migrate","--format","json","-d",dir,module]`）
语义：前置备份（sqlite copy `.bak-<ts>`，保留 3 份）→ exec.run → 解析 json 输出 → **成功后才允许后续落锁**；失败 → `StageResult{ok:false}` 且锁保持不变；`rollbackGuard(targetMaxSeq, ledgerHead): boolean` 纯函数（目标 < head 则禁回滚）
- [ ] 失败测试：备份文件存在断言；migrate 失败（exit≠0）时 StageResult.ok=false 且 state 未变；rollbackGuard 三例
- [ ] 跑红 → 实现 → 跑绿 → commit

### Task P1-8：注册步骤（D10，DRY 唯一出口）

**Files**: Create `steps/register.ts`；Modify `_shared/service/solution-perms.ts`（如需批量入口）
**Interfaces — Consumes**: `upsertSolutionRbac()` / settings upsert / `sys_solution_route` upsert（既有出口）
语义：#2/#3/#4 注册一次完成；声明消失标 deprecated；写 `auditOp("solution.register", ...)`；提供 `queryRegistered(name)` 供冒烟
- [x] 失败测试（sqlite 夹具）：注册后四表行存在；重跑幂等（行数不变）；deprecated 语义
- [x] 跑红 → 实现 → 跑绿 → commit

> **P1-8 完成（2026-10-17）**：`steps/register.ts`（`registerSolution` 占用预检 → `upsertSolutionPerms` 出口原样消费 → 设置/路由 upsert（存在只覆定义列，value 不复活）→ 声明消失标 deprecated 汇入清单 → `auditOp("solution.register")`；`checkOccupancy` DB 级首段占用承接 P1-5 备案③；`queryRegistered` 归一化快照过滤 deprecated 供 P1-9 冒烟）+ 迁移 0010 三方言（`sys_solution_route` 重构为 path 主键 + module/required_permission/deprecated/enabled——0004 版 (name,version,path) 主键无运行时读写，DROP 重建零损失；`sys_setting` 补 deprecated 列）+ 7 组用例。详见 `task-P1-8-report.md`。

### Task P1-9：部署/热更/冒烟步骤（R18/R30，DIP）

**Files**: Create `steps/deploy-web.ts`、`steps/reload.ts`、`steps/smoke.ts`
**Interfaces — Produces**: `upsertModulesJson(entry: ModuleEntry)`（读-modify-`atomicWriteText`，entry 路径 POSIX 序列化）；`reloadAndAssert()`（reloadConfig 后断言 mounts/vars 实际生效，`unchanged`=失败）；`smoke(ctx)` 四项（health 或首个非匿名路由 / integrity==sha384 / 注册一致性 `queryRegistered` / ——entry 浏览器加载不在安装器验）
- [x] 测试：modules.json upsert 后 JSON 完整解析（无半截）；POSIX 路径断言；reload `unchanged` 判失败；冒烟 DB 一致性升级态用「包含非相等」
- [x] 跑绿 → commit

> **P1-9 完成（2026-10-17）**：`steps/deploy-web.ts`（staging `web/modules` 树 → 注入 `siteModulesDir` 一层对齐复制 + `upsertModulesJson` 读-改-`atomicWriteText` upsert（D13 读者永不见半截 JSON，损坏清单拒写；R30 entry/css POSIX 序列化；同名整体替换他条目原样保留；integrity 由 P1-10 算好传入，缺省回落 manifest.web.integrity））+ `steps/reload.ts`（注入 reloadConfig 面，R18 终态断言：`unchanged`=改写未生效判失败、expected 段键缺省 `["mounts"]` 须 ∈ applied、busy 抛错 retryable）+ `steps/smoke.ts`（collect-all 三项：探活 health 2xx / 缺省首个非匿名路由连通即可（probe URL = `<apiPrefix>/<path 去前导斜杠>`，与 C2-26 段内收敛同构）、integrity 落位重算 sha384 vs modules.json（R10；缺 integrity fail-closed；css 验落位）、注册一致性「包含非相等」（快照 ⊇ 声明，null+空声明过/null+非空败）；entry 浏览器加载不在安装器验，口径钉于注释与成功 message）+ 32 组用例（全量 327/327）。详见 `task-P1-9-report.md`。

### Task P1-10：状态机编排 + 任务注册表（D11/OCP，SRP）

**Files**: Create `_lifecycle/installer.ts`、`_lifecycle/tasks.ts`、`_lifecycle/lock.ts`；Test `templates/api/tests/lifecycle/installer.spec.ts`
**Interfaces — Produces**:
```ts
const STAGES: StageDef[] = [preflight, download, verify, extract, migrate, lockCommit, register, deployWeb, reload, smoke, audit]
runInstall(req: InstallRequest): Promise<TaskRecord>   // 声明式遍历 stage 表
getTask(id: string): TaskRecord | null
```
语义：`lockCommit` 是显式 stage（位于 migrate 后——D11）；失败语义三分（锁前清场重跑 / 锁后 `status:"partial"` + 回滚指引 / 切换前 `verifyTarget()` 复验）；入口对账自愈 `reconcile()`；任务状态落 `.install-tasks/<id>.json`（保留 10 条、启动时超时 running 判 failed、message 脱敏）；升级/降级/禁用/启用 = 同表参数化（`runInstall({version})` / `setEnabled(name, bool)`：锁摘除+sidecar+route+modules 四处同写）
- [ ] 失败测试（步骤全 stub 注入——DIP）：全绿路径 stage 顺序断言；extract 失败 → 零落盘零改锁；smoke 失败 → `partial` + 指引文案 key；对账：锁指新版账本落后 → 回指旧版；lock：并发取锁互斥、持有者崩溃后 `.lock` 过期可接管（R17/R31）
- [ ] 跑红 → 实现 → 跑绿 → commit

### Task P1-11：CLI `ojm build --bundle`（C2 契约，DRY 夹具）

**Files**: Create `packages/cli/src/manifest-contract.ts`、`deterministic-tar.ts`、`bundle.ts`；Modify `index.ts`、`usage.ts`；Test `packages/cli/src/lifecycle/__tests__/{manifest-contract,deterministic-tar}.test.ts`
**Interfaces — Produces**: `parseManifest(yaml): Result<Manifest>`、`validateContract(m): string[]`、`createDeterministicTgz(dir, out): Promise<string /*sha256*/>`；CLI `ojm build --bundle [--out dist/]` 输出 `<name>-<version>.tgz` + sha256
- [ ] 失败测试：契约校验表驱动（缺字段/白名单/保留名/键空间 → 可读错误清单）；**确定性**：同目录两次打包 sha256 相等；夹具 bundle 与 isolate 预检**双端一致**（同一夹具跑 `validateContract` 与 `preflight` 规则互认）
- [ ] 跑红 → 实现（tar 固定 mtime=0、字典序、0644/0755、无 owner）→ 跑绿 → commit

> **上游同名辨析（2026-10-17，oj 0.1.77 对账）**：上游 `oj build --bundle` 已存在，但产物是**空前缀 dist 根 tarball**（manifests.yaml + `<module>-<version>/`），供 `mounts[].api` URL 远程挂载（装配期拉取入内容寻址缓存 `<cache>/<sha256>/`，声明 sha256 为完整性锚）；本任务 `ojm build --bundle` 产物是**方案包**（单模块 tgz + C2 契约双端校验），消费方是市场安装器。**上游明示的坑（devkit 须落）**：`tar czf x.tgz dist` 会多一层 `dist/`，解压落到 `<cache>/<sha256>/dist/...` 非法 dist 根；per-module `*.tgz` 也不能当远程源（根是版本目录不是 dist 根）——即方案包 tgz 与远程挂载源互不可替代。devkit C5「打包与分发」章节落此辨析（P1-11 实现时一并写）。

### Task P1-12：编排端点 + 市场索引（R9，ISP）

**Files**: Create `templates/api/src/_platform/market/api.ts`；Test `templates/api/tests/lifecycle/market-api.spec.ts`
**Interfaces — Produces**（全 `assertSuperAdmin`，除注明）:
`POST /api/_platform/market/install {name, version|null, source:"cdn"|"file", file?}` → `{task_id}`；`GET .../task/:id` → `TaskRecord`；`GET .../meta` → `{apiVersion}`（登录即可，供 peerPlatform 预检）；`GET .../index`（superadmin）聚合 CDN `bundles.yaml`（`Cache-Control: no-cache` 拉取）+ state 对比
- [ ] 失败测试：非 superadmin 403；install 返回 task_id 且后台推进（stub 步骤）；task 查询脱敏断言
- [ ] 跑红 → 实现 → 跑绿 → commit

### Task P1-13：CLI 瘦客户端 + enable/disable（D6/D8）

**Files**: Create `packages/cli/src/install.ts`、`enable.ts`；Modify `index.ts`、`usage.ts`
**Interfaces — Consumes**: P1-12 端点。行为：`ojm install <file.tgz|name[@version]>`（file 模式经 file 上传或本地路径标记）→ 登录 → POST → 轮询 task → 终态打印（失败输出 reason + retryable + 指引 key 的双语文案）；`ojm enable/disable <name>`
- [ ] 测试：参数解析/轮询退避/终态渲染（stub fetch）；真机冒烟一条（对 dev 站点装夹具）
- [ ] commit

### Task P1-14：前端归并 + 系统设置三层嵌套（R20/R21，SRP）

**Files**: Create `packages/runtime/src/store/solution-routes.ts`；Modify `store/access.ts`、`api/`；Modify `web/system/pages/settings/index.tsx`；Test `packages/runtime` 侧纯函数测试
**Interfaces — Produces**: `mergeSolutionCategories(routes, solRoutes): AnnotatedRoute[]`（纯函数）；`useSolutionRoutes()`（独立 store，token 就绪强制重拉一次，失败降级空表）；`groupSettingsByModule(rows): ModuleGroup[]`；脏组增量提交 + 组级聚合反馈
- [ ] 失败测试：三值归并/hidden 过滤/降级空表不炸/排序（框架 100 带、方案 200 起）；groupSettingsByModule 分组与 label_key
- [ ] 跑红 → 实现 → 跑绿 → 真机冒烟（装夹具后菜单归组、设置嵌套）→ commit

### Task P1-15：`../oj-market` 市场应用主体（D2/D5，**用户指令 2026-10-17 扩量：完整市场功能**）

> 脚手架与第三方作者形态已由教学验证落定（f3e4eb9，`202610172100-solution-authoring-tutorial.md`）；本任务在其上建成**功能完整的市场应用**。范围红线：签名/TOFU、深检、publish 管线仍留 P2/P3 不动。

**Files**: `../oj-market/`：web/src/market（卡片网格页 + 详情抽屉 + 安装对话框/进度 + 卸载确认 + 历史页）+ api/src/market（`market_history` 迁移 + 历史读写端点 + health）+ 双语 i18n（`market:menu.*`/`market:card.*`/`market:task.*`…）+ R29 第一方专用代码注记（`_platform` 编排调用处）
**Interfaces — Consumes**（全部已有）: `GET /api/_platform/market/index`（卡片数据源：name/latest/installed/enabled/upgradable）、`POST install`、`GET task?id=`（进度抽屉 800ms 轮询）、`POST enable`、`GET meta`
- [ ] 模板套件测试：market_history 迁移往返；历史端点读写
- [ ] 前端组件测试：卡片网格渲染（含 upgradable/enabled 态）/进度抽屉终态/卸载二次确认
- [ ] `ojm build --bundle` → `ojm install` 真机自举（市场装市场，D6 P2 步前移验证）→ commit

> **状态：已完成**（2026-10-17，oj-market 仓 commit f05beab，oj-market 接手代理交付）：demo-market→oj-market 定名（非保留名 R9）、卡片网格三态/详情抽屉/安装对话框 800ms 轮询/卸载二次确认（影响面预检）/历史抽屉、market_history 迁移+历史只读端点、双语 i18n（R29 注记）；13 BDD 全绿。真机自举未跑（接手环境无 ojm CLI）——由 P1-16 真机走查收口。

### Task P1-15a：卸载服务端 + `ojm uninstall` 瘦客户端（P3 U1/U4 **前移**，用户指令）

**Files**: Modify `templates/api/src/_platform/market/api.ts`（`POST /api/_platform/market/uninstall {name}`）；Create `_lifecycle/steps/uninstall.ts`（编排器）；Modify `packages/cli/src/`（`ojm uninstall <name>` 瘦客户端）；Test 两侧
**行为**（P3 U1 语义逐字）：影响面预检（受影响角色/用户计数，可读清单）→ superadmin 门 → RBAC 双维度级联**单事务** + `invalidateAllUsers` 统一失效出口 → 锁摘除（空锁拒写红线：摘除最后条目必须拒绝）+ sidecar/state/路由/modules.json 四处摘除（setEnabled 逆操作）→ 版本目录 GC（保留 N=0 即全删；staging/tasks 清理）→ `auditOp("solution.uninstall")` → market_history 记录
- [ ] 失败测试：非 superadmin 403/影响面预检清单/级联单事务原子性/空锁拒卸/卸后重装复原（幂等）
- [ ] 跑红 → 实现 → 跑绿 → 真机冒烟（装→卸→装全链）→ commit

> **状态：已完成（两段）**——服务端先由 oj-market 接手代理落地其仓本地快照（eb84902，6 BDD；遵该仓只读规则），主线移植归位 **P1-15a-port**（28a970d5：templates `_lifecycle/uninstall.ts` + uninstall/uninstall-impact 两端点 + 6 用例 spec 适配 + `_lifecycle/history.ts` 守卫式共享出口）；templates/api 416 全绿。**ojm uninstall 瘦客户端**同提交补齐（缺口 B，+4 CLI 用例）。卸载历史已留痕；install/enable/disable 留痕亦由同提交补齐（operator 通道缺口感 P1-16）。P3 U1 残余：级联**单事务**与业务表保留提示留本期待门复核。

### Task P1-15b：oj-market 全功能装配收口（用户指令「所有功能」验收）

**Files**: `../oj-market/` 收口：卡片动作全接线（安装/卸载/启停/回滚=同版本族降装）+ 版本历史抽屉（market_history ⊕ changelog）+ 双版本卡片（upgradable 对比）+ 任务进度 800ms 轮询与失败双语渲染 + 空态/加载/错误三态
- [ ] 组件测试补齐；真机走查脚本化（装夹具→卡片出→禁用→启用→升级→回滚→卸载→历史留痕，全链 AC 断言）→ commit

> **状态：已完成**（2026-10-17，oj-market 仓 commit 28b3bd2）：卡片动作全接线（安装/卸载/启停/回滚=RollbackDialog 从 market_history 派生候选旧版降级安装）、双版本卡片、版本历史抽屉、空/加载/错误三态；前端 22 + 后端 24 BDD 全绿。真机走查脚本 `walkthrough-market-fullchain.md`（AC0-7）已备，实跑由 P1-16 收口。边界：回滚候选仅本站已装旧版（扩 IndexRow 契约留 P2）。

### Task P1-16：端到端 + 占位引导卡（R26，AC-P1 总验）

**Files**: Create `scripts/lifecycle-e2e.mjs`；Modify 管理区占位卡（web/system 或 shell 空态）
- [x] e2e 脚本：起本地 oj 静态分发源（no-cache 头断言）→ install → 不重启出菜单 → 升级 0.2.0 → 回滚 → 禁用/启用 → AC-P1-1~20 逐条断言输出报告
- [x] 占位引导卡：market 未装时管理区显示 `ojm install` 指引
- [x] 全绿 → `pnpm typecheck && pnpm lint && pnpm test && pnpm test:cli` → commit

> **状态：已完成**（2026-10-18，`task-P1-16-report.md` 全量留痕）。e2e **AC-P1-1~20 正式轮 20/20 PASS**（`scripts/lifecycle-e2e.mjs`，报告 `logs/lifecycle-e2e-report.md`）；真机走查 AC0-7 **8/8 PASS**（真实 oj-market 0.1.0 包经修复副本 `ojm build --bundle` 产出——仓内 api 模块 manifest 尚名 demo-market、模块级 tables 缺 market_history，两项发现记入报告未改仓；留档 `logs/walkthrough-P1-16-fullchain.md`）；接线收尾四点（marketEnv 生产口径 / framework.market_cdn_url settings / operator 通道 / exec opts 转发 / P1-10 五接线点）+ smoke 探针同源补全 `withSiteOrigin()`（TDD 红→绿，isolate fetch = deno_fetch 无同源 base）；长任务裁决 = 维持现状（接口本为任务模型，POST 即返 task_id，后台化 P2 观察）。验收门：根 697+1skip ✓、templates 428 ✓、cli 152+1skip ✓、typecheck ✓；lint 触达文件全净、repo 467 pre-existing（35 文件与本任务零交集，CONCERN 留 lint-sweep 任务）。CONCERN 移交：oj-bin swc minify P0（跨 await 内联折叠，`--no-minify` 逃生门）、C2-26 anonymous 运行时接线（P2）、降级拒切安装器级校验（P2）、卸载后路由 500 打磨（P2）。

**P1 DoD**：AC-P1-1~20 全绿 + 真机 kill 任一阶段自愈演示 + 集中评审合并。

### AC-P1 验收清单（BDD 锚点）

| AC | 断言 | 锚任务 |
|---|---|---|
| AC-P1-1 | 合法 bundle 安装成功，不重启出现菜单/路由 | P1-16 |
| AC-P1-2 | 带迁移模块安装后 release 重启不拒启 | P1-7/16 |
| AC-P1-3 | 同版本重装 no-op；不同版本目录共存 | P1-10 |
| AC-P1-4/5 | 升级锁迁移；回滚 seq 有差异强告警拒切 | P1-7/10 |
| AC-P1-6 | 禁用四处同写（锁/sidecar/route/modules），启用恢复 | P1-10 |
| AC-P1-7 | kill 任一阶段 → 重启对账自愈 | P1-10/16 |
| AC-P1-8/9/10/11 | 恶意 tgz/白名单外/键越空间/匿名越段 全部拒装零副作用 | P1-2/5 |
| AC-P1-12 | modules.json 并发 fetch 不见半截 | P1-9 |
| AC-P1-13 | 失败语义三分文案正确 | P1-10 |
| AC-P1-14 | 终态审计（含失败）落 oplog | P1-8/10 |
| AC-P1-15/16 | 菜单三值归并+登录后重归并；设置嵌套+脏组保存 | P1-14 |
| AC-P1-17 | 冒烟四项 | P1-9 |
| AC-P1-18/19 | 确定性 tgz sha 一致；CDN 索引 no-cache | P1-11/16 |
| AC-P1-20 | e2e 全链 BDD 绿 | P1-16 |

---

## 4. P2 · 签名+市场+深检（分支 `feat/lifecycle-p2`，期门已细化 2026-10-18）

> 粗表（D1–D5）与细化任务（P2-0~P2-16）的映射：D1→P2-0/1/2/3/4/5、D2→P2-10/11（UI 主体已前移）、D3→P2-6/7、D4→P2-8/9、D5→P2-12/13。**任务表是唯一跟踪源**，本节就地更新。任务级执行细则（接口契约/BDD 用例/纪律/派发模板，可自治执行版）见 `202610180714-lifecycle-p2-execution-plan.md`——状态仍只回填本表。

### 4.0 开工前置（期门硬条件）

1. ~~P1-16 回执三证核实~~ ✅ 已收官（2026-10-18 commit `2fdb92f8`：e2e AC-P1-1~20 20/20 PASS、oj-market 真机走查 AC0-7 8/8 PASS；其 CONCERN 逐条裁决并入 §4.1/G7 备案池）；
2. **P1 集中审查**（`fd061926..HEAD` 全量 diff + 三十余条备案池逐条裁决）为**唯一剩余前置**：通过且 `feat/lifecycle-p1` 并入集成分支后方可开工（P1 DoD 的真机 kill 自愈演示已由 e2e AC7 覆盖）；
3. P1 DoD 达成（AC-P1-1~20 全绿 + 真机 kill 自愈演示 + §7 P1 阶段小结）；
4. 本节 §4.1 期门项（G1–G8）逐条有裁决结论（未裁项不得开工对应任务）；
5. 分支 `feat/lifecycle-p2` 自**合并后**的集成分支切出；派发制与纪律同 §6/交接文档 §6（SDD 子代理 sonnet、**禁并行实现代理**、逐任务台账、阶段末一次集中审查）；
6. **串行排程**（四方评审 2026-10-18 定）：P2-0 → 1 → 2 → 3 → 6 → 4 → 5 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16。争抢同一文件的相邻任务**同一时间只有一个 owner**，后续任务以 rebase 续接：`types.ts`/`tasks.ts`/`installer.ts`（P2-3/10/13）、`market/api.ts`（P2-2/3/9/11）、`steps/verify.ts`+`state.ts`（P2-3/6）、CLI `site.ts`/`install.ts`/`index.ts`（P2-3/4/12/14）；
7. 每任务派发前**以任务表 Files/Test 列为封锁面**（对照 P1 每任务「**Files**: Create…; Test …」惯例），不得口头扩范围。

### 4.1 期门评审清单（开工前逐条裁决，结论留痕）

| # | 议题 | 裁决 | 影响任务 |
|---|---|---|---|
| G1 | **分发形态**：0.1.77 `mounts[].api` URL 挂载（dist 根 tarball + sha256 锚）是否兼作方案包通道 | **建议不兼走，留痕**：URL 挂载面向整站 dist 根、装配期直接入内容寻址缓存，跨过了安装器的 staging/验签/迁移/注册/锁账/sidecar 全链；方案包 tgz 为唯一载体。上游形态记入 devkit「打包与分发」辨析项（P1-11 已落同款辨析），不推翻 v3 架构 | 无（裁决即结案） |
| G2 | **exec 流式（0.1.78）** 两项候选：① `onStdout` 增量刷 TaskRecord 进度 ② `h.kill()` 取消安装 | **① 采纳**（P2-12，feature-detect `exec.spawn` 存在性，缺失回落 stage 粒度）；**② 转 P3 评估并留痕**——取消须连带 staging 清理、账本对账与 D11 失败语义三分配套，成本高于本期收益，不在 P2 引入半成品取消语义 | P2-12 |
| G3 | **TOFU 形态**（设计 D1 留的 C4 待定项） | ✅ **已裁（2026-10-18，用户）：双轨**——宿主信任库 `.solutions/trusted-keys.yaml`（可随宿主预置第一方 key 免 TOFU）+ 未知 `key_id` 首次装由 CLI/市场页展示指纹确认后入库并审计。设计文档 §0 回填为 D15（待期门通过后执行） | P2-2/3/4 |
| G4 | **未签名/签名不符包的处理** | ✅ **已裁（2026-10-18，用户）：硬 fail-closed，不留开关**——缺签名、验签不过、格式错一律拒装零落盘；无 `solution_allow_unsigned` 类逃生门（R10/契约 C2-29 原口径）。设计文档 §0 回填为 D16。**四方评审补裁（待用户追认）：签名载体统一为 detached 侧车 `<name>-<version>.tgz.sig`**（alg/key_id/public_key/value/canon），与 Form B 的 `archive.signature` 同源——既有 Form A 禁带 signature 的自引用悖论（B-2），故 file 源（本地 tgz，P1 全部真机验证/教学主路径/市场自举都走它）否则在 G4 下必拒；`ojm install <tgz>` 自动探测同目录 `.sig` 随包上传，缺签即拒 | P2-0/3/4 |
| G5 | **key 轮换/吊销语义**（R10 后半） | **建议**：信任库按 `key_id` 多键共存 = 轮换过渡期（新旧键签名包均可装）；吊销 = 从信任库移除该 `key_id`（**只阻断新装/升级，不动已装方案**，避免存量站点因吊销整体不可用）；移除动作审计留痕。设计文档 §0 回填为 D17。**四方评审细化（与 D11③ 调和）**：① 升级/回滚/降级需重新取包 → 走完整验签，**key 已吊销即拒**；② **启用（enable，原版本恢复）不算新装 → 放行 + 显著告警 + 审计 + 深检标 `untrusted`**（保可用性承诺、风险可见）；③ 同 `key_id` 换公钥 = 独立错误码，**首次绑定不可改**（轮换 = 新增 key_id，非覆写） | P2-2/3/6 |
| G6 | **oj-market 侧遗留的执行主体** | **本仓只交付契约与端点**；UI 面（IndexRow `available` 消费、operator 列、自升级提示、深检 i18n 前端执行、报告展示）记入 `../oj-market` 遗留清单，由接手代理或用户执行——该仓**只读**红线不变 | P2-7/10/11 |
| G7 | **P1 集中审查备案池归 P2 的条目** | ✅ **已裁（2026-10-18 集中审查，`review-p1-findings.md`）**：defer-P2 五项就地补录——① `archive.size` 未比对（sha256 已 fail-closed，size 归并 P2 深检，P2-11 已含下载后比 size）② deployWeb 派生条目缺 dependencies/version/chunks（完整条目 extras 透传缺口）③ 组级 `label_key` 被 declOf 丢弃（DB 组标题回填）④ C2-26 anonymous 运行时接线 ⑤ 宿主层深执法（rollbackGuard applied[] 近似口径升级）。另有 ratify 33 / fix 2（修复波）/ 记录 3 → 承载任务 P2-15 | P2-15 |
| G8 | **oj-market 侧 UI 交付主体**（四方评审新增，产品阻塞） | ✅ **已裁（2026-10-18，用户）：授权修改**——P2 窗口期**最小 UI 消费面**由指定代理在 `../oj-market` 实施，范围钉死四件：TOFU 确认界面、深检报告展示、占位卡两态、自升级提示；契约与验收脚本由本仓出；**只读红线在窗口内对该范围豁免，窗口结束恢复**（其余文件仍只读）；相关 AC 的 UI 部分按此验收，不再移出 | P2-3/8/11/12 |

### 4.2 契约增补（先于一切代码，文档先行铁律）

| # | 任务 | Files / Test | 原则 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| P2-0 | C2 契约 v1.2 增补 + 签名载体裁决：① **detached 侧车签名 `<name>-<version>.tgz.sig`**（`alg`/`key_id`/`public_key`/`value`/`canon`）为统一载体，Form B `archive.signature` 与之同源（消解 Form A 自引用悖论 B-2；file 源与 CDN 源同一信任模型，G4 补充裁决）② `public_key` hex 64 必填（**验签需要公钥，且 TOFU 无公钥无从钉定**），指纹 = `sha256Hex(publicKey)` 全 64、UI 分组展示 ③ `key_id` 白名单 + 命名空间（建议 `<publisher>.<id>`，禁裸通用名——防抢注/碰撞，R9/R24 同款洞）④ **首次绑定不可改**：同 `key_id` 异公钥 = 独立错误码；轮换 = 新增 key_id，禁覆写 ⑤ `verifyEd25519` 编码约束入契约（`value` 仅标准 base64、禁 base64url；`public_key` 仅 32B raw 的 hex，禁 PEM/SPKI）⑥ 深检报告 item 结构（`id`/`severity`/`subject`/`advise_key`，双语可读可行动）⑦ IndexRow 增 `available[]`/`changelog`/`trust_state`/`publisher`；**`operator` 回落 history 行**（挂卡片行是语义错位）⑧ 切换前复验（D11③）口径：升级/回滚走完整验签、enable 放行+告警 ⑨ 老 Form B 缺 `public_key` = 拒装（G4）+ 迁移指引（契约 append-only 的例外，须明写） | Files: `docs/prd/solution/202610171254-lifecycle-manifest-contract.md`、夹具 `packages/cli/src/lifecycle/__tests__/fixtures/`（签名链三枚：已签/篡改/未知 key，由 Node 生成后**提交为产物**）、教学文档 §坑表、devkit 提纲<br>Test: 双端断言「规范串逐字 + 指纹值 + 验签结果」三同一 | ISP / DRY（夹具双端共用） | ✅ 完成 `ee9cff1d` | 2026-10-18 | ≈0.3h |

### 4.3 签名链（D1）

| # | 任务 | Files / Test | 原则 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| P2-1 | 签名纯函数 + 密钥工具 + **测试密钥与夹具 helper**：`canonicalString(name, version, sha256)`（同 C2-29 / devkit 示例）、`generateKeyPairSync("ed25519")`、`signCanonical → base64`、公钥导出 32B raw hex；**交付共享测试密钥与 `signedArchiveFor(bytes, name, version)` helper**——测试运行时算摘要与签名，**替代硬编码常量**（现有 ~25 处安装路径用例走真实 verify/install 且夹具全未签名，G4 下必被打红） | Files: `packages/cli/src/lifecycle/{sign,keygen}.ts` + `__tests__/`<br>Test: 规范串逐字、签/验往返与 Node `crypto.verify` 对拍、确定性（Ed25519 确定性）、编码面与 isolate 兼容（标准 base64 / raw key） | SRP / DIP | ✅ 完成 `db0c4e07` | 2026-10-18 | ≈0.3h |
| P2-2 | 宿主信任库（isolate）+ **可操作面**：`_lifecycle/trust.ts`（`createTrustStore(path, {fsFace})` 工厂 + 注入面，模块级零全局触碰空沙箱红线）——`.solutions/trusted-keys.yaml`（`key_id → publicKey hex`）+ 原子写（D13）+ `.bak` + 损坏可读报错 + **add/remove 两条语义禁覆写**（G5）+ 移除即吊销且审计；**最小运维面**（superadmin 端点 + `ojm trust ls/add/revoke`，复用同一原子写与 audit——否则吊销只能手改 yaml，绕过原子写与审计）；**路径红线 spike**：复核信任库/staging 是否落在 `fs: {root: ., readonly:false}` 共享可写 jail 内（真机验「普通方案模块能否写 `modules/.solutions/`」），能写则记红线并转 P3/上游需求 | Files: `_lifecycle/trust.ts`、`market/api.ts`、CLI `trust.ts`<br>Test: 空/损坏/.bak 恢复/多 key/未知/移除后拒装/并发读不见半截/变更审计 | DIP / DRY / 安全 | ✅ 完成 `116035d7` | 2026-10-18 | ≈0.6h |
| P2-3 | verify 段验签 + TOFU 终态（fail-closed）：**结构校验先行**（`alg==="Ed25519"` 枚举、`key_id` 白名单、`public_key` 严格 `^[0-9a-f]{64}$`、`value` 严格标准 base64 **禁 base64url 归一**）→ 规范串 → 信任库比对（未知 → `needs_trust`；已信任且公钥不一致 → 独立错码；已信任 → `crypto.verifyEd25519` 注入面，**原语不可得 = 拒装**，同 sha256Hex 口径）。双层语义：格式错抛错（文案 `verifyEd25519: ` 起头）与 `false` 同拒装**但分码**、`retryable=false`。`StageResult`/`TaskError` 增 `code` 六码（`sig_missing`/`sig_alg`/`sig_key`/`tampered`/`unknown_key`/`sig_format`）+ `reasonKey`。**终态与消费面四处同改**：`TaskStatus` 增 `needs_trust`、`TaskRecord.trust{key_id, fingerprint}`、`installer.ts` 遍历器一处处置（保 OCP，**staging 不清场**供重试：CDN 源自动重下，file 源须重传）、CLI `renderOutcome`/`site.ts`（**除 `done` 外一律非成功**，否则待确认被画成成功绿勾）。新增 `POST /api/_platform/market/trust`（superadmin，R9）**入参仅 `{task_id}`**——服务端自任务记录重取公钥并与确认指纹逐字比对，**只允许新增不允许覆盖**（防混淆代理：人确认 A、库里落 B） | Files: `steps/verify.ts`、`types.ts`、`installer.ts`、`market/api.ts`、CLI `site.ts`/`install.ts`<br>Test: 六码齐报且**零解压零落盘**、TOFU 确认→重试可装、拒绝→不装、旧消费面不误显成功、trust 端点覆盖攻击 | LSP / fail-closed | ✅ 完成 `f771b94e` | 2026-10-18 | ≈1.2h |
| P2-4 | CLI `ojm keygen` / `ojm sign`（产出 detached `.sig`）：私钥**默认 `~/.ojm/keys/<id>`**（`--out` 才可改，落工程树即 `--yes` 显式确认/否则拒签——防被 `bundle` 打进包或被 web 挂载服务）；**`bundle` 增 `*.pem`/`*.key`/`.env`/`id_ed25519`/`id_rsa` 入包红线**（与「modules.json 禁入包」同款）；`ojm sign --check` 离线自检（作者不必靠宿主装失败来发现签错）；`ojm install <tgz>` 自动探测同目录 `.sig` 并随 multipart 上传（P2-3 已落）；`ojm build --bundle` 只出包不签名 | Files: `packages/cli/src/{keygen,sign,bundle,index}.ts`（install/usage 接线缺口属 P2-12）<br>Test: 参数解析、`.sig` 字段齐备、入包红线、私钥落点/Ed25519 签验 | DRY | ✅ 完成 `791c7b29` | 2026-10-18 | ≈0.6h |
| P2-5 | 失败文案 + 审计 + 脱敏：`lifecycle.stage.verifying.*` 与 `lifecycle.trust.*` **六码双语**（R28/C2-25 纪律）+ **渲染层 fail-fast 测试**（现状只测「key 存在」会假绿，须测实际渲染）；**reason 走 key**（现 `error.reason` 是服务端渲染的中文串，英文用户读到中文）；`auditOp`（框架 oplog）为**唯一审计真源**（`market_history` 属市场方案自带表、可被第三方读写，仅作展示面并注明可抵赖）；记 `key_id`+指纹+operator（**operator 不可得记 unknown 并告警，不静默 null**）；**`redact` 增 PEM/`private_key` 规则**，同时**钉用例「`key_id` 与指纹明文保留」**（指纹/key_id 走结构化字段，不进 message 免被脱敏吞掉） | Files: `tasks.ts`、`installer.ts`、templates locales、CLI `install.ts`<br>Test: 双语齐备、脱敏双向断言、审计字段齐、渲染不漏 key | DRY（文案单一来源） | ✅ 完成 `5e528239` | 2026-10-18 | ≈0.8h |

### 4.4 切换前复验 + 深检（D11③ / D3）

| # | 任务 | Files / Test | 原则 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| P2-6 | **切换前复验含验签（D11③/R11，四方评审新增的阻塞项）**：现状 `setEnabled` 只 `dirExists` 即加锁四处同写、`verifyTarget` 自认「sha256 不在此重做」、版本目录内是 oj 原生清单无 sha256/签名 ⇒ 复验**无真源**。本任务：sidecar `SolutionEntry` 增 `archive{sha256, signature, key_id}`（随安装落，作复验真源）；**升级/回滚/降级 = 重新取包 → 完整验签，key 已吊销即拒**；**enable（原版本恢复）不算新装 → 放行 + 显著告警 + 审计 + 深检标 `untrusted`**（G5 细化）；文案与审计区分两条 | Files: `state.ts`、`types.ts`、`installer.ts`<br>Test: 吊销后升级拒、enable 放行带告警、sha256 不符硬拒、sidecar 缺失的降级口径、夹具覆盖「吊销→禁用→启用」 | DIP / 安全 | ✅ 完成 `721894c3` | 2026-10-18 | ≈0.5h |
| P2-7 | 深检后端四项 + 端点（**全程不触 exec**）：端点 `POST /api/_platform/solutions/verify?name=`（模板 http 面**无路径段先例**，照 `contacts/detail?id=` 走 query，同步修订设计 §4.2 的 `:name` 口径）。四项：① 路由可达（复用 `withSiteOrigin` 拼绝对 URL；**声明了 `required_permission` 的路由遇 403 标「未以目标身份验证，未校验」，不判通过**——防 RBAC 缺失假绿）② RBAC 完整性 ③ 设置项完整性（**只比 key/存在性/定义列，不报值**；secret 走既有掩码读取面）④ 迁移账本 —— **走 `db.query _oj_migrations`（复用 `journalHeadOf`，DRY）而非 `oj migrate --format json`**（后者是执行语义、需新增 exec 模板且违反 R9「exec 特权应 superadmin」的论证，与 admin 域自相矛盾）。纯函数优先 `diffRouteRows`/`diffPermRows`/`diffSettingRows`/`diffLedger` | Files: `solutions/api.ts`、`_lifecycle/verify-checks.ts`<br>Test: 四项各一过例一异例、端点门（401/403/404）、**SSRF 钉**（route path 永不出站、`host`/`x-forwarded-proto` 清洗、禁跟随重定向） | SRP / ISP | ✅ 完成 `c27804d5` | 2026-10-18 | ≈0.9h |
| P2-8 | 深检报告结构 + 留存 + 可信性项：item = `id`/`severity`/`subject`/`advise_key`（双语可读可行动，避免「管理员看得见但不知怎么做」）；**增「发布方 key 状态」项**（`trusted`/`untrusted`/`absent`——G5 吊销后已装方案继续运行却无人知晓）；报告落 `.solutions/verify-reports/`（保留 N=10，与 U2 GC 统一「时间序保留 + 触发点」一份口径）+ `GET .../verify/last`；i18n 项本仓**只下发待查 key 清单**，前端执行判 oj-market（G6/G8），缺执行**降级「未校验」不阻断** | Files: `solutions/api.ts`、`_lifecycle/verify-report.ts`<br>Test: 报告结构、保留 N、最近一次读取、损坏不炸、降级项 | DRY / SRP | ✅ 完成 `40515220` | 2026-10-18 | ≈0.7h |

### 4.5 市场契约握手与索引（D4/D2 残余）

| # | 任务 | Files / Test | 原则 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| P2-9 | `peerPlatform` 预检强制（C2-11 P2+ 执行点）+ `/market/meta` 语义：`API_VERSION` 定 major/minor 语义并**钉 0.x 口径（0.x 下 minor 视为不兼容，`^` 语义随之定义）**；**加 pair-pin 测试**防 `API_VERSION`（`market/api.ts:31`）与模块版本手工镜像漂移；preflight 增 `peerPlatform` 规则（真源注入，算子集同 C2-09：精确/`>=`/`^`）；明确 meta 实际消费方（CLI 预检/人工；market 自身安装时尚未装入，由安装器对自身 `API_VERSION` 静态比对） | Files: `steps/preflight.ts`、`market/api.ts`<br>Test: 兼容过/不兼容拒（含升级指引）/算子三例/版本 pair-pin | DIP | ✅ 完成 `5402b0b5` | 2026-10-18 | ≈0.6h |
| P2-10 | TaskRecord `schemaVersion`（R23）+ `needs_trust` 兼容 + 进度字段：缺省回填 `1`、升版纪律与不认识高版本的降级提示；**旧消费面（800ms 轮询、`renderOutcome`）在新增终态下不炸**（配 P2-3 四处同改） | Files: `types.ts`、`tasks.ts`、CLI `site.ts`<br>Test: 缺省回填、高版本降级、旧消费面兼容 | OCP | ✅ 完成 `6e2d7f59` | 2026-10-18 | ≈0.5h |
| P2-11 | IndexRow 扩展 + **索引投毒加固**：`available[]`（CDN 版本列表，回滚候选不止本站已装旧版——P1-15b 边界）、`changelog`（C2-08）、`trust_state`、`publisher/key_id`；**`operator` 回落 history 行**（挂卡片行是历史动作语义错位）；**`archive.file` 收紧 `<name>-<version>.tgz` 逐字**（现正则过弱，CDN 篡改索引可拼出宿主他文件路径）+ **下载后立即比 `archive.size`**（防放大/错配）；**索引本身未签名**——低成本加固落本任务，索引签名归 P3-U3 并在期门留痕；`Cache-Control: no-cache` 不变（R15） | Files: `market/api.ts`、`steps/download.ts`<br>Test: 聚合字段齐、file 形状拒例、size 不符拒、no-cache 头、CDN 不可达降级 | ISP | ✅ 完成 `85500f08` | 2026-10-18 | ≈0.7h |
| P2-12 | CLI 引导装 market 本身（D6）+ **第一方 bootstrap key** + 占位卡两态 + 自升级提示（R27）：**模板内置第一方 `publicKey`+`key_id` 免 TOFU**——已定性（2026-10-18，用户）：`ojm keygen` **新生成 Ed25519 对**，私钥用户持 `~/.ojm/keys/<id>` 永不入仓；**既有两对 pem 不可复用**（站点 `api/config/` 的 RSA-2048 cert 对 = 站点 auth 基础设施、X25519 secrets 对 = 加密面，均非 Ed25519 签名，且 per-site 生成、private.pem 已入 walkthrough 日志=暴露面烧毁）；发布时 `ojm sign` 签 oj-market 首发包，提供签名产物与校验步骤，否则 AC 只能在伪造 CDN 上演示；占位引导卡改两态（未装 → `ojm install market`；被拒 → 「未通过签名校验」+ TOFU/联系发布方指引，双语）；市场自升级提示随 G8（已授权）在该仓实施 | Files: CLI `install.ts`/`usage.ts`、templates 内置 key、web/system 占位卡<br>Test: 引导文案双语、未装/已装/被拒三态、bootstrap key 生效 | — | ✅ 完成 `cb978391`（占位卡两态归 oj-market 仓，备案①） | 2026-10-18 | ≈0.8h |

### 4.6 任务治理、文档与收官（D5）

| # | 任务 | Files / Test | 原则 | 状态 | 开始 | 耗时 |
|---|---|---|---|---|---|---|
| P2-13 | 任务治理核查 + 进度粒度升级：**逐条回归核实** `tasks.ts` 既有治理（TASK_KEEP 10/超时 failed/`redact`/`sweepTimedOut`）是否真被 `installer` 调用（不只要存在，要有调用证据）；`onStdout` 进度 **必须在回调内自累积字节缓冲**——devkit 明示带回调时 `exec.run` **不再返回整段 stdout**，否则 `parseMigrateOutput` 拿不到 JSON、`appliedSeq` 丢失，连带禁降版守卫与 `reconcile` floor 失效；`ExecFace` 先扩 `opts.onStdout`；feature-detect `exec.spawn` **双路径均用例**；取消安装（`h.kill()`）维持转 P3（G2） | Files: `tasks.ts`、`installer.ts`、`steps/migrate.ts`、`steps/extract.ts`<br>Test: 有/无 spawn 双路径、**断言 `appliedSeq` 仍在**、进度字段不破坏消费面 | OCP / DIP | ✅ 完成 `1600afb4` | 2026-10-18 | ≈0.8h |
| P2-14 | **文档包与真源同步**（文档先行铁律，四方评审一致指出缺口）：devkit 手册「打包与分发」正式章节（P1-11 承诺未落地，`docs/devkit/manual.md` §7 至今只讲站点级 build）+「签名与信任」章节；三视角指南（202610171354）三视角与交付期更新（其 §3.3 已向管理员承诺尚不存在的深检按钮）；教学文档 §6 主路径改为 `build --bundle` → `sign` → `install` 并补签名坑进八坑表；**`openapi.json` + `__client` + init 测试三处同步**（含 `market/*` 全族既未登记的补登裁决——`export default createMarketApi(...)` 是 CallExpression，handler-scan 不认，`ojm api --check` 的 route-unregistered 守卫当前对市场面失效） | Files: `docs/devkit/manual.md`、指南/教学文档、`templates/openapi.json`、`web/src/_platform/__client/api.ts`<br>Test: 文档存在性断言 + `ojm api --check` 全绿 | — | ✅ 完成 `a18f393f`（market 全族补登裁决=修 handler-scan 认 CallExpression，优先项） | 2026-10-18 | ≈1.0h |
| P2-15 | **P1 备案池归 P2 条目（G7）承载任务**：集中审查逐条裁决后就地展开（候选：P1-14 组级 `label_key` 缺口、P1-12 `task?id=` 形态校准、P1-9 modules.json 完整条目透传、P1-6 `archive.size` 未比、P1-5 version 严于契约字面回调、**`GET /market/index` 每次刷帧触发 `reconcile` 写状态（含摘锁）且对账依赖可能被 GC 的任务记录**——建议改显式触发/只读报告）。无此承载行，G7 条目易在派发中丢失 | Files: 随裁决<br>Test: 随裁决 | — | ✅ 完成 `cef237eb`（② extras/③ 组标题/④ anonymous 落码；① 销项；⑤+P1-16④ 移交宿主仓留痕） | 2026-10-18 | ≈0.9h |
| P2-16 | P2 端到端 + 真机走查：宿主重建子任务前置（templates 改动须 rsync→重建→**重启 oj serve**，P1 最大时间黑洞）；`scripts/lifecycle-e2e.mjs` 扩展（干净库起跑，签名链三态 + 深检 + 握手 + 索引）；真机 AC0-7 **扩 P2 断言**（未签名装不上 / 篡改包不落盘 / TOFU 确认 / 吊销后拒升级）；**AC 逐条标注 auto/manual**（见 AC 表「断言方式」列，避免 DoD 被笼统的「真机演示」收口）；全绿 + `pnpm typecheck && pnpm lint && pnpm test && pnpm test:cli` | Files: `scripts/lifecycle-e2e.mjs`<br>Test: 三条基线不得回退（根套件 697+1skip / templates 416 / `test:cli` 152+1skip）+ **夹具签名改造清单**（P2-1 helper 到位后全量改造） | — | ✅ 完成 `8976ef8e`（e2e 29/29 + 走查 14/14，oj 0.1.80 真宿主；基线 root 702+1 / templates 559 / cli 225+1） | 2026-10-18 | ≈1.5h |

### AC-P2 验收清单（BDD 锚点）

| AC | 断言 | 断言方式 | 锚任务 |
|---|---|---|---|
| AC-P2-1 | 缺签名（Form B 缺 `signature` / **file 源缺 `.sig`**）→ 拒装零落盘（G4 硬 fail-closed） | auto | P2-3/4 |
| AC-P2-2 | 签名不符（篡改 tgz / 错 key / 错 alg / 格式错 / base64url 变体）→ 六码分码拒装、零解压零落盘 | auto（+manual 真机演示） | P2-3/16 |
| AC-P2-3 | TOFU：未知 key_id → `needs_trust` + 指纹；确认后入信任库可装；拒绝不装；**旧消费面不把待确认渲染为成功** | auto | P2-3/10 |
| AC-P2-4 | 双 key 轮换共存期旧键包可装；移除（吊销）后**新装/升级拒装**，已装方案不动（G5） | auto | P2-2/6 |
| AC-P2-5 | 深检四项报告齐（可达/RBAC/设置/账本）+ `advise` 双语可读可行动；**设值不进报告** | auto | P2-7/8 |
| AC-P2-6 | `peerPlatform` 不兼容拒装 + 可读升级指引；`API_VERSION` 与模块版本 pair-pin 不漂移 | auto | P2-9 |
| AC-P2-7 | TaskRecord 带 `schemaVersion`，旧消费面与新增终态下不炸 | auto | P2-10 |
| AC-P2-8 | IndexRow 版本列表/`trust_state`/`publisher` 契约齐；`archive.file` 逐字 + `size` 比对生效 | auto（UI 可见部分随 G8） | P2-11 |
| AC-P2-9 | CLI 引导装 market 本身 + 第一方 bootstrap key 免 TOFU + 占位卡两态 | auto | P2-12 |
| AC-P2-10 | 市场全动作真机走查（AC0-7 + P2 扩展断言）全绿 | manual | P2-16 |
| AC-P2-11 | 进度粒度：有 `exec.spawn` 出输出级进度且 **`appliedSeq` 不丢**，无则回落 stage 级 | auto | P2-13 |
| AC-P2-12 | 签名失败/信任变更（`key_id`+指纹+operator）全留痕，私钥永不入日志/任务记录/包内 | auto | P2-5 |
| AC-P2-13 | **切换前复验含验签**（D11③）：吊销后升级/回滚拒；enable 放行带告警+审计+深检标 `untrusted` | auto | P2-6 |
| AC-P2-14 | **信任库可操作**：吊销/恢复经 superadmin 通道 + 原子写 + 审计；损坏可读报错可恢复 | auto | P2-2 |
| AC-P2-15 | **key_id 防抢注**：命名空间生效、首次绑定不可改、同 id 异公钥独立错码 | auto | P2-0/2/3 |
| AC-P2-16 | 文档包齐（devkit 两章节/三视角指南/教学主路径）+ `ojm api --check` 全绿 | auto | P2-14 |
| AC-P2-17 | e2e 全链绿 + 三条测试基线零回退（含夹具签名改造清单） | auto | P2-16 |

**DoD**：AC-P2-1~17 全绿（UI 可见部分按 G8 裁决落地或公开记 §7 遗留）+ **未签名装不上、签名不符不落盘**真机演示 + 集中评审合并 + §7 写 P2 阶段小结（照 P0/P1 小结格式）。

### 4.7 上游对账评估输入（期门读本 · 结论见 G1/G2，原文保留备查）

> **上游对账评估输入（2026-10-17，oj 0.1.77，含上游详细口径）**：`mounts[].api` 支持 `http(s)://` URL 指向 dist 根 tarball，装配期拉取、解压到内容寻址缓存 `<cache>/<sha256>/`（缺省 `<config_dir>/.oj-cache`），以 release 语义服务；`sha256`（64 hex）必填否则 fail-fast；解压 fail-fast 与本地 dist/ 同口径（产物根须含 manifests.yaml；tar-slip / 符号链接 / 特殊文件 / 总量 4 GiB·条目 10 万·单条 1 GiB 超预算拒启）；命中缓存按 sha256 复用、损坏自动重拉、同 URL 物化互斥串行化；`--api-path` 不接受 URL。打包 `oj build --bundle` = 整站 dist 根空前缀 tarball + 打印 sha256。P2 期门须评估：方案包分发是否改走/兼走该形态（URL 挂载解决取包与完整性，安装器仍持迁移/注册/锁账/sidecar——互补而非替代，不推翻 v3 架构）；若兼走，`bundles.yaml`/CDN 索引与 dist 根 tarball 的形态归一化在期门裁决。三份上游需求稿（OJ-6/8/9）0.1.77 未包含，且同日**上游终裁三稿均不采纳**（裁决理由与消费方处置见各稿「上游终裁」节）——P1 现行路径（exec.run 迁移子进程、rollbackGuard 禁降版、Windows 文档兜底）即长期形态。

> **上游对账评估输入（2026-10-17，oj 0.1.78 = exec 流式形态）**：`exec.spawn(argv, opts?)` 返回句柄 `{rid, pid, stdout, stderr, kill, exit}`（stdout/stderr 为 `AsyncIterable<Uint8Array>`，`for await` 逐块消费、`h.exit()` 取退出码、`h.kill()` 整组击杀）；`exec.run` 扩展 `onStdout`/`onStderr` 增量回调（返回 `{code}` 不缓冲整段），**无回调时与 0.1.75 行为/返回形状完全一致**（向后兼容，0.1.75 地板不变）。共用硬限制：`timeoutMs` 缺省 **30_000**、硬上限 **600_000** 钳制；输出 **10 MiB** 上限；有界 mpsc 背压（16 槽 × 8 KiB，不消费流则子进程阻塞——消费方必须持续消费）；句柄 rid 进 resource_table，close 同步整组击杀；安全闸门（per_module 授权/argv 模板白名单/占位符）与缓冲形态一致。消费方处置：① **P1 修正项（P1-13c）**——`steps/migrate.ts` 的 `exec.run` 未传 `timeoutMs`，落在 30 s 缺省上，生产级数据迁移超 30 s 即被杀（retryable fail）；须显式传 `timeoutMs: 600_000`（平台硬上限内取满）；10 MiB 输出上限对 `migrate --format json` 量级安全，备案。② **P2 新输入**——迁移段进度可经 `onStdout` 增量刷 TaskRecord（市场进度抽屉从 stage 粒度升级到输出粒度）；`h.kill()` 为「取消安装」能力候选（P2/P3 评估，须连带暂存清理与账本对账语义）；流式为可选增强，消费前 feature-detect `exec.spawn` 存在性。③ **devkit 须落**——迁移作者约束：单次 `oj migrate` 必须在 **10 min** 内完成（exec 平台硬上限），超限迁移须作者分块；OJ-6 终裁维持不变——0.1.78 属 exec 面自身增强，无内嵌化需求。

## 5. P3 · 减法与分发（分支 `feat/lifecycle-p3`，期门细化）

| # | 任务 | 交付 / AC | 状态 |
|---|---|---|---|
| U1 | 卸载：影响面预检（受影响角色/用户计数）→ superadmin 二次确认 → RBAC 双维度级联**单事务** + `invalidateAllUsers` 统一失效出口（承接 rbac-isolation §8.3/8.4）+ 业务表保留提示 | AC-P3-1/2/5 | **前移已落地**（P1-15a + P1-15a-port：预检/superadmin 门/级联/invalidateAllUsers/四处同删/历史留痕）；残余：级联单事务与业务表保留提示留本期待门复核 |
| U2 | GC 内建 install：state.yaml 时间序保留 N=3，与回滚靠 lock 互斥 | AC-P3-3 | 未开始 |
| U3 | `ojm publish` + bundles.yaml/manifests.yaml 索引重算（no-cache 头） | AC-P3-4 | 未开始 |
| U4 | `ojm uninstall` 瘦客户端 | 随 U1 | **已前移落地**（P1-15a-port 28a970d5，+4 CLI 用例） |
| U5 | **取消安装**（`exec.spawn` 句柄 `h.kill()`，0.1.78）——P2 期门 G2 转入：须连带 staging 清理、账本对账与 D11 失败语义三分配套 | AC-P3-6（待定） | 未开始（P2-12 只做进度，不做取消） |
| U6 | **信任库存放位置加固**（P2-2 红线 spike 结论，2026-10-18）：devkit 0.1.75 语义下 `fs:` 段对**全部模块**生效（jail=`fs.root`），`platform.trusted_paths` 只增不减——`.solutions/trusted-keys.yaml` 落在 root 内即可被已装第三方模块写（伪造信任锚）。威胁模型有界（须已有恶意方案落地 ≈ 等价越权），P2 接受保留；P3 候选 = 信任库移出 `fs.root` + `platform.trusted_paths` 显式授权（仅 `_platform` 特权可写），或上游提供 per-module fs 命名空间 | — | 未开始（真机确认留 P2-16 走查） |

**DoD**：AC-P3-1~5 绿；卸载重装不复活授权真机演示；集中评审合并。U1 残余（级联单事务 / 业务表保留提示）与 P2 期门 G7 一并复核。

## 6. 风险与依赖

| 风险 | 应对 |
|---|---|
| C1 裁决不利（共享根形态需安装器改写既有挂载） | D3 已列候选与迁移路径；裁决前不启动 P1-6 之后的 FS 步骤实现 |
| 长任务形态受限（isolate 请求作用域） | S1-7 双候选都已论证；分段执行+状态文件续跑为兜底；0.1.78 exec 流式（onStdout 增量回调）令迁移段可在请求作用域内实时刷 TaskRecord 进度（P2 消费，形态不变） |
| oj build introspect 空沙箱红线（RBAC §9.4 先例） | `_lifecycle` 模块级语句禁触碰运行时全局（jwt/db/axis），全部收进函数——列入集中评审 checklist |
| Windows tar / EPERM | OJ-8 终裁未采纳（Windows exec 模板写 `cmd /c`）；R30 路径 POSIX 化 + 可读报错，Windows 列已知限制 |
| 两运行时契约漂移 | 夹具双端测试（P1-11）为门禁；P2-0 契约增补（含签名夹具三枚）后双端夹具须同步重跑 |
| 验签双层语义被吞（`verifyEd25519` 格式错**抛错** vs 验签不过**返回 false**） | P2-3 分码处置，抛错须 try/catch 转拒装（isolate 禁 `console.*`，异常消息进任务记录）；两种均 `retryable=false` |
| 公钥随包带来的首次绑定投毒窗口 | TOFU 指纹人工确认（G3）+ 审计；第一方 key 随宿主 bootstrap 覆盖免 TOFU；信任库绑定比对（同 key_id 换公钥=拒装） |
| 吊销过激致存量站点不可用 | G5 语义：吊销只阻断新装/升级，不动已装方案 |
| 深检路由可达性凭证形态 | 照 S1-5（进程内自检 token / 匿名 health）；2xx/401/403 判可达、404/5xx 判异常（期门 G7 补裁） |
| exec 流式 feature-detect 分支漏测 | P2-12 有/无 `exec.spawn` 双路径均须用例；无 spawn 回落 stage 粒度不得破坏既有消费面 |
| oj-market 仓只读，UI 遗留无人接手 | G6：本仓只交付契约与端点，UI 记遗留清单交用户/接手代理；G8 待裁是否授权最小 UI 面，未授权则相关 AC 的 UI 部分移出 P2 并公开记遗留 |
| **现有夹具全未签名**（~25 处安装路径用例走真实 verify/install） | G4 无逃生门 ⇒ 必被打红。P2-1 交付共享测试密钥 + `signedArchiveFor()` helper，测试运行时算摘要/签名替代硬编码常量；P2-16 附夹具改造清单 |
| **`onStdout` 令 `exec.run` 不再返回整段 stdout** | 回调内自累积字节缓冲并跨块拼接（migrate 输出恰一行非行对齐），断言 `appliedSeq` 仍在，否则禁降版守卫与 `reconcile` floor 失效 |
| 信任库/staging 落在 `fs: {root: ., readonly:false}` 共享可写 jail | P2-2 真机 spike 验「普通方案模块能否写 `modules/.solutions/`」；能写则收 `platform.trusted_paths` 或记红线转 P3/上游需求，并钉回归用例 |
| 索引（`bundles.yaml`）未签名，CDN 可钉旧版/拼路径 | P2-11 低成本加固（`archive.file` 逐字 + `size` 比对）；**索引签名归 P3-U3** 并在期门留痕 |
| 私钥落工程树被 `bundle` 打进包或被 web 挂载服务 | `ojm keygen` 默认 `~/.ojm/keys/<id>`、`--out` 才改；`bundle` 增 `*.pem`/`*.key`/`.env` 入包红线 |
| 契约 `public_key` 必填 与 契约 append-only 冲突 | C2 v1.2 明写「老 Form B 缺 `public_key` = 拒装（G4）+ 迁移指引」，不给静默兼容路径 |

## 7. 阶段小结（滚动追加）

- **P0**（2026-10-17 1149–1422，全部完成，总耗时 ≈2.5h；分支 `feat/lifecycle-p0`，19 commits）：
  - **关键过程**：C1 spike 实测六项架构前提（共享根 release 形态成立、exec.run tar 三步范式成立、**锁原子但无互斥（实测吞写）→ 安装器写后读回收敛**、reload_api 全链路、M003/M004 拒启契约、tasks 轴 exec 恒拒 → 长任务定稿分段执行+状态文件）→ C2 契约 v1.0→v1.1（C2-01~33，oj manifest.rs 七字段逐字段对照；夹具双枚）→ C3 拍板 D14 → C5 手册提纲 → C6 基线回写（迁移后落锁、锁摘除禁用两处实质修订落基线）→ C7 三视角生命周期指南（**钉出并推动契约 v1.1 C2-33 health 缺口**）→ C4 上游三份自包含提交稿（用户选定手动提交）→ 终审三发现（F1 任务表回填/F2 迁移语义三处矛盾/F3 范围标签三处）全部收口。
  - **方法论落地**：SDD 全程——每任务「实现者→评审员→修复环→scoped 复审」四拍；评审共拦下 1 Critical（C2-17 正则自洽）+2 Important（zip-slip 之外的报告断链/复现性）+十余 Minor；两个跨任务缺口（C2-33、D11 语义反转残留）由下游任务评审钉出。
  - **遗留（接受保留，台账已录）**：GNU tar Linux 复验（P1 T3）、C5 #3 C2-12b 提纲未点名（P1 手册回填）、R12 编号跨文档二义（既有）、health 双命名空间差异（P1-5 承接）。~~OJ-8 上游文本微调~~（已终裁关闭，2026-10-17）。
  - **上游**：OJ-8/OJ-6/OJ-9 已提交并**终裁均未采纳**（2026-10-17；裁决理由与消费方处置见各稿「上游终裁」节）；PR 文档（202610161500）已同步终裁标注。
- **P1**：代码任务 17/17 完成（2026-10-17 至 10-18 凌晨）：主线 P1-1~P1-16 全部完成（semver/tgz-guard/预检/下载解压/迁移/注册/部署冒烟/编排器/编排端点/CLI/manifest 契约/前端归并/e2e 总验；逐任务台账见 `.superpowers/sdd/202610171207-solution-lifecycle-implementation-plan/progress.md`）；市场侧 P1-15/15a/15b 由 oj-market 接手代理交付（其仓 f05beab/eb84902/28b3bd2），主线 P1-15a-port 移植归位（28a970d5）。P1-16 收官（2026-10-18）：e2e AC-P1-1~20 20/20 PASS、oj-market 真机走查 AC0-7 8/8 PASS、验收门四绿（lint repo 基线破为 pre-existing 零交集，CONCERN 在案）。期间两项根因修复（5366d4be schema 声明回归、66b04f20/a77eecc0 测试夹具竞态与串扰假红）、oj 0.1.78 对账（P1-13c migrate timeoutMs）、教学验证全链真机走通（202610172100）。**集中审查与修复波（2026-10-18，DoD 收口）**：`review-p1-findings.md`——0 Critical / 1 Important / 2 Minor / 观察 6，四验证门独立复跑与申报一致，AC-P1-1~20 证据对码无 fake-green，备案池 43 项全裁（ratify 33 / fix 2 / defer-P2 5 → G7 已回填 / 记录 3）；修复波 `17f17109` 三项一次收敛（7 新用例先红后绿），scoped 复审三项全 resolved + 1 Minor 一行修（`12017236` pruneBackups 补 return null）；终验四门 root 697+1 / templates 433 / cli 153+1 / typecheck 0。**总耗时 ≈20h 墙钟**（2026-10-17 1207 计划定稿 → 10-18 0800 收口；含 oj-market 接手代理并行交付与审查代理 429 停摆 3h）。**已并入集成分支 `feat/ojm`**（2026-10-18 用户裁决，fast-forward 至 `eba327af`，树哈希与终验树逐字一致；特性分支照 P0 先例删除）→ P2 开工前置全清，`feat/lifecycle-p2` 自 feat/ojm 切出。
- **P2**：代码任务 17/17 完成（2026-10-18）：P2-0~P2-16 全绿（契约 v1.2/v1.3、Ed25519 签名链 keygen/sign、宿主信任库+运维面+私钥红线钉测、verify 段验签六码+TOFU `needs_trust`、失败文案双语/审计脱敏、切换前复验含验签 sidecar archive 真源、深检四项+端点+`VerifyReport` N=10、peerPlatform 预检强制+^0.x 口径、TaskRecord schemaVersion、IndexRow 扩展+索引投毒加固、bootstrap key 播种、任务治理+exec.spawn 流式进度、handler-scan 认工厂形态+market 全族 13 端点补登+devkit §11/§12、G7 备案池承载 deployWeb extras/组标题落库 0011 迁移/anonymous 接线、真机 e2e 29/29+走查 14/14）；逐任务台账与 17 份报告见 `.superpowers/sdd/202610171207-solution-lifecycle-implementation-plan/`。**期门裁决（四方评审 2026-10-18 收口）沿用**：G3 TOFU 双轨否、G4 硬 fail-closed+detached `.sig`、G1 不兼走 URL 挂载、G2 进度采纳/取消转 P3、G5 吊销三语义、G6 本仓只出契约与端点、G7 备案池随审查落 P2-15、G8 授权 oj-market 窗口期最小 UI 消费面（四件钉死，窗口结束恢复只读）；bootstrap key 定性 `ojm keygen` 新生成 Ed25519 对。**集中审查（2026-10-18，`review-p2-findings.md`）**：六验证门独立复跑全绿（root 702+1skip / templates 559 / cli 225+1skip / typecheck 0 / `ojm api --check` 0 error / lint 净）且与 P2-16 申报一致；AC-P2-1~17 证据对码无 fake-green；备案池 ~50 项全裁（ratify ≈47 / defer-P3 3 / fix 0 / 记录 0）；0 修复波。**总耗时 ≈5h 墙钟**（P2-0 0800 → P2-16 1307）。**DoD 达成**：AC-P2-1~17 全绿 + 未签名装不上/签名不符不落盘真机演示（e2e 三夹具）+ 集中审查合并就绪。P3 期门输入已汇总于 `review-p2-findings.md` §5（索引签名 U3 / 取消安装 G2 / 深检静态托管 / reconcile live 信任核对 / 真机市场数据核对 / U6 信任库加固 / U1 残余）。
- **P3**：未开始。
