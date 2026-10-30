-- 0002__tenant：demo.todos 租户化（企微代开发 v3 Phase 0 的 A 组）。
ALTER TABLE todos ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
