-- 0015__tenant（postgres 方言）：多租户地基（企微代开发 v3 Phase 0）
-- 表定性同 0015__tenant.sql 头注释（A 组 11 张租户化 / B 组 10 张共享）。
-- pg 可直接丢弃列级 UNIQUE 约束后再建复合唯一键，不需要重建表。
ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN corp_id TEXT;
ALTER TABLE users DROP CONSTRAINT users_username_key;
ALTER TABLE users ADD CONSTRAINT users_tenant_username_key UNIQUE (tenant_id, username);

ALTER TABLE sys_oplog ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sys_user_role ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sys_refresh_token ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
