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
| C1 | 共享根裁决 spike | 裁决记录回填设计文档 §9（S1-1/2/3/5/6/7 逐项结论）：① 单 mount 自洽形态（api 前缀重复/空锁拒启/save_lock 互斥实测）② exec.run tar list→validate→extract + 下载形态 ③ 长任务形态（tasks 轴 vs 分段）④ 冒烟凭证 ⑤ reload_api 注入实测 ⑥ M003/M004 实测与对账规则 | DIP（裁决先于实现） | 未开始 | | |
| C2 | manifest.yaml 契约定稿 | 契约文档（PRD §5.2 为底 + changelog 字段 + name/version 白名单 + settings key 所有权 + i18n key + 文案 key `lifecycle.stage.*` 全表）；夹具 bundle 两枚（合法/非法各一，入 `packages/cli/src/lifecycle/__tests__/fixtures/`） | ISP（契约按消费方列字段） | 未开始 | | |
| C3 | 开放问题拍板落档 | Q-A（health 不强制）/GC N=3 时间序/菜单三值/market.view+verify 初始绑定 admin+superadmin——回写设计文档 §0 | — | 未开始 | | |
| C4 | 上游需求提交 | `202610161500-oj-bin-feature-requests-pr.md` 追加 OJ-9（down 迁移，低优，含 D10 豁免面注记）；OJ-8/OJ-6 提交稿投 oj-bin 仓 | D9 | 未开始 | | |
| C5 | 下游契约承接清单 | devkit 手册章节提纲：「打包与分发」「第一方特权面不可复制（R29）」「persona 部署引导」 | 已完成（c6d0e43d，202610171333 提纲） | | |
| C6 | 基线回写 | lifecycle 文档：§3 锁顺序→迁移后落锁、§5 禁用语义→锁摘除+sidecar、Q-A 拍板；状态行→已评审；**并**：统一 verify 端点口径（§5.1 图移除 verify，以 §4.2 `POST /api/_platform/solutions/:name/verify` 为准）；处理工作区既有未提交改动（202610161300） | — | 未开始 | | |
| C7 | **生命周期总览文档**（用户追加） | 面向三视角——开发者（打包/契约/发布）、运维（引导安装/升级/回滚/禁用/卸载/备份/故障恢复）、普通用户（市场页安装/菜单与设置/深检/失败语义）；基于 C2 契约 + C5 提纲 + C6 回写后口径 | `docs/prd/solution/20261017<HHmm>-lifecycle-guide.md` | 未开始 | | |

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

- [ ] 失败测试表驱动：每条规则一拒例 + 一过例（复用 C2 夹具）
- [ ] 跑红 → 实现 → 跑绿 → commit

### Task P1-6：下载/校验/解压步骤（S1-2，LSP）

**Files**: Create `steps/download.ts`、`steps/verify.ts`、`steps/extract.ts` + `buildTarCmd()` 纯命令构造；Test `templates/api/tests/lifecycle/steps-fs.spec.ts`
**Interfaces — Produces**: 三步同签名 `(ctx) => Promise<StageResult>`；`buildListCmd(file) / buildExtractCmd(file, staging)` 返回 argv 数组（可 stub）
- [ ] 命令构造纯函数测试（无 exec）：argv 逐字断言
- [ ] extract 步骤集成测试：合法夹具解压后目录树断言；恶意夹具（`..`/symlink 成员）在 validate 段被拒、**零解压**
- [ ] 跑绿 → commit

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
- [ ] 失败测试（sqlite 夹具）：注册后四表行存在；重跑幂等（行数不变）；deprecated 语义
- [ ] 跑红 → 实现 → 跑绿 → commit

### Task P1-9：部署/热更/冒烟步骤（R18/R30，DIP）

**Files**: Create `steps/deploy-web.ts`、`steps/reload.ts`、`steps/smoke.ts`
**Interfaces — Produces**: `upsertModulesJson(entry: ModuleEntry)`（读-modify-`atomicWriteText`，entry 路径 POSIX 序列化）；`reloadAndAssert()`（reloadConfig 后断言 mounts/vars 实际生效，`unchanged`=失败）；`smoke(ctx)` 四项（health 或首个非匿名路由 / integrity==sha384 / 注册一致性 `queryRegistered` / ——entry 浏览器加载不在安装器验）
- [ ] 测试：modules.json upsert 后 JSON 完整解析（无半截）；POSIX 路径断言；reload `unchanged` 判失败；冒烟 DB 一致性升级态用「包含非相等」
- [ ] 跑绿 → commit

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
- [ ] 跑红 → 实现 → 跑绿 → commit

### Task P1-11：CLI `ojm build --bundle`（C2 契约，DRY 夹具）

**Files**: Create `packages/cli/src/manifest-contract.ts`、`deterministic-tar.ts`、`bundle.ts`；Modify `index.ts`、`usage.ts`；Test `packages/cli/src/lifecycle/__tests__/{manifest-contract,deterministic-tar}.test.ts`
**Interfaces — Produces**: `parseManifest(yaml): Result<Manifest>`、`validateContract(m): string[]`、`createDeterministicTgz(dir, out): Promise<string /*sha256*/>`；CLI `ojm build --bundle [--out dist/]` 输出 `<name>-<version>.tgz` + sha256
- [ ] 失败测试：契约校验表驱动（缺字段/白名单/保留名/键空间 → 可读错误清单）；**确定性**：同目录两次打包 sha256 相等；夹具 bundle 与 isolate 预检**双端一致**（同一夹具跑 `validateContract` 与 `preflight` 规则互认）
- [ ] 跑红 → 实现（tar 固定 mtime=0、字典序、0644/0755、无 owner）→ 跑绿 → commit

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

### Task P1-15：独立仓 `../oj-market` 最小形态（D2，第三方作者形态）

**Files**: 新建独立仓 `../oj-market/`（脚手架对齐 `apps/playground-oj` 工程形态：api/ + web/ + web.config.ts；依赖**已发布**的 `@oj-module/*` 包，不经 monorepo 路径引用）：entry + admin 页（只读索引卡）+ hidden 详情占位 + `market:menu.*`/`market:settings.group.*` i18n + api 侧 `market_history` 迁移 + health 端点 + sys_setting 展示组；含 R29 第一方专用代码注记（`_platform` 编排调用处）；git init + 首提交（仓建立动作向用户报备）
- [ ] 模板套件测试：market_history 迁移往返；health 200
- [ ] `ojm build --bundle` 出 tgz → `ojm install` → admin 菜单出卡片（真机冒烟）→ commit

### Task P1-16：端到端 + 占位引导卡（R26，AC-P1 总验）

**Files**: Create `scripts/lifecycle-e2e.mjs`；Modify 管理区占位卡（web/system 或 shell 空态）
- [ ] e2e 脚本：起本地 oj 静态分发源（no-cache 头断言）→ install → 不重启出菜单 → 升级 0.2.0 → 回滚 → 禁用/启用 → AC-P1-1~20 逐条断言输出报告
- [ ] 占位引导卡：market 未装时管理区显示 `ojm install` 指引
- [ ] 全绿 → `pnpm typecheck && pnpm lint && pnpm test && pnpm test:cli` → commit

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

## 4. P2 · 签名+市场+深检（分支 `feat/lifecycle-p2`，期门细化）

| # | 任务 | 交付 / AC | 状态 |
|---|---|---|---|
| D1 | 签名链：`ojm` 侧 sign + isolate 侧 `verifyEd25519`（fail-closed）+ TOFU（CLI 指纹确认+审计，或 bootstrap 公钥随宿主——随 C4 裁决）+ 双 key 轮换 | AC-P2-1/2/3 | 未开始 |
| D2 | market 实装：进度抽屉（800ms 轮询+schemaVersion）/ 版本历史抽屉 / 回滚 / 禁用启用 / 双版本卡片+changelog / 自升级 CLI 提示 | AC-P2-4 | 未开始 |
| D3 | 深检端点+报告（后端四项 + 前端 i18n 项） | AC-P2-5 | 未开始 |
| D4 | `/market/meta` + `peerPlatform` 预检 | AC-P2-6 | 未开始 |
| D5 | 任务治理落地（保留 10 条/超时 failed/脱敏）+ CLI 引导装 market 本身 | AC-P2-7 | 未开始 |

**DoD**：AC-P2-1~7 绿；未签名装不上、签名不符不落盘真机演示；集中评审合并。

## 5. P3 · 减法与分发（分支 `feat/lifecycle-p3`，期门细化）

| # | 任务 | 交付 / AC | 状态 |
|---|---|---|---|
| U1 | 卸载：影响面预检（受影响角色/用户计数）→ superadmin 二次确认 → RBAC 双维度级联**单事务** + `invalidateAllUsers` 统一失效出口（承接 rbac-isolation §8.3/8.4）+ 业务表保留提示 | AC-P3-1/2/5 | 未开始 |
| U2 | GC 内建 install：state.yaml 时间序保留 N=3，与回滚靠 lock 互斥 | AC-P3-3 | 未开始 |
| U3 | `ojm publish` + bundles.yaml/manifests.yaml 索引重算（no-cache 头） | AC-P3-4 | 未开始 |
| U4 | `ojm uninstall` 瘦客户端 | 随 U1 | 未开始 |

**DoD**：AC-P3-1~5 绿；卸载重装不复活授权真机演示；集中评审合并。

## 6. 风险与依赖

| 风险 | 应对 |
|---|---|
| C1 裁决不利（共享根形态需安装器改写既有挂载） | D3 已列候选与迁移路径；裁决前不启动 P1-6 之后的 FS 步骤实现 |
| 长任务形态受限（isolate 请求作用域） | S1-7 双候选都已论证；分段执行+状态文件续跑为兜底 |
| oj build introspect 空沙箱红线（RBAC §9.4 先例） | `_lifecycle` 模块级语句禁触碰运行时全局（jwt/db/axis），全部收进函数——列入集中评审 checklist |
| Windows tar / EPERM | OJ-8 已提需；R30 路径 POSIX 化 + 可读报错，Windows 列已知限制 |
| 两运行时契约漂移 | 夹具双端测试（P1-11）为门禁 |

## 7. 阶段小结（滚动追加）

- **P0**：未开始。
- **P1**：未开始。
- **P2**：未开始。
- **P3**：未开始。
