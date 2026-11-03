# 需求：ojm init / ojm vendor 全链路 devkit 落地与文档同步

日期：2026-11-03 10:20 · 分支：feat/vendor-devkit-sync

## 1. 背景与问题

devkit 是两套独立分发的 skill（docs/devkit/README.md 口径）：

| 侧 | 分发链 | 现状 |
|----|--------|------|
| ojm 模块开发 | `docs/devkit/` 顶层 → prepack `sync-devkit.mjs` → `packages/cli/devkit/` → `ojm init` 步骤 4b → `.claude/skills/ojm-module-dev/` | ✅ 已通 |
| oj API 开发 | oj 二进制自带 `bin/devkit/`（@oj-bin/oj postinstall 落盘）→ `ojm init` 步骤 4 → `.claude/skills/oj-api-dev/` | ⚠️ **仅 init 有**；单独跑 `ojm vendor`（给已有工程装/升 oj）**不分发 devkit** |

另有一处**文档同步缺口**：init 步骤 4 是 `copyIfAbsent`（首拷赢、永不更新）——oj 升级后
skill 文档停留在首次安装时的旧版，与 `bin/oj` 版本脱钩。分发链上唯一会刷新 bin/devkit 的
动作就是 vendor，它恰恰不碰 skill 目录。

## 2. 需求

- R1 `ojm init` 继续把 ojm devkit 装进工程（现状保持，回归钉住）。
- R2 `ojm vendor` 安装/升级 oj 后，把 `bin/devkit/` 的文档同步进工程 `.claude/skills/oj-api-dev/`。
- R3 **文档同步语义**：同步 = 覆盖到当前 oj 版本（bin/devkit 是权威源，用户手改 skill 文档
  以 oj 版本为准被刷新）；`bin/devkit` 缺失（旧版 oj/异常安装）→ 记跳过、不失败。
- R4 同版本跳过路径（`oj 已是 vX，跳过`）**也**执行同步——用户删过 skill 目录后重跑 vendor 即可补齐。
- R5 init 步骤 4 改走同一同步出口（单一口径，消灭 copyIfAbsent/copyIfPresent 两套语义并存）；
  `global.d.ts`（模板自有变体，用户可编辑）仍保持 copyIfAbsent 不被 vendor 覆写。
- R6 同步范围为 `bin/devkit/` 下**全部 `.md`**（按目录扫描而非写死清单——oj 未来新增文档零维护自动跟上）。

## 3. 设计

- `vendor.ts` 新增 `syncOjDevkit(projectRoot, binDir, log): { ok: boolean, files: string[] }`：
  - `bin/devkit/SKILL.md` 不存在 → `{ok:false}`（调用方记录跳过）；
  - 否则 mkdir `.claude/skills/oj-api-dev/`，把 devkit 下全部 `.md` 覆盖拷入，返回清单。
- `vendorCommand`：装完 `installFromNpm` 后 + 同版本跳过路径，各调一次，成功打一行
  `[ojm] oj devkit 文档已同步 → .claude/skills/oj-api-dev/（N 个文件）`。
- `init.ts` 步骤 4：内联四文件 copyIfAbsent/copyIfPresent 逻辑替换为 `syncOjDevkit` 调用；
  `global.d.ts` 的 copyIfAbsent 单独保留（R5）。报告行：`oj devkit 文档已同步（N 个 .md）`。

## 4. BDD 用例

| 用例 | 验收 |
|------|------|
| bin/devkit 齐备 → skill 目录落全部 .md（含非清单文件如 scenarios.md） | R2/R6 |
| 旧 skill 目录含过期内容 → 覆盖为新版（同步语义，非首拷赢） | R3 |
| bin/devkit 缺 SKILL.md → ok:false、skill 目录不被创建、不抛错 | R3 |
| init 步骤 4 经同一出口：devkit 齐 → 同步行；缺 → skipped 行 | R5 |
| init 重跑：global.d.ts 已存在不覆盖（模板变体保护） | R5 |
| 回归：init 后 `.claude/skills/ojm-module-dev/` 六文件在（4b 现状钉住） | R1 |

## 5. 任务

- [x] T1 计划文档（本文档）
- [x] T2 分支 feat/vendor-devkit-sync
- [x] T3 测试先行：vendor-devkit.test.ts 5 用例（syncOjDevkit 单测 3 + init 集成 2），红→绿
- [x] T4 实现：vendor.ts syncOjDevkit + vendorCommand 两处接线（安装后 + 同版本跳过路径）；init.ts 步骤 4 换出口、删除 copyIfPresent 死代码
- [x] T5 全量验证：cli 609 通过 + 1 skip · tsc 0 · lint 0 · devkit README 分发链口径已更新
- [x] T6 计划文档补状态与总结

## 7. 总结（关键过程与耗时）

总耗时 ~25 分钟（10:20 计划 → 10:30 提交）。关键点：

1. **勘察确认**：`@oj-bin/oj` postinstall 已把 `bin/{oj,plugins,devkit}` 落盘——vendor 通道**早就有** oj devkit 数据源，缺的只是「bin/devkit → .claude/skills/oj-api-dev」这最后一步搬运（此前只在 init 步骤 4 有，且是 copyIfAbsent 首拷赢）。
2. **单一出口**：`syncOjDevkit()` 收敛在 vendor.ts（binDir 注入），vendor 与 init 共用；同步范围按目录扫描全部 `.md`（R6）——oj 未来新增文档零维护自动跟上，旧 init 写死四文件清单的维护负担一并消灭。
3. **边界保护**：`global.d.ts` 不参与 vendor 覆盖（工程根是模板自有变体，与 bin/devkit 版已分叉——diff 实证），init 保留 copyIfAbsent；集成用例钉住。
4. **同版本跳过路径也同步**（R4）：删过 skill 目录的用户重跑 `ojm vendor` 即补齐，无需 --force。

全绿证据：cli 609 通过（+5 新用例）/ 1 skip，tsc/lint 零问题。

## 6. 风险

- 用户手改过 `.claude/skills/oj-api-dev/` 的文档会被 vendor 覆盖——这是同步语义的代价，
  权威源随 oj 二进制走（README 已声明「快照，不是本仓维护的文档」）。
- init 语义从「首拷赢」变「覆盖同步」：重跑 init 会用当前 bin/devkit 刷新 skill 文档（预期行为）。
