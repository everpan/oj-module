# market trial/walkthrough setup 后登录口令恒用 newPass（must_change=0 时 401）

- 日期：2026-10-23 12:23
- 分支：fix/market-trial-login-pass
- 状态：已完成（2026-10-23 12:26）

## 需求

`ojm market trial` 与 `ojm market walkthrough` 在 setup 之后登录隔离站点时，
必须使用 setup 实际改密与否所对应的口令：改了密才用 newPass，没改（种子
must_change=0）必须用种子原口令。当前两处都无条件用 newPass → 401。

## 根因（2026-10-23 市场链路演练实证）

`setupMarketUrl` 只在账号处于 must_change 悬挂期才走改密闭环，并返回
`changedPassword` 标记（setup.ts:34、91）。模板 seed 自 3d93063f 起
must_change=0（账号名=角色名口径收敛），改密不再发生；而
walkthrough.ts:377-378 与 trial.ts:56-64 无视该标记，setup 后一律
`login(..., newPass)` → `POST /api/auth/login 401 invalid credentials`。

## 方案

在 setup.ts 出口加一行助手（与 SetupResult 同文件，测试可达）：

```ts
export function loginPasswordAfterSetup(result: SetupResult, newPass: string, originalPass: string): string {
	return result.changedPassword ? newPass : originalPass;
}
```

两个调用点改为：`const setup = await setupMarketUrl(...)`，
`login(..., loginPasswordAfterSetup(setup, newPass, site.admin.pass))`。

## 测试用例（BDD，TDD 先红）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 改密已发生 | SetupResult{ changedPassword: true } | 取登录口令 | = newPass |
| 未改密（当前 seed 常态） | SetupResult{ changedPassword: false } | 取登录口令 | = 原种子口令 |

## 任务

- [x] 建分支 fix/market-trial-login-pass
- [x] TDD：setup.test.ts 红断言
- [x] 助手 + 两处调用点改造
- [x] cli 测试全绿 + lint
- [x] 合入 feat/ojm（--no-ff）删分支
- [x] 更新本文档状态与总结

## 问题记录

1. 同一根因两个调用点（trial.ts 与 walkthrough.ts）——两处都无条件用 newPass，
   修一处漏一处是经典漂移面；助手收口后调用点无分支逻辑。
2. trial.ts:54 注释「首登必然处于改密悬挂期」与当前 seed 口径（must_change=0）
   已不符，但描述的是设计意图，随本次修复行为对齐而重新成立（setup 内部判定），
   注释保留。

## 总结

本阶段把 trial/walkthrough setup 后的登录口令从恒用 newPass 改为按
`changedPassword` 二选一（setup.ts 新增一行助手 `loginPasswordAfterSetup`，
两调用点各改一行），must_change=0 种子下的 401 消除。关键过程：
walkthrough 演练 401 → setup.ts 的 changedPassword 返回字段定位根因 →
setup.test.ts 红断言 → 助手 + 两调用点 → cli 414 全绿 + lint 净。耗时约 5 分钟。
