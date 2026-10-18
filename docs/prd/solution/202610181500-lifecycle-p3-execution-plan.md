# 方案生命周期 P3 阶段任务计划（可自治执行版）

- 日期：2026-10-18 · 上游：主计划 `202610171207-solution-lifecycle-implementation-plan.md` §5（P3 · 减法与分发）
- 分支：`feat/lifecycle-p3`（自集成分支 `feat/ojm` 切出；P2 合并后）
- 期门：**2026-10-18 四方评审（工程/架构/产品/安全）全量裁决落定**（见 §0）
- 范围：U1 残余 + U2 + U3 + U5 + U6 + 宿主打磨 + P2 findings §5 的 8 项 defer/增强
- 纪律：沿用 P2 执行计划（串行排程、四门验证、逐任务台账+报告+状态行回填、禁用 Co-Authored-By）

---

## 0. 开工前置（不满足即停）

- [x] P2 集中审查收口（`review-p2-findings.md`：六门全绿、备案池 ~50 项全裁、0 修复波）；P2 分支合并就绪。
- [x] 四方评审裁决（2026-10-18，全量 P3）已落：
  - **PG1 范围**：全量 P3（U1 残余 + U2 + U3 + U5 + U6 + 宿主打磨 + P2 §5 八项 defer/增强）。
  - **PG2 U5 取消安装**：本期实现（exec.spawn `h.kill()` + staging 清理 + 账本对账 + D11 失败语义三分配套）。
  - **PG3 U6 信任库**：移出 `fs.root` + `platform.trusted_paths` 显式授权（仅 `_platform` 特权可写，第三方方案模块不可写）。
  - **PG4 U1 残余 + 宿主打磨**：全部收口（级联单事务 / 业务表保留提示 / 卸载路由 500→404 / 宿主层深执法）。
- [x] 代码面勘察完成（`lifecycle-p3-code-survey`）：U1 `uninstall.ts:77-180` / U2 `state.ts`+`installer.ts:158-208` / U3 `index.ts:111-155`+`market/api.ts:266,486`+`sign.ts` / U5 `migrate.ts:253-273`+`installer.ts:393-459` / U6 `trust.ts:72`+`market/api.ts:136` / 宿主 `market/api.ts:723-741`。
- [ ] `feat/lifecycle-p3` 自集成分支切出（开工首步）。

## 1. 全局约束

1. **串行排程**（四方评审定，不得并行实现代理）：P3-0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13。争抢同一文件的相邻任务同一时间只有一个 owner，后续以 rebase 续接：`installer.ts`（P3-2/8/9）、`market/api.ts`（P3-1/6/7/11）、`migrate.ts`（P3-8/11）、`uninstall.ts`（P3-3/4）。
2. **四门验证**（每任务必过，数字须与基线一致或注明差异）：
   - `npx vitest run`（root，基线 702+1skip）
   - `pnpm vitest run --config packages/cli/templates/api/vitest.config.ts`（templates，基线 559）
   - `pnpm test:cli`（基线 225+1skip）
   - `pnpm typecheck`（0 error）+ `pnpm ojm api --check`（0 error，templates 目录）+ 改触源文件 eslint。
3. **文档纪律**（用户常设）：每任务 → 实现 → 四门 → `git commit`（conventional，禁 Co-Authored-By）→ 本计划 §2 状态行回填 → `progress.md` 台账追加 → `task-P3-N-report.md` → 里程碑文档提交。
4. **安全红线**：私钥零入仓（`~/.ojm/keys` 红线）、SSRF 三钉、ReDoS、tar 穿越、exec 白名单、凭据只走内存、isolate 禁 `console.*`、签名验签双层语义（格式错**抛错** / 验签不过**返 false**，均 `retryable=false`）。
5. **`_lifecycle` 空沙箱红线**：模块级语句禁触碰运行时全局（jwt/db/axis）；信任库/索引签名复用 P2 `sign.ts`（`canonicalString`/`signCanonical`/`verifyCanonical`/`fingerprintOfPublicKey`）。

## 2. 任务序列总览（状态行，完成时回填 ✅）

| # | 任务 | 文件 | AC | 状态 |
|---|---|---|---|---|
| P3-0 | 期门裁决 + 本计划 | 本文 + 分支切出 | — | ✅ |
| P3-1 | U6 信任库移出 fs.root + trusted_paths 授权 | `market/api.ts` `config.yaml` `trust.spec.ts` | PG3 | ✅ 完成 `4397eb9f` |
| P3-2 | U2 GC 保留 N=3（state 时间序） | `state.ts` `installer.ts` | AC-P3-3 | ✅ 完成 `f74a5b8f` |
| P3-3 | U1① 级联单事务 | `uninstall.ts` | AC-P3-1/2 | ✅ 完成 `e4bbf19c` |
| P3-4 | U1② 业务表保留提示 | `uninstall.ts` `market/api.ts` | AC-P3-1/2 | ✅ 完成 `fb64923f` |
| P3-5 | U3-a `ojm publish` 命令 | `index.ts`+`publish.ts` | AC-P3-4 | ✅ 完成 `b288efcc` |
| P3-6 | U3-b 索引重算 + no-cache 确认 | `market/api.ts` | AC-P3-4 | ✅ 完成 `b288efcc` |
| P3-7 | U3-c 索引签名（bundles/manifests） | `market/api.ts` `sign.ts` | AC-P3-4 | ✅ 完成 `b288efcc` |
| P3-8 | U5 取消安装（h.kill + staging 清理 + 账本对账 + D11） | `installer.ts` `migrate.ts` | AC-P3-6 | ✅ 完成 `a786d6fe` |
| P3-9 | reconcile live 信任核对（P2-6#1） | `installer.ts` | P2 §5 | ✅ 完成 8f40804e |
| P3-10 | 深检静态托管真机增强（P2-16#2） | `scripts/lifecycle-e2e.mjs` | P2 §5 | ✅ 完成 a13763d0 |
| P3-11 | 宿主打磨（卸载路由 404 + 宿主层 rollbackGuard） | `market/api.ts` `migrate.ts` | P1 §5 | ⬜ |
| P3-12 | P3 端到端 e2e + 走查（AC-P3-1~6） | `scripts/*` `logs/` | AC-P3-1~6 | ⬜ |
| P3-13 | 集中审查 + 合并 | SDD 评审包 | DoD | ⬜ |

**DoD**：AC-P3-1~6 全绿 + 卸载重装不复活授权真机演示 + 六门全绿 + 集中审查合并 + §7 阶段小结。

## 3. 任务详规

### P3-1 U6 信任库移出 fs.root + `platform.trusted_paths` 授权
- **要点**：信任库路径默认从 `modules/.solutions/trusted-keys.yaml`（fs.root 内）改为 **fs.root 之外**的部署级目录（如 `.solutions/trusted-keys.yaml` 相对 deploy root，或 `platform.trusted_paths` 指定的绝对/相对路径）；`MarketEnv.trustPath` 缺省随改；`config.yaml` 增 `platform.trusted_paths`（仅 `_platform` 特权可写，第三方模块不在此 jail 内 ⇒ 无法伪造信任锚）。
- **铁律**：仍须保证「普通第三方方案模块不可写信任库」——钉回归用例（P2-2 spike 同口径）；bootstrap 播种路径随之调整。
- **测试**：`trust.spec.ts` 扩「路径在 fs.root 外」「第三方模块写被拒」；`market-api.spec.ts` 验 trustPath 注入。

### P3-2 U2 GC 保留 N=3
- **要点**：`state.ts` 增版本时间序记录（或在 install 写版本目录后 prune 旧目录）；`installer.ts` 落盘新版本时按时间序保留最近 **3** 个（`KEEP_VERSIONS=3`，对照 `TASK_KEEP=10`/`KEEP_BACKUPS=3` 范式），超出删最旧目录 + state 条目；与回滚靠 lock 互斥（删前确认非当前 lock 指向）。
- **测试**：installer.spec 验「装 5 版 → 仅留最近 3 版」「当前 lock 版永不被 GC」；atomic-state.spec 时间序。

### P3-3 U1① 级联单事务
- **要点**：`uninstall.ts` `runUninstall` 的 RBAC 双维度级联 + `invalidateAllUsers` + 四处同删 + 历史留痕，包进**单一 DB 事务**；任一步失败 `rollback` 不留半残；复用既有 `uninstallSolution` 但改事务边界。
- **测试**：uninstall.spec 注入中段失败，断言「无角色级联残留 + 无模块目录残留 + 锁仍在」（fail-closed 不部分成功）。

### P3-4 U1② 业务表保留提示
- **要点**：卸载成功响应增 `retained` 字段（受影响业务表清单 / 提示「以下数据已保留，需手动清理」）；不删业务数据，只删代码/锁/路由/sidecar。
- **测试**：uninstall.spec 验响应含 `retained` 非空 + 业务表仍在（sqlite 直读）。

### P3-5 U3-a `ojm publish`
- **要点**：CLI 增 `publish <dir>` 子命令（`index.ts` 注册），读 `<dir>/bundles.yaml`+`manifests.yaml` → 重算索引（P3-6）→ 签名（P3-7）→ 写回/推 CDN（本地先用文件目标，CDN 走 `resolveCdn` 同形）；复用 `sign.ts` 签名原语 + 发布方 key（`~/.ojm/keys`）。
- **测试**：cli `publish` spec（假 index + 测试 key → 产出签名 index + 校验通过）。

### P3-6 U3-b 索引重算 + no-cache 确认
- **要点**：`market/api.ts` `indexBody` 的 bundles/manifests 拉取/重算逻辑；确认 `fetchText` 已带 `cache-control:no-cache`（R15 口径）并在 publish 后索引即时失效；提供重算触发（publish 写新索引即生效，无需额外缓存层）。
- **测试**：market-api.spec 验 no-cache 头 + 索引随 publish 更新。

### P3-7 U3-c 索引签名
- **要点**：发布时对 bundles/manifests 计算 canonical 摘要 + `signCanonical`（复用 `sign.ts`）；`resolveCdn` 拉取索引后 `verifyCanonical`（公钥取信任库 / bootstrap key）；签名不符/缺失 ⇒ 索引拒绝采用（fail-closed，归 P2 G4 口径）；no-cache 头不变。
- **测试**：market-api.spec 验「签名相符采用 / 篡改拒 / 缺失拒」。

### P3-8 U5 取消安装
- **要点**：installer 增「取消」入口（端点 `?cancel=<taskId>` 或 task 状态 `cancelling`）；PIPELINE 中监听到取消 ⇒ `h.kill()`（migrate.ts spawn 句柄，P2-13 no-op 升级真实现）+ 清理 `env.staging/<task>` + 账本 `reconcile` 对账（已写锁/目录回退到取消前态）+ D11 失败语义（partial 标记、审计末位）；取消须幂等、可重入。
- **测试**：migrate.spec（kill 触发提前终止 + appliedSeq 稳定）、installer.spec（取消 ⇒ staging 清空 + 锁/目录回到装前 + 任务终态 partial/failed）。

### P3-9 reconcile live 信任核对（P2-6#1）
- **要点**：`installer.ts` `reconcile`（重启自愈启用）后触发一次 **live 信任库核对**；若 key 已吊销 ⇒ 标 `untrusted`（G5 口径：放行 + 显著告警 + 审计 + 深检标 untrusted），与 P2-8 深检 live 查询口径一致。
- **测试**：installer.spec 验「reconcile 后吊销 key ⇒ 方案标 untrusted 且仍启用」。

### P3-10 深检静态托管真机增强（P2-16#2）
- **要点**：现有 e2e/走查站点为 API-only；增一带静态托管的真机站点（或脚本内起 SPA 宿主），验证 web routes 深检**全绿**（诚实 404 之外 web route 可达且健康）；单测钉「全绿」语义不退化。
- **测试**：lifecycle-e2e.mjs 增静态托管场景断言；深检单测补全绿路径。

### P3-11 宿主打磨（卸载路由 404 + 宿主层 rollbackGuard）
- **要点**：`market/api.ts` 卸载端点对「方案已不存在」返回 **404**（非 200 `{ok:false}`）；`rollbackGuard`（`migrate.ts:136` 纯函数）提升到宿主/锁层（install 预锁即校验 applied[] 近似口径，不只 migrate 段）；补对应单测。
- **测试**：market-api.spec（已卸载方案卸载 ⇒ 404）、migrate.spec（宿主层 rollbackGuard 拦截）。

### P3-12 P3 端到端 e2e + 走查
- **要点**：`scripts/lifecycle-e2e.mjs` 扩 AC-P3-1~6 断言（卸载预检计数 / superadmin 门 / GC N=3 / publish+索引签名 / 卸载重装不复活授权 / 取消安装）；`scripts/lifecycle-walkthrough.mjs` 扩真机走查；保存 `logs/walkthrough-P3-fullchain.md`。
- **测试**：e2e 全绿（含 oj 0.1.80 真机构建）。

### P3-13 集中审查 + 合并
- **要点**：区间 `feat/ojm..HEAD` 全量 diff；评审包照 SDD 生成；备案池 = 本期各任务台账「备案→集中审查」逐条裁决（fix/ratify/defer/记录）；六门复跑；写 `review-p3-findings.md` + §7 阶段小结；合并循 §6 纪律。

## 4. 阶段收尾（所有任务完成后一次）

1. **集中审查**：区间全量 diff + 评审包 + 备案池裁决 + 六门复跑。
2. **§7 P3 阶段小结**（主计划，照 P0/P1/P2 格式）。
3. **DoD 核验**：AC-P3-1~6 全绿 + 卸载重装不复活授权真机演示 + 六门全绿 + 审查合并。

## 5. 验证门（每任务 & 收尾）

- root `npx vitest run`（702+1skip）· templates `pnpm vitest run --config packages/cli/templates/api/vitest.config.ts`（559）· `pnpm test:cli`（225+1skip）· `pnpm typecheck`（0）· `pnpm ojm api --check`（0 error，templates 目录）· 改触源 eslint 净。
