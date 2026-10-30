-- 0005__tenant：通知四表租户化（企微代开发 v3 Phase 0 的 A 组）。
-- 广播/按人通知都是租户内数据：不同 corp 的公告与已读回执必须互不可见。
ALTER TABLE notifications ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast_read ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE notifications_broadcast_hidden ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
