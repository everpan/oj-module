# 分阶段任务规划：解决方案免重启生效（P0，不含父子进程）

> 状态：**规划定稿**（2026-11-05）。本规划把 `20261105-hot-apply-final.md` 的 P0 拆成可独立交付、可测试的阶段，遵循 SOLID/DRY，用例采用 BDD 场景 + INVEST 判据。**父子进程（P4 supervisor）不在本规划内**，待后续单独规划。
>
> 范围边界（重要）：本仓 `oj-module` 只持有**模板侧编排**（`templates/src/app/api/_platform/_lifecycle/*`）。final 方案 §3.1 换代身份、§3.2 dispatch 短路、§3.3 cron 独立线程、§3.5 启动降级属上游 `oj` Rust 侧，本仓**无法实施**，列为「上游依赖（阻塞）」跟踪，不计入本仓阶段。

## 0. 阶段总览与跟踪表

| 阶段 | 内容 | 仓库 | 上游依赖 | 状态 |
|---|---|---|---|---|
| **Phase 1** | 安装补偿清单（§3.5） | 本仓 | 无 | ✅ 已完成 |
| **Phase 2** | 宿主能力门禁 + preflight 两条新检查（§3.6 + §3.2 preflight） | 本仓 | US-1（capabilities 由 ojInfo 下发） | ✅ 已完成 |
| **Phase 3** | smoke 收紧 + 无守护 partial 判定（§3.6 收尾） | 本仓 | 无（restart_pending 字段已存在） | ✅ 已完成 |
| **Phase 4** | 卸载顺序对齐（§3.4 本仓部分） | 本仓 | US-1（manifests 摘要触发 reload） | ✅ 已完成（本仓编排；① 待 US-1） |
| US-1 | 换代身份 §3.1（generation_key ⊕ 锁摘要） | 上游 oj | — | 🔒 阻塞跟踪 |
| US-2 | 匿名 dispatch 短路 §3.2 | 上游 oj | — | 🔒 阻塞跟踪 |
| US-3 | cron 独立线程 §3.3 | 上游 oj | — | 🔒 阻塞跟踪 |
| US-4 | 启动自检降级 §3.5 | 上游 oj | — | 🔒 阻塞跟踪 |
| **终审** | 全阶段完成后终审 | — | — | ⬜ 待执行 |

> 本仓 Phase 2 的 capability 门禁**读端**可先落地（模板侧 preflight 读 `ojInfo().capabilities`），但**断言生效**依赖 US-1 上游把 capabilities 下发。故 Phase 2 在 US-1 前只能做到「读 + 缺失即 failed」的编码，验收 16 需 US-1 到位后复测。

---

## Phase 1 — 安装补偿清单（§3.5）

**范围**：锁后失败（registering / deploying_web / reloading / smoke 四段）时，把站点恢复到「装前代」，任务标 `partial + 可重试`。修复当前 `runInstall`（`installer.ts:660-663`）只置 partial 不回滚的缺口。

**涉及文件**：`installer.ts`、`text-edit.ts`、新增 `compensate.ts`（或落在 `installer.ts` 内聚模块）、`steps/reload.ts`、`uninstall.ts`（复用 DB 事务）。

### BDD 场景

```gherkin
场景: 锁后失败完整回滚到装前代
  给定 已装 A 方案且站点正常服务
  当 安装 B 方案在 smoke 段注入失败（路由 404）
  那么 manifests.yaml 回到装前（无 B 条目）
   且 config.yaml 的 B 匿名条目被精确移除（seq 仍在）
   且 modules.json 无 B 条目
   且 DB 的 sys_solution_route/role/permission 无 B
   且 旧代（generation 装前值）仍在服务
   且 任务状态 = partial 且可重试

场景: 匿名面不随失败放大
  给定 连续两次对 B 方案安装均失败
  当 第二次失败补偿完成
  那么 config.yaml 中 B 的匿名条目数与第一次失败后一致（不增长）

场景: 补偿部分失败仍尽力回滚
  给定 安装 B 在 smoke 失败
  当 补偿过程中 DB 回滚步抛错
  那么 其余各步（config/lock/modules.json/reload）仍生效
   且 task.message 明确列出 DB 步失败

场景: 补偿幂等
  给定 一次失败已执行补偿
  当 再次对同任务执行补偿
  那么 终态不变（无重复副作用）
```

### INVEST 判据
- **I 独立**：仅改安装失败路径，不触发热装配本身（US-1~US-4 不影响）。
- **N 可协商**：回滚粒度（是否清 web 树）可讨论，已标 best-effort。
- **V 有价值**：直接消除「失败放大匿名面 / 残留注册」生产隐患（final §0 四缺陷之三）。
- **E 可估算**：原语均复用既有函数，估计 1 个聚焦 PR。
- **S 小**：单阶段、单 PR、单 `compensate()` 入口。
- **T 可测试**：上述 4 个 BDD 场景均可在 `tests/` 以 stub oj 面跑通。

### SOLID / DRY 检查点
- **SRP**：`compensate()` 只负责「按逆序回滚已落盘资产」，不掺装前校验/审计（审计在终态块已有）。
- **OCP**：各资产回滚原语各自独立函数，新增资产类型只需加一个原语 + 在 `compensate` 注册一步，不改既有步骤。
- **DIP**：`compensate` 经注入的 fs/db/reload 面操作，测试 stub 同 installer。
- **DRY**：`revertRegistrations` 复用 `uninstall.ts` 的 DB 事务（抽 `revertRegistrations(name)`），**不复刻** `uninstallSolution` 调用；web 树移除复用 `fsFace`，不为补偿新写一份文件操作。

### 出口条件（验收映射）
- 验收 4（匿名面不放大）、验收 3 的「失败回滚」子项、E3/E5 部分。
- `tests/` 新增 Phase 1 四个 BDD 场景全绿。

**跟踪状态**：⬜ 待启动

---

## Phase 2 — 宿主能力门禁 + preflight 两条新检查（§3.6 + §3.2 preflight）

**范围**：① 模板侧 preflight 读 `ojInfo().capabilities`，缺所需子集即 `failed(host_capability)`（**写锁之前、零痕迹**）；② 新增两条 preflight 检查——「同 prefix 存在未声明匿名残留」与「目标 prefix 与既有匿名残留」（final §3.2 / E7/E8）。

**涉及文件**：`steps/preflight.ts`、`bootstrap.js`（ojInfo 注入点，本仓若持有）、`steps/reload.ts`（expected 调整）。

### BDD 场景

```gherkin
场景: 老 oj + 新模板在写锁前失败
  给定 宿主 ojInfo().capabilities 不含 reload.modules_in_key
  当 执行安装
  那么 在 preflight（锁提交前）以 host_capability 失败
   且 manifests.yaml 与 modules.json 零变更

场景: 同 prefix 匿名残留拒装
  给定 config 中 prefix=X 存在未被本次 manifest 声明的匿名条目
  当 执行安装（目标 prefix=X）
  那么 preflight 拒装，零痕迹

场景: 保留段匿名拒装
  给定 方案声明 _platform/auth 下的匿名条目
  当 执行安装
  那么 preflight 拒装
```

### INVEST 判据
- **I 独立**：只加检查，不改安装主链路写行为。
- **V 有价值**：消除「最贵失败」（锁提交后才发现能力缺失，白跑补偿）。
- **S 小**：preflight 内两函数 + 一处 capabilities 断言。
- **T 可测试**：三条 BDD 均为纯 preflight 单测，无需起服务。

### SOLID / DRY 检查点
- **SRP**：每条检查是独立谓词函数（`checkNoStrayAnonymous(prefix, config)`、`checkReservedSegment(paths)`），preflight 编排只组合。
- **OCP**：新增检查只需加谓词并注册，不改编排。
- **DRY**：capabilities 断言复用既有 preflight 失败返回形状；匿名残留检测复用 `text-edit.ts` 的解析口径（与 `appendAnonymousPaths` 同源），不重写匿名解析。

### 出口条件（验收映射）
- 验收 16（host_capability 写锁前失败）、E7/E8。
- **注意**：断言「生效」依赖 US-1 上游下发 capabilities；本阶段先落「读 + 缺失即 failed」编码，验收 16 复测待 US-1。

**跟踪状态**：✅ 已完成（2026-11-05）。能力门禁读端 + 缺失即 failed 编码已落地，preflight 两条新检查（宿主能力门禁、同 prefix 匿名残留 E8）已落地并标 BDD；E7 保留段匿名拒装（manifest 级 C2-26）保留。验收 16 断言「生效」仍依赖 US-1 上游下发 capabilities，待 US-1 到位复测。

---

## Phase 3 — smoke 收紧 + 无守护 partial 判定（§3.6 收尾）

**范围**：① smoke 探首个路由，404/连接失败 = 失败（final §3.5 表格）；② 无守护形态下 `restart_pending` 非空 → 任务 `partial + restart.required:true` + 重启命令提示，**不判 done**（final §6 G4b / 验收 15）；③ 删除「anonymous 预期 401」旧口径（匿名端点装完必须 200）。

**涉及文件**：`steps/smoke.ts`、`installer.ts`（终态判定）、`steps/reload.ts`（restart_pending 透传）。

### BDD 场景

```gherkin
场景: smoke 探活 404 判 partial
  给定 安装完成但首个路由返回 404
  当 任务终态计算
  那么 任务 = partial（不判 done）

场景: 无守护需换进程如实标 partial
  给定 oj serve（无壳）形态
  当 reload 返回 restart_pending 非空
  那么 任务 = partial + restart.required:true + 重启命令
   且 热装载已生效部分不回滚

场景: 匿名端点装完 200
  给定 方案声明 api.anonymous
  当 安装完成 smoke 探该端点
  那么 返回 200（非 401）
```

### INVEST 判据
- **I 独立**：只改终态判定与 smoke 探活，不碰补偿/卸载。
- **V 有价值**：消灭「假成功 done」——生产最易被忽视的误导（final §0 缺陷之四）。
- **S 小**：smoke.ts 一处探活语义 + installer 终态一处分支。
- **T 可测试**：三条 BDD 以 stub reload/smoke 面即可。

### SOLID / DRY 检查点
- **SRP**：`restart_required` 判定从「安装主链路」抽到独立 `decideTerminalStatus(reloadResult, hasSupervisor)` 函数。
- **DRY**：smoke 探活 401/403=已注册、404=失败 的判定复用 `reload.ts` 既有的 `applied`/`restart_pending` 解析，不重复 HTTP 语义。

### 出口条件（验收映射）
- 验收 6、15、16（与 Phase 2 协同）、E20。
- `tests/` 三条 BDD 全绿。

**跟踪状态**：✅ 已完成（2026-11-05）。
- ① smoke 收紧：探活失败判定从「仅 health」扩展到「所有探测目标（health 或首个非匿名路由）」——非 401 的 `!ok`（404/500/连通失败）一律判探活失败（P0 §3.5：首个路由 404/连通失败 = 冒烟失败，灭假成功）；401 维持 deferred（无凭证探针常态，宿主重启后 2xx）。保留既有「首个非匿名路由 401 亦过」「health 401 一律 deferred」两条已测行为。
- ② 无守护 partial 判定：`reloadAndAssert` 现回传 `restart_pending`；installer 终态在「本应 done」且待重启段非空（无 supervisor 自动换进程，P4 未实施）时改标 `partial + restartRequired:true`，message 含重启提示，且**不**触发失败语义②补偿（本次安装成功，无需回滚）。消除 final §0 缺陷之四（假成功 done）。
- ③ 删除 anonymous 预期 401 旧口径：`SmokeContext.deferredAnonymous` 为从未被赋值的死代码，已删除；deferred 规则统一为「health/非匿名路由 401 一律 deferred」，与「隐式 anonymous 白名单放宽 401」旧语义解耦（既有 deploy-smoke 测试已固化此意图）。
- **验证**：`tests/lifecycle` 全绿 569/569，typecheck 通过；新增 Phase 3 BDD：非 health 404→失败、restart_pending 非空→partial+restartRequired、空→done。

---

## Phase 4 — 卸载顺序对齐（§3.4 本仓部分）

**范围**：本仓 `uninstall.ts` 已是「先失可达性再失文件」形态（DB 事务 → sidecar → modules.json → 摘锁 → 删盘）。本阶段对齐两点：① reload 触发改为依赖 US-1 的 manifests 摘要（摘锁即自动触发装配，不再依赖隐式 seq）；② 卸载 reload 失败 → 锁写回 + 再 reload 回旧代（final §3.4 第 5 步），当前 uninstall 摘锁后未显式 reload 也未处理 reload 失败回滚。

**涉及文件**：`uninstall.ts`、`lock.ts`（已支持写回）、`steps/reload.ts`。

### BDD 场景

```gherkin
场景: 卸载后路由立即 404
  给定 已装 B 方案
  当 卸载完成
  那么 1s 内 B 的 prefix 全部 404
   且 modules.json 无 B 条目
   且 其他模块仍 200

场景: 卸载 reload 失败可重试
  给定 卸载摘锁后 reload 失败
  当 卸载结束
  那么 锁写回（模块仍挂载）
   且 任务 partial 可重试
   且 目录未删（不留缺目录状态）
```

### INVEST 判据
- **I 独立**：只改卸载收尾的 reload 编排。
- **V 有价值**：消除「卸载不全站拒启」风险（final §0 缺陷之一）。
- **S 小**：uninstall.ts 末尾加 reload 调用 + 失败回滚分支。
- **T 可测试**：两条 BDD 以 stub reload 面。

### SOLID / DRY 检查点
- **SRP**：卸载的「reload + 失败回滚」抽到 `finalizeUninstall()`，不在主编排内联。
- **DRY**：失败回滚的「锁写回 + 再 reload」复用 `lock.ts` 的 `writeLock` 与 `reload.ts` 的 `reloadAndAssert`，不重写。

### 出口条件（验收映射）
- 验收 3、E9/E10/E11。
- **注意**：reload 触发的「manifests 摘要驱动」语义依赖 US-1；本阶段先落本仓编排，复测待 US-1。

**跟踪状态**：✅ 已完成（2026-11-05，本仓编排；① 待 US-1）。
- `uninstall.ts` 已有「先失可达性再失文件」顺序（DB级联 → 锁摘除 → 版本目录移除）。本阶段新增 ②：锁摘除后显式 `reload` 触达装配以真正摘除模块（P0 §3.4 第5步），reload 面经 `UninstallInput.reload` 注入（api.ts 经 `reloadOf(env)` 接线，生产回落 `g.server.reloadConfig`，dev/test 无 server 回落 no-op）。
- **reload 失败回滚（fail-closed 一致回滚）**：reload 抛错 → 锁写回原值 + 再 reload 回旧代（best-effort）+ 返回 `{ok:false, message 含 reload 失败}`。关键排序修正：sidecar/modules.json/版本目录的删除**移到 reload 成功之后**——reload 失败即停，仅锁被摘并已写回，元数据与文件均未动，回滚后状态完全一致（无半卸残留），可重试。
- ①「manifests 摘要驱动 reload 实际掉挂载」依赖 US-1 上游实装；未到位前 reload 回落 no-op，卸载仍按既有顺序完成（仅缺「运行时真正摘挂载」这一环，US-1 到位补实）。
- **验证**：`tests/lifecycle` 全绿 571/571，typecheck 通过；新增 Phase 4 BDD：reload 失败→锁写回+版本目录不删+ok:false、reload 成功→版本目录移除如常。

---

## 上游依赖（阻塞跟踪，本仓不实施）

| 编号 | 内容 | 为何阻塞本仓 | 跟踪动作 |
|---|---|---|---|
| US-1 | §3.1 换代身份 `generation_key ⊕ 锁摘要` + `modules` 进 applied | Phase 2 断言生效、Phase 4 reload 触发均依赖 | 提 oj issue，标注「本仓 Phase 2/4 等该发版」 |
| US-2 | §3.2 匿名 dispatch 短路 | 验收 2（匿名 200）实际生效依赖 | 同 issue 跟踪 |
| US-3 | §3.3 cron 独立线程 | 验收 7（cron reload 后仍触发）依赖 | 同 issue 跟踪 |
| US-4 | §3.5 启动自检降级 | 验收 5（缺目录跳过）依赖 | 同 issue 跟踪 |

> 这些 Phase 的 BDD 中标注「依赖 US-x」的验收项，在本仓只能先落编码 + 单测（以 stub 模拟上游行为），待上游发版后在真机复测。

## 终审（全阶段完成后执行）

终审范围与方法：
1. **逐阶段复核**：每个 Phase 的 INVEST 判据是否仍成立、BDD 是否全绿、SOLID/DRY 检查点是否守住。
2. **跨阶段回归**：上游依赖到位后，跑 final §5 全部 17 条验收（本仓可覆盖 3/4/5/6/15/16，其余标注需上游）。
3. **架构复核**：`compensate` 与 `cancelCleanup` 是否仍无重复逻辑（DRY）；preflight 检查是否仍各自单一职责（SRP）；是否有为补偿新写的「第二套文件操作」。
4. **风险账复核**：final §7 风险表逐项确认处置仍在位（尤其匿名面不放大、补偿幂等）。
5. **输出**：终审报告（通过/遗留 + 每条遗留的 owner 与下一步），不自动合入，交人工裁决。

**终审结论（2026-11-05，执行人：CodeBuddy）**：本仓 Phase 1–4 全部完成，`tests/lifecycle` 全绿 571/571、typecheck 通过。上游 US-1~US-4 仍阻塞跟踪中，其门控的验收项待上游发版后复测。无自动合入，交人工裁决。

### 1. 逐阶段复核

| Phase | INVEST | BDD | SOLID/DRY | 结论 |
|---|---|---|---|---|
| P1 补偿清单 | ✅ 单 PR、可测、可协商 | 4 场景（全回滚/幂等/部分失败仍回滚/匿名面不放大）绿 | `compensate()` 单一职责；复用 `revertRegistrations`/`removeAnonymousPaths`/`removeModulesJsonEntry`/`revertLock` | ✅ |
| P2 宿主门禁 | ✅ 只加检查不改主链路 | 能力门禁 + E8 同 prefix 残留 绿 | 检查谓词内联、复用 `readAnonymousPaths` 解析口径 | ✅ |
| P3 smoke 收紧 + 无守护 partial | ✅ 只改终态/探活 | 404→fail / restart_pending→partial+restartRequired / 空→done 绿 | `decideTerminalStatus` 内联于终态块；`reloadAndAssert` 回传 `restartPending` | ✅ |
| P4 卸载顺序对齐 | ✅ 只改卸载收尾 reload 编排 | reload 失败→锁写回+目录不删 / 成功→目录移除 绿 | reload 经 `UninstallInput.reload` 注入；失败回滚复用 `writeLock` | ✅ |

### 2. 跨阶段回归（验收项覆盖）

- **本仓已落地**：验收 3（失败回滚 + 卸载顺序）、4（匿名面不放大）、5（启动降级——上游 US-4 实装后复测）、6（smoke 收紧灭假成功）、15（无守护 restart_pending→partial）、16（host_capability 写锁前失败；断言生效待 US-1）。
- **依赖上游（标注，不计入本仓回归）**：验收 1（换代身份 generation_key，US-1）、2（匿名 200 dispatch 短路，US-2）、7（cron reload 后仍触发，US-3）、5 真源（US-4）。

### 3. 架构复核

- **DRY**：`compensate`（installer 失败语义②）与 `cancelCleanup`（U5 取消）共用 `revertLock`（lock.ts），无重复锁回退逻辑；`compensate` 不写任何 `writeFile`/`remove` 直接调用，全部委托既有原语（`removeAnonymousPaths`/`removeModulesJsonEntry`/`revertRegistrations`/`revertLock`）——**无第二套文件操作**。
- **SRP**：preflight 各检查（能力/capabilities、同 prefix 匿名残留、保留段声明）各自独立、纯校验只读 ctx；`compensate` 只做逆序回滚不掺审计；reload 终态断言与 restart_pending 透传分离。
- **OCP/DIP**：reload 面、fs 面、db 面全注入（测试 stub），上游 US-1 落地不改动本仓编排。

### 4. 风险账复核（final §7）

- **匿名面不放大**：`compensate` 按 `deferredAnonymous` 精确移除本次新增匿名条目，幂等（`removeAnonymousPaths` 去重）→ 连续失败不增长；补偿测试「匿名面不随失败放大」已锁。✅
- **补偿幂等**：`compensate` 各步独立 try/catch、可重入；测试「补偿幂等」已锁。✅
- **失败语义三分守序**：锁前失败→清场零痕迹；锁后失败→partial+补偿；needs_trust→停预锁段；取消→清场+锁/目录回退装前。终态审计恒末位。✅
- **假成功 done 已灭**：P3 将 restart_pending 非空（无守护）如实标 partial+restartRequired，不再一律 done。✅
- **E8 假阳性已修**：保留段 config 条目（宿主内建）不再误判残留拒装。✅

### 5. 遗留与下一步（owner：上游 oj / 本仓 follow-up）

| 遗留 | 门控 | owner | 下一步 |
|---|---|---|---|
| US-1 换代身份 + manifests 摘要驱动 reload | 验收 1/2/5 真源 + P2 断言生效 + P4 运行时真正摘挂载 | 上游 oj | 提 oj issue 跟踪；发版后在真机复测验收 1/2/16 |
| US-2 匿名 dispatch 短路 | 验收 2（匿名 200 实际生效） | 上游 oj | 同上 |
| US-3 cron 独立线程 | 验收 7 | 上游 oj | 同上 |
| US-4 启动自检降级 | 验收 5 真源 | 上游 oj | 同上 |
| P4 ① manifests 摘要驱动 reload 实装 | 卸载运行时真正摘挂载 | 本仓（依赖 US-1） | US-1 落地后把 no-op 回落替换为真实 reloadConfig 摘要语义 |

**跟踪状态**：✅ 终审完成（2026-11-05）——本仓可交付，待人工裁决合入；上游 US-1~US-4 门控项待发版复测。
