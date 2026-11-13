# 随站 bundle canon v2 闸门 + oj-market-0.2.7 重签（20261113-2212）

## 背景（缺陷复盘，2026-11-13）

0.2.91 发布包随站 `oj-market-0.2.7.tgz.sig` 是 `canon: "v1"`（REG-CS3 要求 v2），
站点升级时报 `canon_stale` 拒装。根因三件套：

1. **签名器漂移**：Nov 12 发布签名步骤用了 pnpm 全局 `@oj-module/cli@0.2.25`
   （canon v2 于 Oct 25 才合入，0.2.25 切版于 Oct 23）——v1 规范串
   `<name>@<version>:<sha256>`、无 `registry_id` 字段。已用 node:crypto 反验：
   该 sig 对当前 tgz 字节的 v1 规范串验签通过，系当场旧器新签，非旧文件残留。
2. **prepack 闸门盲区**：`packages/cli/scripts/sync-bundles.mjs` 只比对
   `solution.yaml` 版本号与 dist 文件名，**不校 .sig 的 canon 字段**——v1 sig
   畅通无阻收编进 `shell-dist/bundles` 并随发布包出站。
3. **站点侧行为符合设计**：模板 `_lifecycle/steps/verify.ts:173` 对
   `canon !== "v2"` 一律 `canon_stale` 拒装（逼重签，REG-CS3）。

对照组：0.2.6 的 sig（Nov 10 签）是 v2 + `registry_id: oj-registry`——那次用的
工具链恰好是新的；0.2.7 这次换回全局旧 ojm 便退回 v1。

## 任务

| # | 任务 | 验收 | 状态 |
|---|------|------|------|
| T1 | `sync-bundles.mjs` 收编前断言 `.sig` `canon === "v2"`，不符拒发布（exit 1 + 人话处置提示） | 新增 vitest：v1 sig fixture → 脚本 exit 1；v2 sig fixture → exit 0 且 bundles 落位（先红后绿） | ✅ |
| T2 | 用**仓库内** ojm 重签 `templates/dist/oj-market-0.2.7.tgz`（`--id platform.release --registry-id oj-registry --check`），重跑 prepack 收编 | 新 sig `canon: "v2"` + `registry_id`，对当前 tgz 字节验签通过；prepack 通过 | ✅ |
| T3 | 手动上传路径验证：重签后的 tgz+sig 走站点 verify 语义（canon 检查 + 验签 + sha256 绑定）全绿 | 复用 `market/verify.ts` 原语跑真包；lifecycle sign/verify + market-bundle 相关测试全绿 | ✅ |

## 纪律

- 签名只用仓库内 ojm（`node packages/cli/bin/ojm.mjs`），**禁用全局 ojm**
  （`ojm --version` = 0.2.25，恒为 v1 签名器）。
- 私钥不出 `~/.ojm/keys`，签名动作本机手工执行（T2），不入任何脚本/测试。

## 记录的问题分类

- **反常识**：`pnpm pack` 的 prepack 闸门对「版本一致但签名规范过期」的产物
  零感知——漂移检查覆盖了版本维度，漏了签名规范维度。同类盲区模式：
  「数据新鲜 ≠ 格式合规」。

## 总结（2026-11-13 22:20 回填）

- **关键过程**：RED——vitest 新用例（tmp fixture 树隔离跑拷贝的 sync-bundles.mjs，
  测试内临时 Ed25519 密钥造 v1/v2 sig）先红（v1 被收编，exit 0 ≠ 期望 1）；
  GREEN——脚本加 canon 闸门后两例全绿。重签用仓库内
  `node packages/cli/bin/ojm.mjs sign … --check`（canon v2 + registry_id
  `oj-registry`，规范串 `oj-registry:oj-market@0.2.7:ca7d6a…`）；prepack 重跑收编。
  手动上传语义用 node:crypto 按站点 `steps/verify.ts` 规范串原样复演（canon 门槛 +
  Ed25519 验签）通过；shell-dist 收编件与 dist 原件逐字节一致。
- **耗时**：根因排查 ≈25min（上一阶段），修复+TDD+验证 ≈20min。
- **测试面**：新增 `sync-bundles.test.ts` 2 例；关联 13 文件 88 例全绿
  （sync-bundles / market-bundle-freshness / lifecycle sign / sig-fixtures /
  market 全目录）；eslint 零告警。
