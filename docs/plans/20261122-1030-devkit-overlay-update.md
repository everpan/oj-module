# devkit overlay 化更新计划（2026-11-22 10:30）

## 背景

overlay 物化方案 Phase 0-5 已落地并真机演练（2026-11-22 基线，playbook 附录 A）。devkit
（`docs/devkit/` 顶层 8 件 → prepack `sync-devkit.mjs` → `packages/cli/devkit/` → `ojm init`
分发 `.claude/skills/ojm-module-dev/`，`copyIfAbsent` 幂等补缺不覆盖）仍是 overlay 前的口径：

- §11.3/§11.4 生命周期描述停在「四处同写/同删」时代，缺 modules.json 派生物身份、
  DB 先行写序、软删、catch-up 自愈、离线 fail-stale
- publish-walkthrough 升级路径缺「版本推进 4 文件同步清单」与「同版本不可覆盖」判据
- publish-walkthrough:378 有 `docs/migration/` 内部引用（自包含违规，分发件必须零命中）

## 任务（INVEST 切分）

- [x] T1 manual.md §11.3 追加「overlay 口径」块：modules.json = 基线 + sys_module_overlay 物化产物（勿手改）；启停/卸载先 DB 后文件；卸载 = 软删（行留 enabled=0）；崩溃窗 catch-up（riding 市场页刷新）；离线构建 fail-stale；结构化日志 jsonl 落点
- [x] T2 manual.md §11.4 表：enable/disable/uninstall 三行改写（五写面 → DB 先行 + 物化；卸载软删）
- [x] T3 publish-walkthrough：升级路径补 4 文件版本推进清单 + 409 同版本一份字节 + swap 原子换版观测点（旧行 enabled=0 新行 enabled=1 同 seq）
- [x] T4 自包含修复：publish-walkthrough:378 去掉 docs/migration 引用；`grep docs/migration|docs/plans|../oj-api-dev` 分发 8 件零命中
- [x] T5 同步 `packages/cli/devkit/`（跑 sync-devkit.mjs，同 prepack 口径）；全量测试 + lint

## 验收

- 分发 8 件自包含 grep 零命中
- vendor-devkit / cli 全量测试绿
- 内容与实际行为一致（对照 2026-11-22 真机基线的 DB 观测表）

## 变更记录

- 2026-11-22 10:30 初版。
- 2026-11-22 约 10:45 全部完成：manual §11.3 overlay 口径块（派生物身份/先 DB 后文件/软删/原子换版/fail-stale/jsonl 观测）、§11.4 表三行改写；walkthrough 升级路径 4 文件清单 + 409 判据 + swap 观测点；自包含违规修复 1 处（:378 docs/migration 引用）；sync-devkit 已同步发布副本（packages/cli/devkit 为 prepack 产物、gitignore 不入库——单一真源 docs/devkit）。分发 8 件自包含 grep 零命中，vendor-devkit 测试绿。耗时约 15min。
