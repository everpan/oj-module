# 方案归属者免 superadmin 装/卸 + oj-market 0.2.8 计划（2026-11-22 11:55）

## 背景

市场写面（install/uninstall/task/enable 等）目前 `assertSuperAdmin` 独占（R9）。产品口径要放开：
**方案清单中，属于当前用户的方案，当前用户可自行安装/卸载，不需要 superadmin**。

现状关键事实（code 证据）：

- 归属信号唯一可靠来源 = `market_release.key_id`（发布签名 key，`<publisher>.<key>`，
  `migrations/0002`；yank 端点已用它做「仅发布者本人」判定的先例 `api.ts:957-961`）
- 平台**不存在** user ↔ publisher key 绑定——需要新建（绑定必须持钥自证，否则任何人可抢注他人 key_id）
- 前端门 = `MarketApp.tsx:24 canManage = roles.includes("superadmin")`，平权下放到卡片

## 目标（SMART）

1. 新共享表 `market_owner_key(user_id, key_id UNIQUE, public_key, created_at)`：一把 key
   全站一个属主；绑定须 Ed25519 持钥自证（canonical `market-owner-key:<registryId>:<keyId>`
   与 yank 同范式）；本人可解绑，superadmin 可解绑他人。
2. 授权助手 `assertSolutionOperator(name)`：superadmin 恒过；否则 `market_release` 中该
   product 任一行 `key_id` 绑定属于当前用户 → 过。接入 install / install/cancel / task /
   uninstall。enable（启停）**不动**，仍 superadmin（明确非目标）。
3. 方案清单行加 `mine: boolean`（latest 行 publisher_key 属于我的绑定），前端按行放开
   安装/卸载/回滚按钮（启停按钮仍 superadmin）。
4. CLI 新动词 `ojm market bind-key --id <publisher.key> --key <priv.pem>`：站点登录（任意
   有效账号，与 install 同 site.ts 面）+ 签名头推送绑定。
5. oj-market 版本推进 0.2.7 → 0.2.8（4 文件清单纪律）。

## BDD 用例（TDD 锚）

```gherkin
功能: 方案归属者免 superadmin 安装/卸载
  背景: 站点有方案 acme（market_release.key_id = "alice.main"）与 demo（key_id = "bob.x"）；
        用户 alice 已绑定 "alice.main"，用户 carol 未绑定任何 key

  场景: 归属矩阵（install/uninstall 同口径）
    | 用户    | 操作 acme | 操作 demo |
    | superadmin | 200   | 200   |
    | alice（属主）| 200 | 403   |
    | carol（未绑定）| 403 | 403   |
    且 403 文案点名「方案归属者或 superadmin」

  场景: file 源安装无目录行
    当 carol（乃至 alice）以 file 源安装一个 market_release 中不存在的方案
    那么 403——目录行是归属判定的唯一依据，无行即无归属

  场景: task 轮询按任务归属判权
    当 alice 轮询自己触发的安装任务 → 200
    当 carol 轮询 alice 的任务 → 403（按 rec.name 归属判定）

  场景: enable 启停仍 superadmin 独占（回归钉）
    当 alice 对已归属方案 POST /enable
    那么 403（本特性不放开启停）

  场景: 绑定持钥自证
    当 登录用户提交 key_id + public_key + canonical 签名 → 绑定成功
    当 签名与 public_key 不匹配 → 401
    当 key_id 已被他人绑定 → 409
    当 重复自绑（本人）→ 幂等 200
    当 未登录 → 401

  场景: 解绑
    当 本人解绑自己的 key → 200；当 他人解绑 → 403；superadmin 解绑任意 → 200

  场景: 方案清单 mine 标记
    当 alice 拉取 /index
    那么 acme 行 mine=true，demo 行 mine=false；carol 全 false；未登录 401（既有）

  场景: 前端按钮按行放开
    当 alice 打开市场页
    那么 acme 卡片装/卸/回滚可用、启停不可用；demo 卡片全禁
```

## 任务（INVEST 切分）

- [ ] T1 版本推进 oj-market 0.2.7→0.2.8：solution.yaml（version/archive.file/web.entry/changelog
      行）+ api/manifest.yaml + web/entry.ts
- [ ] T2 迁移 `0011__market_owner_key.{sql,mysql.sql,pg.sql}` + `_platform/schema.yaml` 登记
      （tenant: false，与 market_release 同口径：key 属主是站点级事实）
- [ ] T3 api.ts：bind/unbind 端点 + `assertSolutionOperator` + install/install.cancel/task/
      uninstall 换闸 + index 行 mine
- [ ] T4 api 测试：归属矩阵/file 源/task 按名/bind 自证/解绑/mine 标记（Vitest 直调 handler，
      沿用既有 oj-market api 测试范式）
- [ ] T5 CLI `ojm market bind-key`（site.ts 登录 + signCanonical 签名推送）+ 单测
- [ ] T6 web：IndexRow.mine + CardItem/CardGrid/DetailDrawer 按行放开（canManage 平权 +
      canOperate=canManage||row.mine，启停仍 canManage）
- [ ] T7 门禁（templates 生命周期/oj-market 测试 + cli 单测 + typecheck + lint）→ merge
      --no-ff 回 feat/ojm → 更新本文档状态与总结

## 风险与备注

- 绑定表共享（tenant: false）而非随租户：key 属主是站点级事实，与 market_release 同口径；
  user_id 存 users.id（租户内序号）——跨租户同 id 理论碰撞由「登录态所在租户决定可见归属」
  兜住，accept 为已知限制并记入文档。
- yank 的属主判定用的是**请求签名 key**（无账号态），本特性是**账号态 + 预绑定**——两条
  属主链并存不冲突：yank 管目录下线，本特性管装/卸。
- file 源安装不产生 market_release 行 → 非 superadmin 永远 403，是有意设计（归属无法判定）。
- `ojm uninstall` CLI 瘦客户端同走 /uninstall 端点，服务端换闸后自动获得归属放行。
