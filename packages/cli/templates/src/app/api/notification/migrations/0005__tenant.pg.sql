-- 0005__tenant（postgres 方言）：通知四表租户化。TEXT 在 pg 合法，与基础件同语法。
ALTER TABLE notifications ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast_read ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast_hidden ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

