-- 0011__market_owner_key（sqlite 方言）：方案归属者免 superadmin 装/卸的归属绑定表
--（计划 20261122-1155）。每行 = (站点用户, 发布签名 key) 归属声明。
-- 铁律：
--   · key_id 全站唯一（一把 key 一个属主）——绑定必须持钥自证（Ed25519 canonical
--     签名，端点侧验），否则任何人可抢注他人 key_id；
--   · 归属判定的消费方式：market_release 中该 product 任一行 key_id 属于当前用户
--     → 该方案可装/卸（install/uninstall/task 端点，api.ts assertSolutionOperator）；
--   · 共享表（tenant: false，与 market_release 同口径）——key 属主是站点级事实。
CREATE TABLE market_owner_key (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_market_owner_key_id ON market_owner_key(key_id);
CREATE INDEX idx_market_owner_key_user ON market_owner_key(user_id);
