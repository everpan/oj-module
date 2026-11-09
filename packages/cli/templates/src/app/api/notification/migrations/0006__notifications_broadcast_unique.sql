-- 0006__notifications_broadcast_unique：回执/隐藏表补 (tenant_id, broadcast_id, user_id) 唯一约束。
-- 背景：oj v0.1.128 起构造器 fromSelect().orIgnore() 三方言通用，模板两处批量写入已迁到构造器；
-- 但 orIgnore **只幂等唯一键冲突**——此前两表只有普通索引、没有唯一键，旧的
-- `INSERT OR IGNORE … SELECT` 是空操作（连跑两次重复落）。故幂等语义由本唯一约束兜底。
-- 存量库可能已有重复行（旧实现产物），先按每组最小 id 去重，否则建唯一索引会直接失败。
DELETE FROM notifications_broadcast_read WHERE id NOT IN (
  SELECT MIN(id) FROM notifications_broadcast_read GROUP BY tenant_id, broadcast_id, user_id
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_read ON notifications_broadcast_read (tenant_id, broadcast_id, user_id);

DELETE FROM notifications_broadcast_hidden WHERE id NOT IN (
  SELECT MIN(id) FROM notifications_broadcast_hidden GROUP BY tenant_id, broadcast_id, user_id
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_hidden ON notifications_broadcast_hidden (tenant_id, broadcast_id, user_id);
