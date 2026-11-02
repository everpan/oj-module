-- 0015__tenant（mysql 方言）：多租户地基（企微代开发 v3 Phase 0）
-- 表定性同 0015__tenant.sql 头注释（A 组 11 张租户化 / B 组 10 张共享）。
-- 差异：TEXT 列不能带字面默认值也不能直接做唯一键 → 租户列用 VARCHAR(255)（与 users.username
-- 的既有 mysql 写法一致，schema.yaml 仍声明 text，reconcile 按 text↔varchar 同源处理）。
ALTER TABLE users ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN corp_id VARCHAR(255) NULL;
ALTER TABLE users DROP INDEX username;
ALTER TABLE users ADD UNIQUE KEY uk_users_tenant_username (tenant_id, username);

ALTER TABLE sys_oplog ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
ALTER TABLE sys_user_role ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
ALTER TABLE sys_refresh_token ADD COLUMN tenant_id VARCHAR(255) NOT NULL DEFAULT 'default';
