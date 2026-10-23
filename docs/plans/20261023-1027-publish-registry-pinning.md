# 发布目标改由命令行 --registry 钉死（移除 publishConfig.registry）

- 日期：2026-10-23 10:27
- 分支：refactor/publish-registry-pinning
- 状态：已完成（2026-10-23 10:40）

## 需求

`publishConfig.registry` 导致每次模拟发布到 verdaccio 都要「改 package.json → 发布 → 复原」（且 `--registry` 命令行压不过它）。改为：

- **移除**两包 `publishConfig.registry` 字段（保留 `access: "public"`——scoped 包缺省 restricted，必须留）；
- **真实发版脚本** `scripts/publish-packages.mjs` 的 publishArgs 显式加 `--registry https://registry.npmjs.org`——命令行 flag 优先于 `.npmrc` 作用域映射，发版钉死 npmjs；
- **模拟发布**直接 `pnpm -C packages/<pkg> publish`（不带 flag）→ 由 `@oj-module:registry=localhost:4873` 作用域映射落到 verdaccio——零文件改动。

## 背景与依据

- 优先级链（2026-10-23 模拟发布实证）：`publishConfig.registry > --registry flag > @scope:registry 映射 > registry 缺省`。
- 发版脚本 `publishPkg` 原本不传 `--registry`，全靠 publishConfig.registry 钉 npmjs；这台机器此后给 `~/.npmrc` 加了 verdaccio 作用域映射，若只删 publishConfig 不改脚本，真实发版会把包发到 verdaccio 而第 5 步复核仍查 npmjs——必须脚本显式 `--registry`。
- 脚本测试 `tests/cli/publish-script-usage.test.ts` 只断言 USAGE 文本包含项，加 flag 安全。

## 任务

- [x] 建分支 refactor/publish-registry-pinning
- [x] TDD：publish-script-usage.test.ts 增加「USAGE 声明 --registry 钉死官方源」断言（先红）
- [x] 移除两包 publishConfig.registry；脚本 publishArgs 加 --registry + 注释/表述更新
- [x] 全量测试 + lint + typecheck 全绿（cli 409 + 根 tests/cli 379 通过）
- [x] 端到端实证：verdaccio 卸载 0.2.24 → 裸 `pnpm publish`（不带 flag、无 publishConfig）重发成功 → 空目录安装 0.2.24 验证
- [x] 更新本文档状态与总结

## 问题记录

1. **发版脚本原本依赖 publishConfig.registry 钉 npmjs**（publishPkg 不传 --registry）：这台机器此后给 `~/.npmrc` 加了 verdaccio 作用域映射，只删 publishConfig 不改脚本会让真实发版把包发到 verdaccio、第 5 步复核却查 npmjs。故必须「移除字段 + 脚本显式 --registry」成对落地。
2. 优先级链实证（本期再次验证）：无 publishConfig.registry 时，裸 `pnpm publish` 按 `@oj-module:registry` 映射落 verdaccio；带 `--registry npmjs` 则落 npmjs（命令行压过映射）。

## 总结

本阶段移除两包 `publishConfig.registry`（保留 `access: public`），发布目标改由命令行钉死：真实发版脚本 `publish-packages.mjs` 的 publishArgs 显式 `--registry https://registry.npmjs.org`，模拟发布裸 `pnpm publish` 走 `.npmrc` 作用域映射落 verdaccio——两种场景均零 package.json 改动。关键过程：红测试（USAGE 须声明钉死语义）→ 三处编辑 → 端到端实证（卸载 0.2.24 → 裸发成功 → 空目录装回 0.2.24）。耗时约 15 分钟。
