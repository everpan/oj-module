-- 0005__tenant（mysql 方言）：通知四表租户化。
-- 差异：TEXT 不能带字面默认值 → 租户列用 VARCHAR(255)。
ALTER TABLE notifications ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast_read ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast_hidden ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
