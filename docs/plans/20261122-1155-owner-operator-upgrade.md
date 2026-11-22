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

- [x] T1 版本推进 oj-market 0.2.7→0.2.8：solution.yaml（version/archive.file/web.entry/changelog
      行）+ api/manifest.yaml + web/entry.ts
- [x] T2 迁移 `0011__market_owner_key.{sql,mysql.sql,pg.sql}` + `_platform/schema.yaml` 登记
      （tenant: false，与 market_release 同口径：key 属主是站点级事实）
- [x] T3 api.ts：bind/unbind 端点 + `assertSolutionOperator` + install/install.cancel/task/
      uninstall 换闸 + index 行 mine
- [x] T4 api 测试：归属矩阵/file 源/task 按名/bind 自证/解绑/mine 标记（Vitest 直调 handler，
      沿用既有 oj-market api 测试范式）
- [x] T5 CLI `ojm market bind-key`（site.ts 登录 + signCanonical 签名推送）+ 单测
- [x] T6 web：IndexRow.mine + CardItem/CardGrid/DetailDrawer 按行放开（canManage 平权 +
      canOperate=canManage||row.mine，启停仍 canManage）
- [x] T7 门禁（templates 生命周期/oj-market 测试 + cli 单测 + typecheck + lint）→ merge
      --no-ff 回 feat/ojm → 更新本文档状态与总结

## 风险与备注

- 绑定表共享（tenant: false）而非随租户：key 属主是站点级事实，与 market_release 同口径；
  user_id 存 users.id（租户内序号）——跨租户同 id 理论碰撞由「登录态所在租户决定可见归属」
  兜住，accept 为已知限制并记入文档。
- yank 的属主判定用的是**请求签名 key**（无账号态），本特性是**账号态 + 预绑定**——两条
  属主链并存不冲突：yank 管目录下线，本特性管装/卸。
- file 源安装不产生 market_release 行 → 非 superadmin 永远 403，是有意设计（归属无法判定）。
- `ojm uninstall` CLI 瘦客户端同走 /uninstall 端点，服务端换闸后自动获得归属放行。

## 总结（2026-11-22 回填）

- **关键过程**：
  - T1-T5 按计划推进（版本推进 → 0011 迁移三方言 + schema/manifest 双登记 → api.ts
    判权助手 + owner-key 端点 → spec 归属矩阵/bind/unbind/mine → CLI bind-key）。
  - T6 web 按行放开：`canOperate = canManage || row.mine === true` 作用于装/卸/回滚，
    启停（toggle + Popconfirm）**有意保持 canManage**（superadmin 独占）。
  - T7 门禁发现并修复四类连带面（单测全绿后真闸才暴露，与「演练注入盲区」记忆同型）：
    1. S005 归属图双源：market_owner_key 漏登记 `_platform/manifest.yaml` tables
       （schema.yaml 已登，manifest 未登）→ `ojm build` 拒构建；
    2. 三张守卫锚点漂移：s-2 迁移序号 0011、 t-2 shared_allow、 t-4 表数 32→33
       + B 组清单补 market_owner_key；
    3. 契约漂移：`oj openapi` + `ojm api` 重新生成 openapi.json / __client
       （owner-key 两个新端点进契约），生成物须再经 `lint:fix` 才能过 eslint
       （--check 是语义比对，格式化后零漂移仍成立）；
    4. 随站 bundle 重建：0.2.8 tgz + platform.release 重签（canon v2 +
       registry_id oj-registry）+ sync-bundles 收编（裁 6 个历史版）。
  - 反常识追加：`ojm build` 不识别 `--no-minify`（内建于 backend.ts 调 oj 时）；
    eslint quote-props consistent 策略下，连字符 key（"bind-key"）会强制同对象
    全部 key 加引号——help 对象大，人工对齐易错位（本次曾把块插进 verify 内部）。
- **测试面**：templates 生命周期 1334 全绿（market-api.spec 87 例，新增归属矩阵 /
  bind 自证 / unbind / mine 标记）；cli 单测 740 全绿（remote-push 16 例，新增
  bind-key canonical + 409 面）；根仓 1077 全绿（CardGrid 26 例，新增 mine=true
  按行放行 + 非归属全禁）；typecheck / eslint 零错误（6 警告为存量）。
- **耗时**：实现+单测 ≈90min；T7 门禁连带修复（S005/守卫/契约/bundle/usage
  排版）≈40min。
