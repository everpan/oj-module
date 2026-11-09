-- 0006（postgres 方言）：回执/隐藏表补 (tenant_id, broadcast_id, user_id) 唯一约束。
-- 口径同基础件：先按每组最小 id 去重（旧实现留下的重复行会让建唯一索引失败），再建唯一索引。
DELETE FROM notifications_broadcast_read WHERE id NOT IN (
  SELECT MIN(id) FROM notifications_broadcast_read GROUP BY tenant_id, broadcast_id, user_id
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_read ON notifications_broadcast_read (tenant_id, broadcast_id, user_id);

DELETE FROM notifications_broadcast_hidden WHERE id NOT IN (
  SELECT MIN(id) FROM notifications_broadcast_hidden GROUP BY tenant_id, broadcast_id, user_id
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_hidden ON notifications_broadcast_hidden (tenant_id, broadcast_id, user_id);
