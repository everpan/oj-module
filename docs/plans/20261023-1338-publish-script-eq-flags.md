# publish-packages.mjs 拒收 --otp=/--tag= 等号形式（误判未知参数）

- 日期：2026-10-23 13:38
- 分支：fix/publish-script-eq-flags
- 状态：已完成（2026-10-23 13:42）

## 需求

`node scripts/publish-packages.mjs --publish --otp=123456`（pnpm/npm 惯用的
等号形式）被「✗ 未知参数：--otp=123456」拦截。值旗标须同时接受
`--otp 123456` 与 `--otp=123456` 两种形式。

## 根因

`opt()` 只按空格分隔查 `args.indexOf("--otp")`；`unknownArgs` 过滤器只认
精确匹配 KNOWN_OPTS，`--otp=123456` 以 `-` 开头又不在集合里 → 误判未知。
cac/npm 生态里等号形式是用户自然输入，fail-fast 文案把它导向「拼写错误」
口径，极具迷惑性。

## 方案

- `opt(name)`：先查 `--name=` 前缀（slice 取值），回落空格分隔。
- `unknownArgs`：KNOWN_OPTS 命中条件扩展为精确匹配或以 `=` 前缀匹配。
- 空值 `--otp=`：按未给处理（falsy → 交互索取），不新增校验。

## 测试用例（BDD，TDD 先红）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| otp 等号形式 | `--publish --dry-run --otp=123456` | 跑参数守卫 | 不被「未知参数」拦截（落到 --publish/--dry-run 互斥 fail-fast， stderr 含「互斥」） |
| tag 等号形式 | `--publish --dry-run --tag=beta` | 同上 | 同上 |
| 未知等号参数仍拦截 | `--dryrun=x` | 跑参数守卫 | 仍「未知参数」fail-fast |

## 任务

- [x] 建分支 fix/publish-script-eq-flags
- [x] TDD：publish-script-usage.test.ts 红断言
- [x] 修 opt() 与 unknownArgs
- [x] 测试全绿 + lint
- [x] 合入 feat/ojm（--no-ff）删分支
- [x] 更新本文档状态与总结

## 问题记录

1. 用户报错原文未随消息带出（"fix … error:" 后为空）——靠复现定位：`--dry-run`
   全绿，唯一可复现的错误面是值旗标等号形式被守卫拦截。修复前建议用户侧
   保留原始报错以核对是否同一问题。

## 总结

本阶段让 publish 脚本的值旗标（--otp/--tag）同时接受空格与等号两种形式：
opt() 增 `--name=` 前缀分支，unknownArgs 白名单对 KNOWN_OPTS 增等号前缀
匹配；`--dryrun=x` 之类真未知等号参数仍被拦截（有测试钉死）。关键过程：
复现「未知参数：--otp=123456」→ 守卫测试加互斥探针红断言（等号形式须
走到互斥 fail-fast 而非未知参数）→ opt/守卫两处最小修改 → 8 测试全绿。
耗时约 5 分钟。
