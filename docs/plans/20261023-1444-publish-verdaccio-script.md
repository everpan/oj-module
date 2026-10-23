# publish-verdaccio：模拟发布脚本固化（供下次人工发布到本地）

- 日期：2026-10-23 14:44
- 分支：feat/publish-verdaccio-script
- 状态：进行中

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

- [ ] RED：usage 守卫测试
- [ ] 实现 scripts/publish-verdaccio.mjs
- [ ] 实测：--publish（两包已在 verdaccio → 走自动跳过路径，验证幂等）
- [ ] 主脚本 USAGE 指针 + 全量相关测试 + lint
- [ ] 合入 feat/ojm（--no-ff）删分支，更新本文档

## 问题记录

（暂无）

## 总结

（待收尾填写）
