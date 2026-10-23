# market trial/walkthrough 隔离站点起站路径写死 api/dist（module-root 下必挂）

- 日期：2026-10-23 12:20
- 分支：fix/market-trial-api-dist-path
- 状态：已完成（2026-10-23 12:30）

## 需求

`ojm market trial` / `ojm market walkthrough` 在 module-root 工程里起隔离站点时，
oj serve 的 api 路径必须是构建产物实际位置 `<root>/dist/api`，而非历史平铺布局的
`<root>/api/dist`。

## 根因（2026-10-23 市场链路演练实证）

`market/bootstrap.ts` 第 7b 步把 `path.join(root, "api", "dist")` 传给 starter，
而同文件 7) 步 `buildBackend(root)` 产物落在 `<root>/dist/api`（layout.ts
module-root 口径 apiDist；第 150 行 platform.root 改写已用 resolveLayout 取值）——
起站即 `mounts[2]: 挂载目录 <root>/api/dist: No such file or directory` 退出。
walkthrough/trial 的 starter 注入缝（bootstrap.test.ts fakeStarter）可断言该路径。

## 方案

starter 第三参改用与 platform.root 同源的 `resolveLayout(root).apiDist`
（第 150 行已有同款取值，抽变量复用）。

## 测试用例（BDD，TDD 先红）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 起站路径 | `bootstrapIsolatedSite({ projectRoot, starter: fake })` | 捕获 starter 第三参 | = `<隔离根>/dist/api`（非 `api/dist`） |

## 任务

- [x] 建分支 fix/market-trial-api-dist-path
- [x] TDD：bootstrap.test.ts 红断言
- [x] 修 bootstrap.ts starter 路径
- [x] cli 测试全绿 + lint
- [x] 合入 feat/ojm（--no-ff）删分支
- [x] 更新本文档状态与总结

## 问题记录

1. bootstrap 内两处「api 产物根」取值本应同源，却一处用 resolveLayout（platform.root，
   0.2.20 改过）一处写死 `api/dist`（第 7b 步）——同源数据两处表达是经典漂移面。
2. fakeStarter 测试里 `oj build` 不落 manifests.yaml（构建编排被桩掉），断言须只锚
   starter 入参，不锚副产物存在性。

## 总结

本阶段把 trial/walkthrough 隔离站点的 oj serve --api-path 从写死的 `api/dist`
（历史平布局）改为 `resolveLayout(root).apiDist`（与 platform.root 改写同源），
module-root 工程起站即 `mounts: No such file or directory` 的故障消除。关键过程：
演练 walkthrough 起站失败 → 定位第 7b 步写死路径 → fakeStarter 红断言 → 412 全绿。
耗时约 12 分钟。
