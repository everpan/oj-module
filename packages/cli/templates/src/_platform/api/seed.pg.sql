-- _platform 种子数据 pg 方言覆盖（方言覆盖文件必胜；INSERT OR IGNORE → ON CONFLICT DO NOTHING）。
-- 语句分号切分与注释纪律同基线 seed.sql；账号口径同基线（账号名=角色名，must_change=0）。
INSERT INTO users (username, password_hash, must_change) VALUES ('superadmin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0) ON CONFLICT DO NOTHING;
INSERT INTO users (username, password_hash, must_change) VALUES ('admin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0) ON CONFLICT DO NOTHING;
INSERT INTO users (username, password_hash, must_change) VALUES ('editor', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0) ON CONFLICT DO NOTHING;
INSERT INTO users (username, password_hash, must_change) VALUES ('viewer', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0) ON CONFLICT DO NOTHING;
DELETE FROM sys_user_role WHERE role_name = 'superadmin' AND user_id = (SELECT id FROM users WHERE username = 'admin');
UPDATE users SET must_change = 0 WHERE username IN ('superadmin', 'admin', 'editor', 'viewer');
INSERT INTO sys_role (name, module, title, builtin) VALUES ('superadmin', 'framework', '超级管理员', 1) ON CONFLICT DO NOTHING;
INSERT INTO sys_role (name, module, title, builtin) VALUES ('admin', 'framework', '系统管理员', 1) ON CONFLICT DO NOTHING;
INSERT INTO sys_role (name, module, title, builtin) VALUES ('editor', 'framework', '编辑', 1) ON CONFLICT DO NOTHING;
INSERT INTO sys_role (name, module, title, builtin) VALUES ('viewer', 'framework', '访客', 1) ON CONFLICT DO NOTHING;
INSERT INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'superadmin' ON CONFLICT DO NOTHING;
INSERT INTO sys_user_role (user_id, role_name) SELECT id, 'admin' FROM users WHERE username = 'admin' ON CONFLICT DO NOTHING;
INSERT INTO sys_user_role (user_id, role_name) SELECT id, 'editor' FROM users WHERE username = 'editor' ON CONFLICT DO NOTHING;
INSERT INTO sys_user_role (user_id, role_name) SELECT id, 'viewer' FROM users WHERE username = 'viewer' ON CONFLICT DO NOTHING;
