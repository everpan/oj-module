-- _platform 种子数据 mysql 方言覆盖（方言覆盖文件必胜；INSERT OR IGNORE → INSERT IGNORE）。
-- 语句分号切分与注释纪律同基线 seed.sql；账号口径同基线（账号名=角色名，口令 aA123456，must_change=0）。
INSERT IGNORE INTO users (username, password_hash, must_change) VALUES ('superadmin', '$2y$10$9HEtASi9jG0VIBMMVqxAmOqrE4f6wiezhGmi50iPG1s1MXlncSO0e', 0);
INSERT IGNORE INTO users (username, password_hash, must_change) VALUES ('admin', '$2y$10$9HEtASi9jG0VIBMMVqxAmOqrE4f6wiezhGmi50iPG1s1MXlncSO0e', 0);
INSERT IGNORE INTO users (username, password_hash, must_change) VALUES ('editor', '$2y$10$9HEtASi9jG0VIBMMVqxAmOqrE4f6wiezhGmi50iPG1s1MXlncSO0e', 0);
INSERT IGNORE INTO users (username, password_hash, must_change) VALUES ('viewer', '$2y$10$9HEtASi9jG0VIBMMVqxAmOqrE4f6wiezhGmi50iPG1s1MXlncSO0e', 0);
DELETE FROM sys_user_role WHERE role_name = 'superadmin' AND user_id = (SELECT id FROM users WHERE username = 'admin');
UPDATE users SET must_change = 0 WHERE username IN ('superadmin', 'admin', 'editor', 'viewer');
INSERT IGNORE INTO sys_role (name, module, title, builtin) VALUES ('superadmin', 'framework', '超级管理员', 1);
INSERT IGNORE INTO sys_role (name, module, title, builtin) VALUES ('admin', 'framework', '系统管理员', 1);
INSERT IGNORE INTO sys_role (name, module, title, builtin) VALUES ('editor', 'framework', '编辑', 1);
INSERT IGNORE INTO sys_role (name, module, title, builtin) VALUES ('viewer', 'framework', '访客', 1);
INSERT IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'superadmin';
INSERT IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'admin' FROM users WHERE username = 'admin';
INSERT IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'editor' FROM users WHERE username = 'editor';
INSERT IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'viewer' FROM users WHERE username = 'viewer';
-- 组织架构共享读面全量权限点（基线 seed 同款，注释不重复）：scope=all 挂 platform.org.read.all
INSERT IGNORE INTO sys_permission (code, module, title_key, deprecated) VALUES ('platform.org.read.all', 'framework', 'system:perm.platform_org_read_all', 0);
-- 企微组织架构同步（B2）：触发同步是打上游的动作，挂权限点；admin/superadmin 天然通过，
-- 只有自定义角色需要显式绑定（与 platform.org.read.all 同一条纪律：不落库就永远绑不上）。
INSERT IGNORE INTO sys_permission (code, module, title_key, deprecated) VALUES ('auth.wecom.sync', 'auth', 'system:perm.auth_wecom_sync', 0);
