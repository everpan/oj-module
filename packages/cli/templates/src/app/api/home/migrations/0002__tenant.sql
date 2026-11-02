-- 0002__tenant：首页图表两表租户化（企微代开发 v3 Phase 0 的 A 组）。
ALTER TABLE home_pie ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE home_line ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
