# 市场远程发布 deferred minors 清理计划

> 承接 `20261106-1904-market-remote-publish.md` 全分支终审的 6 项 minor（deferred）。
> 每项 TDD（RED→GREEN），分支 `feat/market-minors-cleanup`，完成后并回 `feat/ojm`。

## 任务清单（全部完成，2026-11-07 05:09–05:23）

- [x] M1 首发所有权移入 db.tx 写事务复核（预检保留作 fast-path；事务内重读仲裁并发窗口）
- [x] M2 回填 insert 撞唯一键仲裁（同字节 → unchanged；异字节 → skipped 记冲突；非撞键底层错误原样上抛）
- [x] M3 旁车幂等重推补 success 审计（message 含「幂等」）+ 摘除死代码 `void sig; void keyId;`
- [x] M4 db.tx catch 不原样上抛——底层错误 500 固定人话（SQL 文本只进审计 message）；tx 内业务 409 原样重抛
- [x] M5 remote-push.ts:108 死三元摘除（纯等价改写）
- [x] M6 catalog operator 一次 `op:"in"` 批量查询（倒序首行即最新）替代逐行串行

## 总结

关键过程：6 项 minor 一项一分支提交（6 commits），全部 TDD——M1/M4 同改 `tgzUploadBody` 的
tx/catch 块（测试以 `g.db.tx`/`g.db.table` 代理注入竞态与故障），M2 以 Proxy 拦截 insert
模拟「select 与写入之间他方落行」；M3/M5 为轻量修补；M6 先加多产品 parity 用例（串行口径
下通过 = 表征测试）再改批量。教训一条：mock `db.table` 不可用对象 spread（原型方法丢失，
报 `select is not a function`），须用 Proxy 转发。

终态验证：templates 1129/1129（+7）、cli 638+1 skip、根套件 939+1 skip、双侧 tsc 零错。
耗时约 15 分钟（05:09–05:23）。

遗留口径（ruling）：M4 的 500 人话不携带任何错误细节（细节全在 market_history 审计行）；
M2 异字节冲突不回填改写他方行——重跑对账即可，冲突 reason 已明示。
