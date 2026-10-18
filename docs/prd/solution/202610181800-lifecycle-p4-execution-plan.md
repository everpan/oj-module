# 方案生命周期 P4 阶段任务计划（可自治执行版）

- 日期：2026-10-18 · 上游：主计划 `202610171207-solution-lifecycle-implementation-plan.md` §5（P3 之后）；P3 集中审查 `review-p3-findings.md` §2 备案池（3 项 defer-P4 + 1 项 defer-P4 运行时）。
- 分支：`feat/lifecycle-p4`（自集成分支 `feat/ojm` @ `6d89c82c` 切出；P3 已合并）。
- 期门：**2026-10-18 四方评审（工程/架构/产品/安全）全量裁决落定**（见 §0 PG1~PG4）。
- 范围：收口 P3 审查的四项 defer-P4 —— 多方言卸载矩阵 / 深检 web 入口 integrity / install 异步化 / U6 全量第三方写拒绝运行时验证。
- 纪律：沿用 P3 执行计划（串行排程、六门验证、逐任务台账+报告+状态行回填、禁用 Co-Authored-By）。

---

## 0. 开工前置（不满足即停）

- [x] P3 集中审查收口（`review-p3-findings.md`：六门全绿、备案池 ~29 项全裁、0 修复波）；P3 已合并 `feat/ojm`（fast-forward 至 `6d89c82c`）。
- [x] 四方评审裁决（2026-10-18，全量 P4）已落：
  - **PG1 范围**：P4 = P3 审查四项 defer-P4（P3-4#2 / P3-10#2 / P3-12#1 / P3-1#3）。其中三项本期内执行，一项（P3-12#1 install 异步化）因架构前提缺失 = 记录 + 设计文档收口。
  - **PG2 P4-1 多方言卸载矩阵**：本期执行「三方言单测矩阵」（mock `db.dialect` ∈ {sqlite, mysql, pg}，断言 `catalogSpec` SQL 形态 + `db.tx` 参数化路径方言无关）；**真实 mysql/pg 真机矩阵**作为验证 harness 落部署侧（记录，不引外部 DB 依赖入仓）。
  - **PG3 P4-2 深检 web 入口 integrity**：本期执行。深检增 web 入口 integrity 项：读 `modules.json` 条目 `integrity`（sha384）↔ 本地 `dist` 资产重算 sha384 比对；SSRF 钉不触出站；web 入口缺失/无 integrity = info 非阻断。
  - **PG4 P4-3 异步化 + P4-4 U6 运行时**：
    - **P4-3 install 异步化 = 记录 + 设计文档（非本期落地）**。理由（架构）：oj isolate 按请求隔离、无原生后台 worker（取消机制已实证须走 FS 标记、`market/api.ts:412` 明示「无定时器、无后台循环、无每块同步 IO」）；全异步须引入常驻 worker 架构（超本期 hardening 范围，且改动 POST 超时语义与契约）。同步 install + cancel + reconcile 已可用。留 `task-P4-3-design.md` 设计文档，契约保持（POST 仍返 `task_id`、客户端轮询）。
    - **P4-4 U6 全量第三方写拒绝运行时验证 = 本期执行**：单元断言 `trustPath` 解析在模块 `fs` jail 之外（第三方模块不可达）；附真机运行时验证脚本（第三方模块尝试写 trustPath 须失败）。
- [x] 代码面勘察完成：卸载方言 `uninstall.ts:69-122`（catalogSpec 三方言）/ 深检 `verify-checks.ts:1-184` + `solutions/api.ts:80-129`（四项、无 web integrity）/ 安装端点 `market/api.ts:423-534`（`await runInstall` 同步）/ 信任库 `trust.ts:1-229`（`.solutions/trusted-keys.yaml`，路径由 `env.trustPath` 注入、P3-1 已移出 fs.root）。
- [x] `feat/lifecycle-p4` 自集成分支切出（开工首步）。

## 1. 全局约束

1. **串行排程**（四方评审定）：P4-0 → 1 → 2 → 3 → 4 → 13。争抢同一文件的相邻任务同一时间只有一个 owner，后续以 rebase 续接：`verify-checks.ts`/`solutions/api.ts`（P4-2）、`uninstall.ts`（P4-1）、`trust.ts`/`market/api.ts`（P4-4）。
2. **六门验证**（每任务必过，数字须与基线一致或注明差异）：
   - `npx vitest run`（root，基线 702+1skip）
   - `pnpm vitest run --config packages/cli/templates/api/vitest.config.ts`（templates，基线 586）
   - `pnpm test:cli`（基线 230+1skip）
   - `pnpm typecheck`（0 error）
   - `pnpm ojm api --check`（0 error，templates 目录）
   - 改触源文件 eslint 净。
3. **文档纪律**（用户常设）：每任务 → 实现 → 六门 → `git commit`（conventional，禁 Co-Authored-By）→ 本计划 §2 状态行回填 → `progress.md` 台账追加 → `task-P4-N-report.md` → 里程碑文档提交。P4-3 仅出设计文档（`task-P4-3-design.md`），不落码。
4. **安全红线**：私钥零入仓、SSRF 三钉（深检 web integrity 同口径：只比对本地 `dist` 资产、绝不出站 fetch 远程）、ReDoS、tar 穿越、exec 白名单、凭据只走内存、isolate 禁 `console.*`、签名验签双层语义。
5. **`_lifecycle` 空沙箱红线**：模块级语句禁触碰运行时全局；信任库/索引签名复用 P2 `sign.ts` 原语。

## 2. 任务序列总览（状态行，完成时回填 ✅）

| # | 任务 | 文件 | AC | 状态 |
|---|---|---|---|---|
| P4-0 | 期门裁决 + 本计划 + 分支 | 本文 | — | ✅ 完成（分支 `feat/lifecycle-p4` @ `6d89c82c`） |
| P4-1 | 多方言卸载矩阵（单测矩阵 + 验证 harness） | `uninstall.ts` `uninstall.spec.ts` `scripts/lifecycle-dialect-matrix.mjs` | P3-4#2 | ✅ 完成 `d14cd524` |
| P4-2 | 深检 web 入口 integrity | `verify-checks.ts` `solutions/api.ts` `verify-checks.spec.ts` | P3-10#2 | ⬜ 未开始 |
| P4-3 | install 异步化（设计文档收口，非落地） | `task-P4-3-design.md` | P3-12#1 | ⬜ 未开始 |
| P4-4 | U6 全量第三方写拒绝运行时验证 | `trust.ts` `trust.spec.ts` `scripts/lifecycle-u6-runtime.mjs` | P3-1#3 | ⬜ 未开始 |
| P4-13 | 集中审查 + 合并 | SDD 评审包 | DoD | ⬜ 未开始 |

**DoD**：P4-1/2/4 落地且六门全绿 + 设计文档 P4-3 留档 + 集中审查合并 `feat/ojm` + 主计划 §7 补 P4 阶段小结。

## 3. 任务详规

### P4-1 多方言卸载矩阵（P3-4#2）
- **要点**：`uninstall.ts` 的 `catalogSpec`（L70-82）已三方言分支、`db.tx`（L26/204）参数化、`computeUninstallImpact`（L156-169）参数化查询 —— 代码已方言无关。本期**补「三方言单测矩阵」**予以证实：在 `uninstall.spec.ts` 注入 `db.dialect` ∈ {sqlite, mysql, pg}，断言 ① `catalogSpec(d).existing` 形态（sqlite_master / information_schema）② `catalogSpec(d).like(pat)` 的 `ESCAPE '!'` 转义与 schema 表达式（DATABASE() / 'public'）③ `db.tx` 回调内语句走同一 `t.exec/query` 形参（方言无关）。另出 `scripts/lifecycle-dialect-matrix.mjs`（验证 harness，记录态）：在配置了 mysql/pg 的部署环境跑同序列卸载，断言级联单事务 + retained 提示一致；本仓不引外部 DB 依赖，脚本以 `SKIP_IF_NO_DB=1` 默认跳过（CI 不挂）。
- **测试**：`uninstall.spec.ts` 扩三方言 describe（每方言 ≥3 断言）；`pnpm test:cli` 不受影响。

### P4-2 深检 web 入口 integrity（P3-10#2）
- **要点**：`solutions/api.ts verifyBody`（L81-129）现有四项（路由可达/RBAC/设置/账本）+ 可信性项 + i18n 项。增 **web 入口 integrity 项**：读 `modules.json` 中本方案 entry 的 `integrity`（sha384，P1-9 落位）→ 本地读 `dist/<entry.src>`（或 web 入口对应资产）→ 重算 sha384 比对；不符 = error（被篡改/损坏），缺失 integrity 声明 = info（未声明，非阻断），资产不存在 = info（web 入口缺失，非阻断）。**绝不经 fetch 出站**（只比对本地 `dist` 资产，SSRF 钉同源）；新增纯函数 `diffWebIntegrity(entries, distRoot, sha384)` 于 `verify-checks.ts`，端点 `verifyBody` 组装进 checks。
- **测试**：`verify-checks.spec.ts` 增 `diffWebIntegrity` 三态（符合/不符/缺声明/资产缺失）；`solutions/api.ts` 端点冒烟（注入 modules.json + dist 资产）。

### P4-3 install 异步化（P3-12#1）— 设计文档收口
- **要点**：**不落地码**，仅出 `task-P4-3-design.md`。设计要点：① 现状 `installBody` 同步 `await runInstall`（`market/api.ts:498`），POST 阻塞至安装完成；契约已是「返 `task_id` + 客户端轮询」，仅阻塞语义不符异步预期。② 障碍：oj isolate 按请求隔离，无原生后台 worker；取消机制实证须走 FS 标记、明示禁定时器/后台循环（`market/api.ts:412-417`）→ 全异步须引入常驻 worker（独立进程/端点驱动续跑 + 任务文件为唯一真源 + reconcile 续跑），属新架构。③ 推荐方案（留 P5）：引入 `install/drive` 端点由客户端/调度在途续跑，POST 仅做预检 + 建 task + 返 `task_id`，runInstall 拆为可续跑 stage 步进；超本期范围。④ 本期保持同步 install 可用，契约不变。

### P4-4 U6 全量第三方写拒绝运行时验证（P3-1#3）
- **要点**：P3-1 已将信任库移出 `fs.root`（`trustPath` 默认 `.solutions/trusted-keys.yaml`，由 `env.trustPath` 注入，`market/api.ts` bootstrap 播种）。本期**实证第三方模块不可写信任锚**：① 单元断言 `trustPath` 解析路径在模块 `fs` jail 之外（jail = 模块自身目录，信任库在 `.solutions/` 共享层，不被任一方案模块 jail 覆盖）；② 附 `scripts/lifecycle-u6-runtime.mjs` 运行时验证（记录态/默认 skip）：真机起第三方方案模块尝试写 `trustPath`，断言被宿主 fs 沙箱拒绝（写入失败或落非信任锚位置）。
- **测试**：`trust.spec.ts` 扩「路径在模块 jail 外」断言；`pnpm test:cli` 不受影响。

### P4-13 集中审查 + 合并
- **要点**：区间 `feat/ojm..HEAD` 全量 diff；评审包照 SDD 生成；备案池 = 本期各任务台账「备案→集中审查」逐条裁决（fix/ratify/defer/记录）；六门复跑；写 `review-p4-findings.md` + 主计划 §7 P4 阶段小结；合并循 §6 纪律（fast-forward `feat/ojm`）。

## 4. 阶段收尾（所有任务完成后一次）

1. **集中审查**：区间全量 diff + 评审包 + 备案池裁决 + 六门复跑。
2. **主计划 §7 P4 阶段小结**（照 P0~P3 格式）。
3. **DoD 核验**：P4-1/2/4 落地 + 六门全绿 + P4-3 设计文档留档 + 审查合并。

## 5. 验证门（每任务 & 收尾）

- root `npx vitest run`（702+1skip）· templates `pnpm vitest run --config packages/cli/templates/api/vitest.config.ts`（586）· `pnpm test:cli`（230+1skip）· `pnpm typecheck`（0）· `pnpm ojm api --check`（0 error，templates 目录）· 改触源 eslint 净。
