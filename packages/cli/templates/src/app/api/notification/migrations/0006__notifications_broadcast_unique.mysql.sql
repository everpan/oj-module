-- 0006（mysql 方言）：回执/隐藏表补 (tenant_id, broadcast_id, user_id) 唯一约束。
-- 两处方言差异：
--   · MySQL 不允许 `DELETE FROM t WHERE id NOT IN (SELECT … FROM t)`（1093 目标表冲突），
--     去重子查询须包一层派生表 `AS d` 强制物化；
--   · MySQL 8.4 仍不支持 `CREATE UNIQUE INDEX IF NOT EXISTS`，改用 ALTER TABLE ADD UNIQUE KEY。
DELETE FROM notifications_broadcast_read WHERE id NOT IN (
  SELECT min_id FROM (SELECT MIN(id) AS min_id FROM notifications_broadcast_read GROUP BY tenant_id, broadcast_id, user_id) AS d
);
ALTER TABLE notifications_broadcast_read ADD UNIQUE KEY uq_broadcast_read (tenant_id, broadcast_id, user_id);

DELETE FROM notifications_broadcast_hidden WHERE id NOT IN (
  SELECT min_id FROM (SELECT MIN(id) AS min_id FROM notifications_broadcast_hidden GROUP BY tenant_id, broadcast_id, user_id) AS d
);
ALTER TABLE notifications_broadcast_hidden ADD UNIQUE KEY uq_broadcast_hidden (tenant_id, broadcast_id, user_id);
