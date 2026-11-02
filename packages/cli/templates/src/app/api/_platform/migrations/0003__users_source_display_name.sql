-- RBAC 地基：users 扩展列 + 移除 roles JSON 列（D10：sys_user_role 表为唯一权威源）
-- sqlite 方言（ALTER TABLE DROP COLUMN 需 sqlite ≥ 3.35，Node 22 内建满足）
ALTER TABLE users ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users DROP COLUMN roles;
