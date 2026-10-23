# market trial/walkthrough 隔离站点种子管理员账号过期（admin → superadmin）

- 日期：2026-10-23 12:45
- 分支：fix/market-trial-seed-admin
- 状态：已完成（2026-10-23 12:50）

## 需求

`market bootstrap` 的隔离库种子管理员必须与模板 seed 的账号名=角色名口径一致：
superadmin 角色账号名为 `superadmin`（`admin` 自 3d93063f 起被幂等解绑），
否则 walkthrough 的 setup 段写 `framework.market_cdn_url` 被
`security settings require superadmin`（403）拒。

## 根因（2026-10-23 市场链路演练实证）

模板 `_platform/api/seed.sql` 现幂等执行
`DELETE FROM sys_user_role WHERE role_name='superadmin' AND user_id=(admin)`；
而 `market/bootstrap.ts` `SEED_ADMIN_USER = "admin"`——登录 200（账号存在），
写安全设置 403（无 superadmin 角色）。0.2.13 时代 walkthrough 全 PASS，
3d93063f（seed 角色账号收敛）后失效，上轮 §7.5 基线未复跑 §7.4 故潜伏。

## 方案

`SEED_ADMIN_USER = "superadmin"`（口令 123456 不变）。单点；setup.test.ts 的
"admin" 是 mock fetch 的入参占位，与种子无关，不动。

## 测试用例（BDD，TDD 先红）

| 场景 | 给定 | 当 | 那么 |
| --- | --- | --- | --- |
| 种子管理员 | `bootstrapIsolatedSite` | 读 `site.admin.user` | = `superadmin`（非 `admin`） |

## 任务

- [x] 建分支 fix/market-trial-seed-admin
- [x] TDD：bootstrap.test.ts 红断言
- [x] 改 SEED_ADMIN_USER
- [x] cli 测试全绿 + lint
- [x] 合入 feat/ojm（--no-ff）删分支
- [x] 更新本文档状态与总结

## 问题记录

1. 账号语义漂移的检测面：登录 200 + 写操作 403 的组合意味着「账号存在但角色不对」，
   比登录失败难排查——演练手册 §7.4 检查点可留意此形状。

## 总结

SEED_ADMIN_USER 由 "admin" 改为 "superadmin"，与模板 seed 账号名=角色名口径对齐，
walkthrough setup 段 403 消除。关键过程：walkthrough setup 403 → seed.sql 解绑语句
定位口径变化 → 单点修复 + 红断言 → cli 413 全绿。耗时约 6 分钟。
