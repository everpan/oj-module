# 真实发布被 ~/.npmrc scope 映射劫走：发布步工程级 .npmrc 临时钉死

- 日期：2026-10-23 15:31
- 分支：fix/publish-scope-registry-pin（已删，--no-ff 合入 feat/ojm）
- 状态：已完成（2026-10-23 15:37）

## 需求（用户实报）

真实发布 `node scripts/publish-packages.mjs --publish --web-2fa` 时，明明显式
带了 `--registry https://registry.npmjs.org`，runtime 包却被发到
`http://localhost:4873/`（本地 verdaccio，409 Conflict——0.2.25 白天模拟发布过）。

## 根因（20261023-1027 设计文档的优先级链记错了）

实锤（npm/pnpm 双验）：`--registry` 只是设置 `registry` 键，而 **`@oj-module:registry`
作用域映射对 scoped 包的优先级高于它**（npm 官方口径同样是
`publishConfig.registry > @scope:registry > registry`）。本机 `~/.npmrc` 的
`@oj-module:registry=http://localhost:4873/`（verdaccio 模拟用）把真实发布劫到本地。
2026-10-23 上午「npm view --registry npmjs 仍查 verdaccio」已是同一征兆，当时误判为
「核验手法问题」，实为优先级链认知错误。

## 方案（实证过的最小修复）

- pnpm 不接受 `--@oj-module:registry=` CLI 覆盖（`unexpected argument`），npm 接受但
  发布必须用 pnpm（workspace:* 依赖改写只有 pnpm 做）。
- **包目录级 `.npmrc` 不生效**（实测）；**工程根 `.npmrc` 追加 scope 行生效**（工程级 >
  用户级，实测 pnpm 随即查 npmjs）。且 `.npmrc` 在 npm/pnpm 默认 pack 忽略表里，不会进包。
- 修复：两脚本（publish-packages / publish-verdaccio）发布步在**工程根 .npmrc**
  临时追加 `@oj-module:registry=<目标>`，finally 复原（读原文→追加→发布→写回原文）。
  这同时让 verdaccio 脚本的「显式钉本地」承诺在用户映射指向别处时仍然成立。

## 测试用例（TDD）

- 改 publish-script-usage.test.ts 的 USAGE 断言（旧文案「--registry 显式钉死官方源，
  不受 .npmrc 作用域映射影响」即错误本身）+ 新增断言：脚本源码含 `@oj-module:registry=`
  （scope 钉死行）。
- 新增行为级测试：`withPinnedScopeRegistry` 的 复原语义（异常后也复原）——导出不便，
  以「脚本源码钉守 + 手动实测」覆盖（行为函数在 mjs 顶层不导出；过度设计导出钩子不值）。

## 任务

- [x] RED：usage 测试改断言（旧文案失效）+ supply-chain 效果级断言（2 红基线）
- [x] 实现：publish-packages.mjs 工程级 .npmrc 临时钉死 + 注释/头注/USAGE 勘误
- [x] 同步：publish-verdaccio.mjs 同机制（REGISTRY=本地）+ 头注/USAGE 勘误
- [x] 设计文档 20261023-1027-publish-registry-pinning 追加勘误段
- [x] 机制实测（追加/复原字节一致、git 无痕迹）+ 守卫套件 + lint 全绿
- [x] 合入 feat/ojm 删分支，更新本文档

## 问题记录

1. **设计文档翻转又把测试钉在错误契约上**：supply-chain 测试只断言「脚本含
   --registry npmjs」，没断言「scope 映射被压过」，错误的优先级认知因此无警报穿过
   守卫网。教训重复（同 10-23 上午 stale 契约课）：**断言要钉「效果」不是「手段」**。
2. npm 与 pnpm 对 `--@scope:registry` CLI 的支持不一致（npm 收、pnpm 拒）——跨工具
   配置键优先级必须实测，不能按「常理」推。
3. 勘误对象文档的问题记录 2 曾把「--registry 压过映射」记为实证——实为当时的
   验证只覆盖了「裸发→映射→verdaccio」方向，「--registry→npmjs」方向从未在
   映射存在时实测过。**「单向实证」被记录成「双向结论」是本事故的文献级根因**。

## 总结

根因：`@scope:registry` 作用域映射优先级**高于** `--registry`（npm 官方口径
`publishConfig > @scope:registry > registry`），本机 `~/.npmrc` 的 verdaccio 映射把
真实发布劫到 localhost 409。修复 = 两发布脚本发布步在工程根 .npmrc 临时追加
`@oj-module:registry=<目标>` 行、finally 复原（工程级 > 用户级；pnpm 实测唯一有效
手段：CLI scope 覆盖被拒、包目录 .npmrc 不生效）。机制实测复原字节一致，守卫套件 +
lint 全绿，--no-ff 合入 feat/ojm。耗时约 10 分钟。用户动作：修复后重跑
`node scripts/publish-packages.mjs --publish --web-2fa`（真实发布仍归用户手动）。
