# ojm new 骨架 solution.yaml 缺 peerRuntime/archive，自家 market verify 验包必挂

- 日期：2026-10-23 11:55
- 分支：fix/ojm-new-solution-manifest-fields
- 状态：已完成（2026-10-23 12:00）

## 需求

`ojm new` 生成的 solution.yaml 骨架打包发布后，`ojm market verify` 的
「manifest 结构」项必挂（缺必填字段 peerRuntime, archive）——自家脚手架产物
过不了自家市场验包门禁。骨架须「生成即可发布」。

## 根因（2026-10-23 市场链路演练实证）

`market/verify.ts` structureCheck 要求 manifest 五必填：name/version/summary/
peerRuntime/archive（发布门禁口径，严于契约 C2-29「archive 可整体省略」的 Form A
定义——verify 是站点侧消费面，按 Form B 齐备度要求）。而 `new.ts` 的
solutionYaml 模板只产出 name/version/title/summary/changelog/api/web。
打包时 manifest.yaml 原样透传 solution.yaml，故必挂。

演练侧已实证补救组合可过五项全 ✓：

```yaml
peerRuntime: ">=0.0.0"
archive:
  file: <name>-0.1.0.tgz
```

（C2-29：tgz 内 archive 仅允许 file 键，值为包文件名。）

## 方案

solutionYaml 模板补两段，与 web entry 骨架已有的 peerRuntime 缺省值
（new.ts `peerRuntime: ">=0.0.0"`）口径一致。

## 测试用例（BDD，TDD 先红）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 骨架可发布 | `createSolution(root, "crm", { api: true })` | 读 `src/crm/solution.yaml` 解析 | 含 `peerRuntime: ">=0.0.0"` 与 `archive.file: crm-0.1.0.tgz` |

## 任务

- [x] 建分支 fix/ojm-new-solution-manifest-fields
- [x] TDD：红测试
- [x] 修 solutionYaml 模板
- [x] cli 测试全绿 + lint
- [x] 合入 feat/ojm（--no-ff）删分支
- [x] 更新本文档状态与总结

## 问题记录

1. market verify 的发布门禁（五必填含 archive）严于契约 C2-29（Form A 可省略 archive）——
   同一字段两套口径：契约管「包能不能打」，verify 管「源能不能上架」。骨架按严口径生成
   两头都过，不试图统一口径（站点消费面有理由更严）。
2. `yaml` 包无 `yamlParse` 命名导出（verify.ts 里是 `parse as yamlParse`），测试里动态
   import 时踩了一次。

## 总结

本阶段给 ojm new 的 solution.yaml 骨架补 `peerRuntime: ">=0.0.0"` 与
`archive.file: <name>-0.1.0.tgz`，脚手架产物从此过自家 market verify 五必填。
关键过程：演练侧先手工补字段实证「五项全 ✓」→ 红测试 → 模板修复 → cli 411 全绿。
与 1144 期（ping handler 零路由）同为「ojm new 骨架不可直接用」族缺陷。耗时约 8 分钟。
