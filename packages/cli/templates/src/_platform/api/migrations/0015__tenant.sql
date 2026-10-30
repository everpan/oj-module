-- 0015__tenant（sqlite 方言）：多租户地基（企微代开发 v3 Phase 0）
-- 21 张表定性（判据：该表是否可能在无租户上下文时被访问）——
--   A 组 租户化 11：users / sys_oplog / sys_user_role / sys_refresh_token
--                   / notifications / notifications_broadcast
--                   / notifications_broadcast_read / notifications_broadcast_hidden
--                   / home_pie / home_line / todos
--   B 组 共享   10：_oj_migrations / sys_setting / sys_solution_route / sys_role / sys_permission
--                   / sys_role_permission / sys_rate_window / sys_login_throttle
--                   / market_history / reg_source_seq
-- B 组须 schema.yaml `tenant: false` + config `tenant.shared_allow` 双声明才豁免守卫。
-- 存量数据一律落 'default' 租户，**不做**自动归户（升级后由管理端显式分配）。
--
-- users：唯一性从「username 全局唯一」收敛为「(tenant_id, username) 同租户唯一」。
-- sqlite 无法 ALTER 掉内联 UNIQUE 约束（sqlite_autoindex 不可 DROP）→ 重建表，其余表只加列。
CREATE TABLE users__tenant_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  corp_id TEXT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_base64 TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  display_name TEXT,
  must_change INTEGER NOT NULL DEFAULT 0,
  is_forbidden INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  phone_number TEXT,
  description TEXT,
  UNIQUE (tenant_id, username)
);
INSERT INTO users__tenant_new (
  id, tenant_id, username, password_hash, avatar_base64, source, display_name,
  must_change, is_forbidden, email, phone_number, description
)
SELECT id, 'default', username, password_hash, avatar_base64, source, display_name,
       must_change, is_forbidden, email, phone_number, description
FROM users;
DROP TABLE users;
ALTER TABLE users__tenant_new RENAME TO users;

ALTER TABLE sys_oplog ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
-- user_id 是全局自增 users.id（跨租户不重复），故主键 (user_id, role_name) 无需扩容
ALTER TABLE sys_user_role ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sys_refresh_token ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
