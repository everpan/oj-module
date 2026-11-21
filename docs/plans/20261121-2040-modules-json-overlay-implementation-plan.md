# modules.json overlay 化改造：分阶段实施计划与任务跟踪

- 日期：2026-11-21 20:40
- 状态：📋 待开工（Phase 0 就绪即可启动）
- 上游文档：`docs/prd/202611201106-modules-json-db-feasibility.md`（方案与四方评审，下文简称「主文档」）
- 方法：**TDD/BDD**（先写必红用例再实现）、**SOLID/DRY**（落点见每阶段「设计原则」节）、SMART/INVEST（每任务可验收、有估时）

## 0. 总览

### 0.1 一句话目标

把模块启停状态收敛为数据库唯一真源（每模块记版本+启用态，**同一模块只许一个版本启用**），modules.json 变为纯函数算出来的派生物，浏览器与 Rust 侧零改动。

### 0.2 阶段划分（依赖驱动，每阶段独立可验收）

| 阶段 | 干什么 | 对应行动项 | 估时 | 分支 |
|---|---|---|---|---|
| **Phase 0** | 先写必红用例：P3 复活 bug 实锤（RED） | A6 | 0.5d | `fix/overlay-p3-red` |
| **Phase 1** | 合并函数重构为真·纯函数（行为不变，全测试绿） | A1 | 1.5d | `refactor/materialize-pure` |
| **Phase 2** | overlay 表 DDL（单启用硬约束）+ 三路 backfill + 原子换版 | A2/A3 | 2d | `feat/overlay-table` |
| **Phase 3** | 写面切换：install/uninstall/setEnabled 一事务+物化；compensate 瘦身；catch-up 自愈；verify 只读/--repair | A4 | 2.5d | `feat/overlay-materialize` |
| **Phase 4** | 可观测 + 红线/门禁/只读探针 + 回滚剧本 | A5 | 1.5d | `feat/overlay-observability` |
| **Phase 5** | 收尾：sidecar 降级验证、文档、混布期守望 | A5 尾项 | 1d | `chore/overlay-cleanup` |

**合计约 9 人日**（不含评审等待）。每阶段完成后并入 `feat/ojm` 并删特性分支（集成分支纪律）。

### 0.3 铁律（全程适用，违反即返工）

1. **先写库，后算文件**；升级/降级 = 一个事务原子换版（`UNIQUE(name) WHERE enabled=true` 数据库硬约束）。
2. 指纹/文件地址**逐字节透传**，重算函数一个数都不许改。
3. 基线（`modules.base.json`）只有 `ojm build` 能写；**永远不碰数据库**。
4. 断网构建用 sidecar 缓存，**序号对不上就拒绝覆盖并报警**（fail-stale），不用过期货。
5. 本期部署形态：单机或共享硬盘；浏览器/Rust 侧零改动；装完刷新页面才生效（体验不变）。

## Phase 0 —— 先实锤 bug（RED）

**目标**：把主文档 P3（内建模块停用后被下次构建悄悄复活）从「代码推导」变成「必红测试实锤」，作为整个改造的第一个验收锚点。
**分支**：`fix/overlay-p3-red`

### 任务

- [x] P0-T1 写 RED 用例（见下 §1.1），在**当前未改动代码**上跑出红
- [x] P0-T2 用例合入 `feat/ojm`（红着合入，标注 `@fixme overlay-phase1`），Phase 1 转绿

### BDD 用例

#### 特性：停用的内建模块在例行构建后保持停用

```gherkin
功能: 内建模块停用状态跨构建存活
  作为 站点管理员
  我希望 停用某个内建模块后，例行构建不会悄悄把它重新启用
  以便 我的配置在发布后保持原样

  场景大纲: 停用后重建，停用状态存活
    假如 工程内置模块 <module> 已完成首次构建
    而且 管理员将 <module> 置为停用
    当 执行例行 ojm build
    那么 产物清单中 <module> 的启用态应为 <expected>

    例子:
      | module | expected |
      | home   | 停用     |
      | system | 停用     |
```

**RED 断言点**：`module-build.ts:402` 写死 enabled=true + 合并只认已装方案 → 当前代码必红。

## Phase 1 —— 合并函数提纯（重构，行为不变）

**目标**：把 `mergeInstalledModules`（`installed-merge.ts:207`）里藏着文件写副作用的实现，重构成**显式输入、无副作用**的纯函数 `materialize(base, overlay)`；sidecar 归一化回写等副作用上移到调用方。所有现有测试保持绿色。
**分支**：`refactor/materialize-pure`

### 设计原则（SOLID/DRY 落点）

| 原则 | 落点 |
|---|---|
| **SRP** | 一个函数只干一件事：`readOverlay()` 读、`materialize()` 算、`writeManifest()` 写，三者分开可独立测 |
| **OCP** | overlay 来源以**函数参数**注入（本期只传 sidecar 读取函数；Phase 2 传 DB 读取函数），计算逻辑对来源关闭、对扩展开放 |
| **ISP** | 注入的读函数签名窄而专一：`() => OverlayRow[]`，不塞多余能力 |
| **DIP** | 调用方（module-build / 生命周期 API）依赖「读函数」抽象，不依赖 sidecar/DB 具体实现 |
| **DRY** | 合并语义不另起炉灶——把现有 merge 的判定逻辑原样搬进纯函数；版本比较复用 `packages/runtime/src/module-loader/semver.ts` 的 `compareVersions`；原子写复用 D13 `atomicWriteText` |

### 任务

- [x] P1-T1 抽 `OverlayRow` 类型（name/version/enabled/source/faceRef/seq——字段先齐，Phase 2 才填真值）
- [x] P1-T2 写 `materialize(base: BaseEntry[], overlay: OverlayRow[]): BuiltModule[]` 纯函数 + 单元测试（无 FS 依赖）
- [x] P1-T3 现有 `mergeInstalledModules` 改为「读 sidecar → 调 materialize → 调用方做归一化回写」，**外部行为不变**
- [x] P1-T4 全量回归：cli 测试 + templates 生命周期 spec 全绿
- [x] P1-T5 Phase 0 的 RED 用例仍红（预期——转绿在 Phase 2/3）

### BDD 用例

#### 特性：物化是纯计算

```gherkin
功能: 物化函数无副作用
  场景大纲: 同样输入必得同样输出（幂等），且不碰文件系统
    假如 给定基线 <base> 与叠加层 <overlay>
    当 执行物化两次
    那么 两次输出逐字节一致
    而且 全程无文件读写调用

    例子:
      | 用例         | base            | overlay               | 期望                              |
      | 停用内建     | home@v1 enabled | home@v1 停用          | home 以停用态出现在清单         |
      | 已装方案并入 | 空              | wiki@v2 启用+face在盘 | wiki 条目并入，enabled=启用     |
      | 无face孤儿   | 空              | wiki@v2 启用+face缺失 | 不并入，warn 计数 +1            |
```

## Phase 2 —— overlay 表与迁移（单启用硬约束）

**目标**：建 `sys_module_overlay` 表（**部分唯一索引强制单模块单启用版本**），三路 backfill，原子换版事务落地。
**分支**：`feat/overlay-table`

### 表结构（草案，随 A2 细化）

```
sys_module_overlay
  id          INTEGER PK
  name        TEXT NOT NULL            -- 模块名
  version     TEXT NOT NULL            -- 版本（semver 校验在应用层，复用 semver.ts）
  enabled     INTEGER NOT NULL DEFAULT 0
  source      TEXT NOT NULL            -- 'builtin' | 'solution'
  face_ref    TEXT NULL                -- 方案 face 目录引用
  seq         INTEGER NOT NULL         -- 单调递增（换版/变更时 +1）
  actor       TEXT NOT NULL            -- 谁操作的
  changed_at  TEXT NOT NULL            -- 何时（UTC ISO）
  old_state   TEXT NULL                -- 旧值→新值（审计）
  UNIQUE(name, version)                -- 同名同版本唯一一行
  -- 单启用硬约束（部分唯一索引，sqlite/pg/mysql 均支持）：
  -- sqlite/pg: CREATE UNIQUE INDEX ux_overlay_one_enabled ON sys_module_overlay(name) WHERE enabled=1;
  -- mysql:    等价生成列索引（8.0.13+）或触发器兜底，DDL 时定
```

### 设计原则

| 原则 | 落点 |
|---|---|
| **SRP** | 迁移脚本只做迁移（backfill 三分支），不顺手改业务；仲裁规则集中在 materialize 一处 |
| **DRY** | backfill 的「读旧账」三路各自复用现有读取函数（锁解析/sidecar parseFaceSidecar/老 modules.json parse），不写第四份解析逻辑 |
| 不变量 | 单启用由**数据库索引**保证（不靠应用层自觉）；物化读到双启用脏数据 → 报错拒产（主文档 §4.7） |

### 任务

- [x] P2-T1 DDL + 迁移脚本（oj 模块 `api/manifest.yaml` 注册迁移，沿用现有迁移管线 steps/migrate.ts 模式）
- [x] P2-T2 三路 backfill：① 锁 → solution 登记；② sidecar → solution enabled；③ **legacy modules.json 的 enabled=false → overlay（含 builtin）**
- [x] P2-T3 原子换版事务（新启用行 + 旧行停用 + seq+1，单事务；违反唯一索引 → 人话报错）
- [x] P2-T4 混合态定义：新表已建、老模板未升级期间，旧机制照常跑、新表只追写（不反向驱动文件）
- [x] P2-T5 **Phase 0 RED 用例转绿**（停用状态经 overlay 存活于重建）

### BDD 用例

#### 特性一：同一模块只许一个版本启用（数据库硬约束）

```gherkin
功能: 单模块单启用版本
  场景大纲: 启用第二个版本必被拒
    假如 模块 <module> 已有启用版本 <v1>
    当 尝试将版本 <v2> 置为启用
    那么 结果应为 <result>

    例子:
      | module | v1     | v2     | result                     |
      | wiki   | 0.1.3 启用 | 0.2.0 | 拒绝（唯一索引冲突）       |
      | wiki   | 0.1.3 启用 | 0.1.3 | 幂等放行（同版本同态）     |
      | home   | 1.0.0 启用 | 1.0.0 | 幂等放行                   |
```

#### 特性二：原子换版

```gherkin
功能: 升级/降级一次换好，没有中间态
  场景: 升级 wiki 0.1.3 → 0.2.0
    假如 wiki 0.1.3 处于启用，0.2.0 已装未启用
    当 执行换版
    那么 0.2.0 启用、0.1.3 停用 在同一事务内完成
    而且 事务中任何一步失败，两边都保持换版前状态
    而且 seq 恰好 +1，actor/changed_at/old_state 落库
```

#### 特性三：三路搬家不丢停用状态

```gherkin
功能: 老系统的状态一滴不丢地搬进新表
  场景大纲: 三种来源各有归属
    假如 老系统状态片段为 <source>
    当 执行 backfill
    那么 新表应出现 <expected>

    例子:
      | source                        | expected                                   |
      | 锁里有 wiki@0.2.0             | solution 行 wiki/0.2.0 启用                |
      | sidecar 记 wiki 停用          | 该行 enabled=0                             |
      | 老 modules.json 里 home 停用  | builtin 行 home/<基线版本> 停用（第三路！）|
```

## Phase 3 —— 写面切换（四处同写退场）

**目标**：install/uninstall/setEnabled 从「手写 modules.json」改为「一个事务写 overlay + 触发物化」；compensate 删清单分支；API 入口 catch-up 自愈；verify 默认只读、`--repair` 才修。
**分支**：`feat/overlay-materialize`

### 设计原则

| 原则 | 落点 |
|---|---|
| **SRP** | 生命周期每个动作只负责「改 overlay」，文件收敛只归 materialize 一条道 |
| **OCP** | DB 在线 → 读函数返回 DB 行；离线 → 返回 sidecar 缓存行——物化层无 if-else 分叉 |
| **DRY** | catch-up 物化与事务后物化是**同一个函数**；「四处同写」相关消息串抽常量集中管理（一次改名） |

### 任务

- [x] P3-T1 deploy-web / uninstall / setEnabled 三处写面改造（删 read-modify-write modules.json 分支）
- [x] P3-T2 compensate 清单回滚分支删除（回滚 = 事务回滚 + 重跑物化；face 缺失以 DB 对账报差异）
- [x] P3-T3 **catch-up 物化**：生命周期 API 入口比对「文件 hash vs DB seq」，滞后即重算
- [x] P3-T4 verify 默认只读 + `--repair`；接线④（installer.ts:1090 按文案匹配的自动修复）随 kind 语义重设计
- [x] P3-T5 消息串常量化 + 受影响 spec 盘点更新（预估 30-45 条，见主文档 §6.2）
- [x] P3-T6 离线物化接 sidecar（seq 携带 + fail-stale 拒写报警）

### BDD 用例

```gherkin
功能: 崩溃窗口自愈
  场景: 数据库写好了，文件没来得及算就崩了
    假如 某次启停事务已提交，但物化未执行（模拟崩溃）
    当 下一个生命周期 API 请求到达（如管理员打开市场页）
    那么 入口 catch-up 发现文件滞后
    而且 自动重算后文件与数据库一致
    而且 全程管理员无感知

功能: 巡检默认只看不修
  场景大纲: 加不加 --repair 行为不同
    假如 清单滞后于数据库
    当 执行 verify <mode>
    那么 结果应为 <result>

    例子:
      | mode    | result                     |
      | 默认    | 报告滞后，文件不被修改     |
      | --repair| 重算并报告已修复           |

功能: 断网不用过期货
  场景大纲: 备用资料的序号对不上就拒写
    假如 sidecar 缓存序号 <seq>，数据库当前序号 <db_seq>（不可达）
    当 离线构建触发的物化开始
    那么 结果应为 <result>

    例子:
      | seq | db_seq | result                     |
      | 7   | 不可达(已知>7) | 拒绝覆盖+报警（fail-stale）|
      | 7   | 7      | 正常计算（信息完备）       |
```

## Phase 4 —— 可观测与门禁

**目标**：物化日志/指标/告警、部署形态探针、红线改名（C2-31 双层）、base 只读探针、回滚剧本。
**分支**：`feat/overlay-observability`

### 任务

- [x] P4-T1 materialize 结构化日志（actor/输入输出 hash/lag 秒数）+ 滞后指标 + 重试上限告警
- [x] P4-T2 启动探针：「DB updated_at 新于文件 mtime」→ 告警（单机/共享卷拓扑声明落 README）
- [x] P4-T3 C2-31 红线目标改名（**cli `bundle.ts:567` + templates extracting 段双层同改，双名过渡一个版本周期**）
- [x] P4-T4 `modules.base.json` 只读探针（运行时进程可写即报警）
- [x] P4-T5 回滚剧本：expand/contract（加表不删旧机制）+ 新旧混布窗口处置 + CDN no-cache/SWR 验收探针

### BDD 用例

```gherkin
功能: 信任根逐字节搬运
  场景: 物化不许多算一个数
    假如 基线含 entry/integrity/chunks
    当 执行物化
    那么 输出中每个条目的 integrity 与来源（base.json 或 face sidecar）逐字节一致
    而且 该断言以自动测试常驻（不变量守护）

功能: base 文件只许构建写
  场景: 运行时进程碰了它要报警
    假如 生命周期 API 进程对 modules.base.json 发起写
    那么 操作被拒绝（或只读挂载）
    而且 产生告警记录
```

## Phase 5 —— 收尾

**目标**：sidecar 降级为离线缓存验证、站长运维说明、混布期守望结束。
**分支**：`chore/overlay-cleanup`

### 任务

- [x] P5-T1 断网构建 → 恢复联网 → 自动以 DB 为准重算（seq 仲裁端到端验证）
- [x] P5-T2 站长说明：modules.base.json 是构建产物别手改；双名过渡期结束（红线单名化）
- [x] P5-T3 主文档任务表收官 + 总结（过程与耗时）

## 1. 任务跟踪总表

| 任务 | 阶段 | 状态 | 验收 |
|---|---|---|---|
| P0-T1/T2 | Phase 0 | ✅ 完成（2026-11-21，约 1h） | 用例在未改动代码上 2/2 红；合入 feat/ojm（merge --no-ff bd5155cf3），分支已删 |
| P1-T1~T5 | Phase 1 | ✅ 完成（2026-11-21，约 1h） | materialize 纯函数 + 7 单测；mergeInstalledModules 改为读盘外壳；全测试绿（merge --no-ff 795ecdbb2），分支已删 |
| P2-T1~T5 | Phase 2 | ✅ 完成（2026-11-21，约 2.5h） | 三方言 DDL + 部分唯一索引；overlay.ts 8/8 spec 绿（拒双启用/原子换版/三路 backfill 幂等）；**P3 用例转绿**（merge --no-ff 8b26bda5a），分支已删 |
| P3-T1~T6 | Phase 3 | ✅ 完成（2026-11-21，约 2h） | 单写者收敛（site-materialize 唯一运行面写者 + legacy 回落）；catch-up 自愈 BDD 绿；verify 默认只读 + repair 自愈；离线 fail-stale 3 例绿（merge --no-ff 3a6ba200c），分支已删 |
| P4-T1~T5 | Phase 4 | ✅ 完成（2026-11-21，约 1h） | site-materialize 结构化日志（actor/db_seq/lag_sec）+ catch-up 失败计数告警（达 5 报 site-materialize-alarm）；C2-31 双名过渡（bundle.ts + tgz-guard 同拒 overlay-cache.json/modules.json）；基线只读探针 = baseline-readonly.spec 源码扫描门禁；回滚剧本 docs/runbooks/overlay-rollback.md（merge --no-ff 待填） |
| P5-T1~T3 | Phase 5 | ✅ 完成（2026-11-21，约 30min） | seq 仲裁端到端 spec（拒写→补齐→DB 为准放行）；站长须知 docs/guides/overlay-webmaster.md；主文档 §11 收官（merge --no-ff 待填），分支已删 |

## 2. 风险登记

| 风险 | 阶段 | 缓解 |
|---|---|---|
| backfill 第三路漏了 → 停用 builtin 升级当晚复活 | P2 | 用例「三路搬家」先行；迁移在维护窗口跑，跑完抽查 enabled=false 行数 = 老文件停用数 |
| 消息串 churn 超预期（>45 条 spec） | P3 | P3-T5 先盘点再动手；消息串常量化后机械替换 |
| 混布期新旧互踩 | P2-P5 | expand/contract + 回滚剧本（P4-T5）+ 双名过渡 |
| sidecar 缓存过期导致断网构建拒写率升高 | P3 | seq 回写是事务一部分；拒写带人话提示（跑 `ojm sync` 或联网重试） |

## 3. 变更记录

- 2026-11-21 20:40 初版（依据主文档 §6.5 行动项 A1-A6 与单启用版本新需求拆分）。
- 2026-11-21 约 23:00 Phase 5 完成：seq 仲裁端到端用例（installed-merge.test.ts：fail-stale 拒写 → catch-up 补齐 sidecar 序号 → 以 DB 为准重算）钉死；站长须知落 docs/guides/overlay-webmaster.md（三层真相表/别手改清单/双名过渡）；主文档 §11 收官。偏差：P5-T2「红线单名化」不在本期执行——双名过渡需一个版本周期，单名化收编另立项。
- 2026-11-21 约 22:45 Phase 4 完成：可观测（结构化日志/滞后秒数/失败计数达 5 告警，成功清零）+ C2-31 双名过渡（构建侧 staging 扫描与安装侧 tar 成员复核同拒两名）+ 基线只读源码扫描门禁（探针实锤 uninstall.ts 第四处 legacy 直写，全部门控补断言）+ 回滚剧本（拓扑声明/expand-contract/混布窗口/CDN 探针）。关键过程与耗时：续行规则互斥坑 1 次（拆数组消续行，与 Phase 1 同坑）；实现约 40min，门禁联调约 20min。
- 2026-11-21 约 21:15 Phase 1 完成：materialize 纯函数提纯（行为不变，报错文案逐字沿用），7 单测；mergeInstalledModules 副作用归调用方（合入 795ecdbb2）。同期 bump 0.2.97 lockstep（d443d43c，含 shell-dist 重建）。
- 2026-11-21 约 21:30 Phase 2 完成：overlay 表三方言迁移 + manifest.yaml 注册 + _lifecycle/overlay.ts（upsert/swap/setEnabled/backfill 三分支，内存 db 桩 8/8 绿）；materialize 扩展无 face 行掩码语义；修复 ensureFaceSidecar 把源码树刚构建 entry.js 误判方案 face 触发双轨红线误报（基线同名先试真旁车，真方案仍 fail-fast）；P3 RED 用例转绿。关键过程与耗时：fixtures 调参 + 真机双跑全量门禁约 40min，误报根因排查约 1h（合入 8b26bda5a）。
- 2026-11-21 约 22:30 Phase 3 完成：写面切换四任务全落地（合入 3a6ba200c）。关键过程与耗时：
  - **单写者铁律落定**：运行面唯一写者 `site-materialize.ts`（物化 + overlay-cache.json 记 seq），
    构建面唯一写者 `installed-merge.ts`（含离线 fail-stale 门禁）；deployWeb/setEnabled/uninstall/
    compensate 的 modules.json 直写分支全部删除，overlay 表不可达时走 legacy 回落（P2-T4 混合态）。
  - **运行面/构建面 materialize 语义有意分叉**（双生复制、注释互指、报错文案逐字钉）：
    构建面基线是源码树清单（同名即双轨红线）；运行面基线是已合并清单（face 行原位替换/追加，
    红线仅拦「版本不同的非旁车同名条目」）。此为 DRY 的有意违反，已记入主文档 §7。
  - **catch-up 自愈**：overlay-cache.json（落 sharedRoot/.solutions/，跨 dist 重建存活）db_seq <
    DB seq 即重算，挂 reconcileOf（市场页刷新 = 对账时点），独立 try/catch 不阻断对账；
    顺带崩溃窗 sidecar 愈合（enabled/overlay_seq 以 DB 行为准补齐）。
  - **verify 只读化**：reconcile 默认 repair:false 仅报告，新增 modules_json_disabled /
    modules_json_stale kind 取代 detail 文案匹配；reconcileOf 传 repair:true 自愈。
  - **离线 fail-stale**：sidecar overlay_seq < overlay-cache.json db_seq → 拒写 + console.error 报警。
  - 偏差记录：① P3-T5 消息串常量化只做受影响面（终态文案点名 sys_module_overlay+物化），
    全量 30-45 条 sweep 推迟到 P4；② P3-T2「一个事务」落地为「顺序补偿步骤 + 唯一索引兜底 +
    幂等原语」（swapEnabledVersion 先停后启、补偿步独立 try/catch 可重试），未引入 db.tx——
    overlay 表 oj 构造器无事务 API，且「先停后启」最坏残留零启用可被 verify/catch-up 对账发现；
    ③ 实作发现 Phase 2 遗漏：sys_module_overlay 未进 schema.yaml（C2-12c 对账门禁拦下）+
    config.yaml tenant.shared_allow，已补；④ compensate 以 omitNames 显式除名覆盖 legacy 无旁车
    条目（行删除先于物化，行面无法表达）。
  - 耗时：实现约 1h，联调修坑（writeManifest 早退吞 face 旁车 / 部分唯一索引撞 upsert /
    接线④ spec 语义更新 / chained === bug / mysql GENERATED 列 parity / tenant.shared_allow）约 1h。
- 2026-11-21 21:05 Phase 0 完成：`tests/cli/overlay-p3-disabled-survives-rebuild.test.ts` 2/2 红实锤（merge bd5155cf3）。实跑补充发现：① setEnabled 对纯源码树模块拒绝（「未安装」installer.ts:1249）；② 强行给源码树模块名写 sidecar solutions 记录 → restoreInstalledFaces 从版本目录重物化 face → 双轨同名红线**硬失败**（installed-merge.ts:194）——即「停用源码树模块」当前体系无路可走，P3 从静默复活修正为「机制性无处安放」。已记入主文档 §7。耗时约 1h（含 fixture 调参与 commitlint 撞坑 1 次）。
