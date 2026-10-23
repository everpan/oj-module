# publish-verdaccio：模拟发布脚本固化（供下次人工发布到本地）

- 日期：2026-10-23 14:44
- 分支：feat/publish-verdaccio-script（已删，--no-ff 合入 feat/ojm）
- 状态：已完成（2026-10-23 14:50）

## 需求

2026-10-23 演练「模拟发布 verdaccio」时是手工拼的：publish-packages.mjs
--dry-run（1-3 步）+ 手动 `pnpm publish` 两包（靠 .npmrc scope 映射或显式
--registry）。用户要求固化成 `scripts/` 脚本，**供下次人工发布到本地**。

## 方案

`scripts/publish-verdaccio.mjs`：与 publish-packages.mjs 同构的五步流程，
差异只有三处——目标 registry 显式钉 `http://127.0.0.1:4873`（可用
`VERDACCIO_REGISTRY` 覆盖）、无 2FA 交互、复核改查本地（无 CDN 延迟、
秒级）。已发布版本自动跳过（可安全重跑）。旗标：--publish / --dry-run /
--skip-tests / --help；裸跑与未知参数 fail-fast（同主脚本的守卫口径）。

- 头部注释加指针：publish-packages.mjs 的 USAGE 提一句模拟发布走本脚本。
- 测试：tests/cli/publish-verdaccio-usage.test.ts 复用 publish-script-usage
  的探针骨架（--help / 未知参数 / 互斥 / 目标 registry 声明），不跑真发布。

## 任务

- [x] RED：usage 守卫测试（4 红基线）
- [x] 实现 scripts/publish-verdaccio.mjs
- [x] 实测：--publish（两包已在 verdaccio → 走自动跳过路径 + 复核双绿，exit=0）
- [x] 主脚本 USAGE 指针 + 相关测试（12/12）+ lint
- [x] 合入 feat/ojm（--no-ff）删分支，更新本文档

## 问题记录

1. **隐式发布目标被拦的教训固化**：初版演练靠 `.npmrc` 的 `@oj-module:registry`
   映射隐式定目标，被 auto 分类器拦下（映射缺席时会回落公网）。脚本因此把
   `--registry http://127.0.0.1:4873` 写成显式默认（`VERDACCIO_REGISTRY` 可覆盖），
   并写进 USAGE 与头部注释——这是本脚本相对「手动 pnpm publish」的最大价值。
2. **TDZ 实锤**：第一版把 `--help` 分支放在 `const USAGE` 声明之前，引用即
   ReferenceError——帮助入口测试（--help 退出 0）当场抓住。const 不提升，守卫
   代码与文本定义的相对顺序必须「定义在前」。

## 总结

把 2026-10-23 演练时的手工模拟发布（dry-run + 手动 pnpm publish ×2）固化为
`scripts/publish-verdaccio.mjs`：与 publish-packages.mjs 同构五步，差异三处（目标
显式钉本地可覆盖、无 2FA、复核秒级）。实测 --publish 走「已发布自动跳过」路径 +
本地复核双绿，exit=0；守卫测试 12/12（主脚本 usage 断言未受影响）。--help 分支
TDZ 被 RED 测试当场抓住是本轮唯一的实现返工点。耗时约 8 分钟。
