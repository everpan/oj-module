# 市场远程发布 deferred minors 清理计划

> 承接 `20261106-1904-market-remote-publish.md` 全分支终审的 6 项 minor（deferred）。
> 每项 TDD（RED→GREEN），分支 `feat/market-minors-cleanup`，完成后并回 `feat/ojm`。

## 清单（终审原始结论 → 处置）

1. **首发所有权竞态在 db.tx 外**（cdn/api.ts：预检 select 与 insert 之间并发双绑首版）→ 把所有权复核移入 `db.tx` 写事务内（SQLite 单写者序列化，事务内重读即仲裁）。
2. **backfill 新行 insert 无唯一键仲裁**（撞键 500 中断全量扫描）→ insert 失败重读：同内容 → unchanged；异内容 → skipped 记 reason，扫描继续。
3. **同旁车幂等重推无审计 + 死代码 `void sig; void keyId;`**（cdn/api.ts sigUploadBody）→ 删除死代码；幂等重推补一条 success 审计（发布留痕口径统一：成败俱记）。
4. **db.tx catch 原样上抛，SQL 错误文本泄进 500 信封**（cdn/api.ts tgzUploadBody catch）→ 仲裁失败后不 rethrow 原错，改 `fail(500, 人话)`（SQL 文本只进审计 message）。
5. **remote-push.ts:108 死三元**（两侧同值）→ 删三元，直取 `res.status`。
6. **catalog indexBody 逐行串行 `lastInstallOperatorOf`**（每页 ≤size 次串行查询）→ 改一次 `op:"in"` 批量查 + JS 归并（首行即最新，因 created_at/rowid 倒序）。

## BDD 用例（新增，全 RED→GREEN）

- **M1 竞态仲裁**：given 预检通过后在 db.tx 内他方并发插入同 product 异 key 行，when tgz 推送写事务，则 409 所有权（事务内复核拦截）。
- **M2 回填撞键不中断**：given 扫描期间他方并发上传同版本异字节，when 回填 insert 撞唯一键，则 该文件进 skipped（reason 含冲突）、其余文件照常落库、响应 200。
- **M3 幂等重推留痕**：given 已配对发布，when 同字节 .sig 重推，则 200 幂等且 market_history 多一条 publish/success（message 含「幂等」）。
- **M4 错误不泄露**：given db.tx 抛底层 SQL 错误（非业务 fail），when 上传处理，则 500 信封 message 为固定人话、不含 SQL 文本；审计 message 保留细节。
- **M5**：行为不变，remote-push 既有 638 套件全绿即证。
- **M6 批量 operator**：given 一页多产品，when index 渲染，则 每产品 operator 与逐行口径一致（既有断言守 + 多产品用例补）。

## 验收

- templates 套件全绿；`packages/cli` 套件全绿；双侧 tsc 零错。
- 合并 `feat/ojm`（--no-ff），删特性分支，更新本文件任务状态 + 总结。
