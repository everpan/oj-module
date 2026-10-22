-- _platform 种子数据 mysql 方言覆盖（方言覆盖文件必胜；INSERT OR IGNORE → INSERT IGNORE）。
-- 语句分号切分与注释纪律同基线 seed.sql。
INSERT IGNORE INTO users (username, password_hash, must_change) VALUES ('admin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 1);
INSERT IGNORE INTO sys_role (name, module, title, builtin) VALUES ('superadmin', 'framework', '超级管理员', 1);
INSERT IGNORE INTO sys_role (name, module, title, builtin) VALUES ('admin', 'framework', '系统管理员', 1);
INSERT IGNORE INTO sys_role (name, module, title, builtin) VALUES ('editor', 'framework', '编辑', 1);
INSERT IGNORE INTO sys_role (name, module, title, builtin) VALUES ('viewer', 'framework', '访客', 1);
INSERT IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'admin';
-- 内置角色开发账号（每角色一号，口令均 123456，must_change=0 免首登改密——纯开发便利；
-- admin(superadmin) 不在此列，其 must_change=1 的强制改密闭环是默认凭据的安全兜底）
INSERT IGNORE INTO users (username, password_hash, must_change) VALUES ('sysadmin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0);
INSERT IGNORE INTO users (username, password_hash, must_change) VALUES ('editor', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0);
INSERT IGNORE INTO users (username, password_hash, must_change) VALUES ('viewer', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0);
INSERT IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'admin' FROM users WHERE username = 'sysadmin';
INSERT IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'editor' FROM users WHERE username = 'editor';
INSERT IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'viewer' FROM users WHERE username = 'viewer';

