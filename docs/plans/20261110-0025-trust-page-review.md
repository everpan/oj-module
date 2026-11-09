# 首装信任改为页面审核（needs_trust 提示面改造）

日期：2026-11-10 00:25 · 分支：`feat/ojm-trust-page-review`（基线 `feat/ojm`）

## 需求

原逻辑（newcomer.md §5 引文）：「首装必停 `needs_trust`——**逐字核对指纹**后超管
`ojm trust confirm --task <id>`，重试同一条到 `status=done`」。

改为：**首装停 `needs_trust` 时，安装尝试本身即隐式提交指纹**（任务记录已携带
`{key_id, public_key, fingerprint}`，服务端零改动）；提示语只引导
「superadmin 在方案市场页面审核确认」（复用 InstallDialog 现有「确认信任」按钮 →
`POST /market/trust {task_id}`，超管门禁），**不再要求逐字核对指纹、不再让用户执行
`ojm trust confirm` 命令**；审核入库后重试安装即放行。

决策记录（与需求方确认）：

- 提交方式：**隐式**——不新增显式「提交审核」动作/端点/审计字段。
- 审核入口：**方案 A 最小面**——不加新审核列表 UI；超管在市场页对同一方案点安装，
  于 `needs_trust` 弹窗中确认（现有能力）。
- `ojm trust confirm` CLI **命令保留**（运维旁路仍在），但所有面向用户的指引
  **只提示页面确认**，不再教这条命令。

## 改动面

### 代码（提示语文案）

| 文件 | 位置 | 改动 |
|---|---|---|
| `packages/cli/src/install.ts` | `renderOutcome` needs_trust 分支 | 去掉「逐字核对 + confirm 命令」，改为「指纹已随任务提交，superadmin 请在市场页审核确认，通过后重试安装」；指纹仍展示（留痕，不作逐字核对要求） |
| `packages/cli/src/install.ts` | `VERIFY_CODE_COPY.unknown_key.hint` | 同上口径（页面审核，不提 CLI 命令） |
| `packages/cli/templates/.../steps/verify.ts` | unknown_key message | 同上口径 |
| `packages/cli/src/market/failure-playbook.ts` | unknown_key `next` | walkthrough 失败报告的引导同步改页面口径 |
| `packages/cli/templates/src/oj-market/web/locales/{zh-CN,en-US}.json` | `trustHint` / `trustConfirm` | 弹窗提示改为 superadmin 审核语义（不再「逐字核对」），按钮文案微调 |

不在范围内：服务端（install/trust 端点、任务模型）、InstallDialog 结构、
`trust.ts`/`usage.ts`（命令保留，help 原文不动）。

### 文档（双份 devkit 同步改）

- `packages/cli/devkit/{newcomer,manual,publish-walkthrough,module-dev-and-cdn-playground}.md`
  与镜像 `docs/devkit/` 同名四件（`tests/cli/devkit-docs.test.ts` 有镜像一致性门禁）。
- `docs/guides/solution-dev-build-publish.md`、`docs/guides/20261026-1740-lesson-init-to-market-install.md`
- `docs/prd/solution/{DEVELOPER,OPERATIONS}.md`

不改（历史/演练记录，保留当时口径）：`docs/plans/*`、`docs/prd/solution/archive/*`、
`docs/prd/20261026-registry-cli-commands-design.md`、`docs/prd/framework-verification-playbook.md`、
`docs/prd/solution/VERIFICATION.md`（内含可执行演练命令，命令本身仍可用）。

## 任务（TDD：先改测试断言，看红，再改实现）

- [x] T1 更新断言旧文案的测试（cli install/trust 用例、templates installer/market-api/bootstrap 用例、web 组件用例如涉及）——实钉 3 处：`install.test.ts`（renderOutcome needs_trust）、`devkit-docs.test.ts`（§12 守卫）、`InstallDialog.test.tsx`（按钮文案）；两处先看红
- [x] T2 改五处源码文案 → 相关套件转绿（cli install 55 ✓、templates 全套 1217 ✓、根 1013 ✓、cli 包全量 678 ✓、eslint 0）
- [x] T3 改文档：devkit 四件（manual §12 mermaid+§12.2、newcomer §5、publish-walkthrough 三处、playground 两处）+ guides 两件 + prd/solution 两件（DEVELOPER/OPERATIONS）；`sync-devkit.mjs` 已同步进 packages/cli/devkit（gitignore 产物）
- [x] T4 全量门禁通过（见 T2 数字）

## 问题记录

- **反常识①**：templates 的 vitest 配置已迁移——记忆与早期文档写
  `packages/cli/templates/api/vitest.config.ts`，实际是 `packages/cli/templates/vitest.config.ts`
  （api/ 下只剩运行产物 db.sqlite/dist/logs）。照记忆路径跑报 UNRESOLVED_ENTRY。
- **反常识②**：`packages/cli/devkit/` 整个目录被 gitignore——它是 prepack 时由
  `sync-devkit.mjs` 从 `docs/devkit/` 生成的发货产物，改文档只改 `docs/devkit/` 一侧即可，
  同步后无需提交该目录。

## 总结

关键过程：调查现状（needs_trust 任务已持久化 trust 三元组 + InstallDialog 已有超管确认按钮
+ `POST /market/trust {task_id}` 端点现成）→ 与需求方两轮定界（隐式提交 / 方案 A 不加新 UI /
用户面不再出现 `ojm trust confirm`）→ 分支 `feat/ojm-trust-page-review` → TDD 三处测试先红
→ 五处源码文案 + 八份文档 → 四套测试 + eslint 全绿。耗时约 15 分钟（0025–0040）。

未触达（有意裁剪）：`ojm trust confirm` 命令本体与 usage help（运维旁路保留）；
`docs/plans`、`docs/prd/solution/archive`、`framework-verification-playbook.md`、`VERIFICATION.md`、
registry PRD 等历史/演练记录保留当时口径；服务端零改动（隐式提交=任务记录本身）。

