# 全量测试红三宗：stale 契约（publishConfig/平铺布局）+ .tmp-fx 未忽略

- 日期：2026-10-23 13:55
- 分支：fix/test-suite-stale-contracts
- 状态：已完成（2026-10-23 14:05）

## 需求

`pnpm exec vitest run`（全量）当前 4 红，均为「测试断言钉死已被设计翻转的
旧契约」，非产品缺陷：

1. `tests/security/supply-chain.test.ts` ×2：断言 `publishConfig.registry
   = npmjs`——2026-10-23 10:27 设计已**移除**该字段（压过 --registry 与
   .npmrc 映射，模拟发 verdaccio 被迫改 package.json），官方源锁定改由
   发版脚本 publishArgs 显式 `--registry` 钉死。
2. `tests/integration/uni-dev-smoke.test.ts` ×2：断言平铺布局路径
   `api/config.yaml` / `api/config/cert.jws` / `api/.ojm-preview.yaml`——
   module-root 改写（0.2.20）后 config.yaml 在工程根，三处实际为
   `config.yaml` / `config/cert.jws` / `.ojm-preview.yaml`。

另：用户报 `tests/cli/vditor-external.test.ts` 在守卫套件里偶发
`[UNRESOLVED_ENTRY] Cannot resolve entry module .tmp-fx/vditor-*/web/src/entry.tsx`。
本机单跑/守卫套件/全量三语境均**未能复现**（全量中该测试通过）。可确认的
隐患面：`.tmp-fx/` 未被 gitignore——夹具残留会脏树卡发布脚本 step 1
checkCleanTree，`git clean/stash` 类操作可删除运行中的夹具文件造成
恰好此形的报错。本轮做防护，无法给出根因级修复。

## 方案

- supply-chain：publishConfig 断言反转为「registry 必须缺席（防回流）+
  access 仍 public」，另加「发版脚本显式钉死官方源」断言承接锁定职责。
- uni-dev-smoke：三处路径改 module-root 口径。
- `.gitignore` 增 `.tmp-fx/`（与既有 `.tmp-oj-fx/` 同段）。
- `preview.ts` 头部注释 `api/.ojm-preview.yaml` → `.ojm-preview.yaml`。

## 测试用例（BDD）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| publishConfig 新契约 | 两包 package.json | 查 publishConfig | registry 缺席 + access=public；脚本含 --registry npmjs |
| init module-root 落盘 | `ojm init --yes` | 查产物 | 根 config.yaml + config/cert.jws（非 api/ 下） |
| preview 派生 config | `ojm preview` 运行中 | 查派生文件 | 根 .ojm-preview.yaml，退出后清理 |

（以上用例即被修测试本身；当前为红基线，修后转绿。）

## 任务

- [x] 建分支 fix/test-suite-stale-contracts
- [x] supply-chain 契约反转 + 脚本锁定断言
- [x] uni-dev-smoke 三路径 module-root 化
- [x] .gitignore 增 .tmp-fx/ + preview.ts 注释
- [x] 全量测试转绿 + lint
- [x] 合入 feat/ojm（--no-ff）删分支
- [x] 更新本文档状态与总结

## 问题记录

1. 设计翻转后旧契约测试无人报警的两个条件叠加：publish-registry-pinning
   计划没把「改设计必改钉死契约的测试」列入任务（guard 套件不含
   tests/security，全量才红）；module-root 改写（0.2.20）同理漏了
   tests/integration——两处都在守卫网之外腐烂。教训：**翻转类设计文档的
   任务清单应显式列「同步钉死旧契约的测试」**，尤其 guard 网之外的目录。
2. 提交时 `pnpm lint | tail` 又一次让管道尾命令吞掉退出码，合并已完成后
   才补验（结果净）。纪律：判定类命令一律重定向到文件再看 exit。

## 总结

本阶段把全量测试的 4 个红从「钉死已翻转旧契约」改为新契约断言：
publishConfig.registry 反转为必须缺席（防回流）+ 发版脚本 --registry 钉死
npmjs 承接锁定；uni-dev-smoke 三路径改 module-root 口径；.tmp-fx/ 入
gitignore 消除脏树卡发布 checkCleanTree 与运行中夹具被 git clean/stash
删除的隐患（vditor UNRESOLVED_ENTRY 偶发的可确认成因面）。全量 121 文件
821 测试全绿。关键过程：用户报守卫套件 vditor 偶发 → 三语境未能复现 →
全量跑露出 4 个真红 → 定位两宗 stale 契约 + 一宗 ignore 缺漏 → 修复后
全量转绿。耗时约 15 分钟。vditor 偶发本体无根因级修复，若再现在已 ignore
的语境下仍有防护盲区（如 -fx 级 clean）。
