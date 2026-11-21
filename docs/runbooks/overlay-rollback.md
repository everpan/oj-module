# overlay 物化回滚剧本（C2-31 写面切换后）

> 适用版本：@oj-module/cli ≥ 0.2.97（sys_module_overlay 表落地后）。
> 配套文档：主文档 `docs/prd/202611201106-modules-json-db-feasibility.md` §4（三层架构）、
> 实施计划 `docs/plans/20261121-2040-modules-json-overlay-implementation-plan.md`。

## 0. 部署拓扑声明（P4-T2）

| 形态 | 判定 | 物化职责 |
|---|---|---|
| **单机**（一个 serve 进程 + 本地盘） | 默认形态 | 进程内 site-materialize 唯一写者；catch-up 挂市场页对账时点 |
| **共享卷**（多 serve 进程挂同一 dist） | 多副本部署 | 文件级原子写（D13）已保证读者无半截 JSON；滞后检测以 **DB seq vs overlay-cache.json** 为准（非 mtime——共享卷 mtime 不可靠）；任一进程触发物化都对全集群生效 |

启动探针 = catch-up 滞后检测：cache `db_seq < DB seq`（或 cache 丢失/失败计数非零）→
自动重算 + `site-materialize` 结构化日志（含 `lag_sec`）；连续失败 5 次 →
`site-materialize-alarm` 上 error 日志。运维盯这两条日志即可。

## 1. 正常态不变量（回滚前确认）

- `modules.json` / `overlay-cache.json` / `modules/.solutions/` 下的 face 旁车是**物化产物与缓存**，
  真源只有两处：源码树构建产物（基线）+ `sys_module_overlay` 表（叠加层）。
- 单模块单启用版本由**部分唯一索引**硬保证（sqlite/pg `WHERE enabled=1`；mysql 生成列）。
  出现双启用 = 绕过了应用层直接改库——物化会 fail-loud 拒产，不是清单错。

## 2. 回滚剧本（expand/contract）

本期是 **expand**（加 overlay 表，旧机制全部保留为 legacy 回落）——`ojm build` /
`ojm dev` 的 mergeInstalledModules 与模板的 `dbSeq === null` 分支都还在。
因此回滚 = 关掉新面，不删数据：

1. **回滚模板**到 overlay 前版本（ reinstall 旧 templates 或整体回退镜像）。
   overlay 表留在库里无副作用（旧模板不读它）。
2. **回滚 cli** 到 0.2.96 或更早：构建面走回 sidecar-only 合并（modules/.solutions/state.yaml）。
   注意：overlay 时代写入的 enabled 状态在表里，旧 cli 不读——
   **若回滚后需要这些启停状态**，先跑 `verify` 导出差异，回滚后手工重放 setEnabled。
3. **反向（再前进）**：直接部署新模板 + 新 cli 即完成 contract 的前半；
   contract 后半（删 legacy 回落分支、sidecar 降纯缓存）在双名过渡一个版本周期后单独立项。

混布窗口（新表已建、个别节点旧模板）：旧节点照跑（dbSeq=null → legacy 直写），
新节点物化。两族节点同写一个 modules.json 的窗口期**应尽量短**——旧节点直写会
被新节点下次物化按 DB 状态覆盖（最终一致，但中途可能闪烁）。建议混布不超过一个发布周期。

## 3. CDN / 静态服务验收探针

派生清单的消费契约未变（浏览器/Rust oj serve 裸 import entry），验收点：

- `modules.json` 响应头保持 **no-cache + ETag/304**（ Rust oj serve 既有行为，勿加 max-age）；
  物化零变化不写盘即不扰动 mtime，304 消费面不受影响。
- 发布新物化后，首次拉取必得新内容（no-cache 保证）；若前端缓存了旧清单导致 404 entry，
  硬刷新即收敛——不是清单错，是 CDN 层加了缓存（排查 CDN 是否违背 no-cache）。

## 4. 常见处置速查

| 现象 | 判定 | 处置 |
|---|---|---|
| `site-materialize-alarm` | catch-up 连续失败 ≥5 | 看 error 日志的 `error` 字段；多为基线损坏 → 修复 modules.json（从构建重铺）后自愈 |
| 离线构建拒写（fail-stale） | sidecar seq < 已知 DB seq | 联网跑一次 `ojm build` 或任一生命周期操作（catch-up 补齐序号）后重试 |
| 市场菜单缺方案 | face 旁车/条目缺失 | `ojm install <name>@<version>` 重装愈合 |
| 双启用脏数据 | 直改库绕过应用层 | 按 `old_state` 审计列人工仲裁回单启用，下次物化自动收敛 |
