# OJ-9 · `migrate: 支持 down 迁移（或提供账本回退原语）`

**提交人**：ever <unix@vip.qq.com> · **日期**：2026-10-17 · **优先级建议**：P3（低优、非阻塞——落地前消费方以校验兜底）

## 背景与实测依据

oj 迁移**只前向、无 down**：账本 seq 超过产物 migrations 最大 seq（降版部署）即 M003 拒启
（`oj/src/migrate.rs:447-448`；文案 `oj/src/migrate.rs:479` 起）。人工回退账本须同步回退 DDL 并自担数据风险——这是官方文案的原话口径。

实测（消费方仓 C1 spike S1-6，oj 0.1.76，release `migrate_on_start: verify` 缺省门禁）：

- **M003 复现**：账本 apply 到 seq 2 后把产物换回 seq 1 版本 → `oj serve` exit 1：

  ```text
  oj serve: module demo: M003: 模块 demo 账本 seq（2）超过产物 migrations 最大 seq（1）——降版部署被禁止（§4.6）
    下一步：部署含最新迁移的产物；人工回退账本须同步回退 DDL 并自担数据风险
  ```

- 同状态跑 `oj migrate`（非 serve）**不是 M003**，而是 refinery 层
  `at seq 3: migration V2__add_note is missing from the filesystem`——调用方需同时识别两种文案；
- 对照组 M004（锁指新版 + 账本落后）同样 exit 1 拒启，文案含 `oj migrate` 指引。

消费方场景：解决方案（模块）市场的安装器需要支持「降级」动作（升级后回退到低版本）。
当前消费方侧红线：仅当目标版本**迁移无差异**（账本 seq 可对齐）才放行降级，且须强告警二次确认 +
切换前对目标版本产物复验。这意味着**含 DDL 变更的升级一旦需要回退，即被 M003 卡死**——「回得去」在这一类升级上不可达，只能重装（数据迁移到新实例）。

## 诉求形态（渐进两档，任一即可）

1. **内建 down 迁移**：迁移文件支持 down 侧声明（如 `V{n}__x.down.sql` 或 manifest 内等价声明），
   `oj migrate --down --to <version>`（或等价 CLI/模块面形态）；
2. **账本回退原语**（更小步）：`oj migrate rollback --module <m> --seq <n>`——只移除账本条目，
   DDL 回退责任在调用方，命令输出明示此点（半自动口径）。

## 验收标准

- 模块由高版本降到低版本后，release 启动**不再 M003/M004 拒启**；
- down/回退逐条留痕：账本条目移除与实际执行的 down DDL 一一可对账（日志含迁移序号）；
- down 中途失败时，账本与库状态的一致性可判定——不产生「半回退」模糊态（已应用/未应用边界明确）；
- release 缺省 `migrate_on_start: verify` 门禁行为不变。

## 非目标

- 不做自动数据回滚：数据迁移（DML）的逆变换不在本条范围，down 仅覆盖 schema 侧或由迁移作者显式书写；
- 不放松降版部署的缺省门禁：无 down 能力时的现状（M003 拒启）在本条落地前维持不变；
- 不改迁移账本存储格式（新增条目类型/标记可议，格式不推翻）。
