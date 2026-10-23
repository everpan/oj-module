-- _platform 种子数据（只放数据，DDL 归 migrations/，S006 纪律）。
-- 方言覆盖：seed.mysql.sql / seed.pg.sql（INSERT OR IGNORE 为 sqlite 专属语法，方言文件必胜，同迁移约定）。
-- 注意：seed 按英文分号朴素切分语句，注释里也不要出现英文分号。
-- 账号生命周期 D12（2026-10-22 调整）：四个内置角色各一个开发账号，**账号名=角色名**
-- （superadmin/admin/editor/viewer，避免心智负担），口令均 123456，must_change=0 免首登改密——
-- 纯开发便利（默认凭据不随机生成的取舍见计划 A2 阶段小结），生产部署须改密或删除
INSERT OR IGNORE INTO users (username, password_hash, must_change) VALUES ('superadmin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0);
INSERT OR IGNORE INTO users (username, password_hash, must_change) VALUES ('admin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0);
INSERT OR IGNORE INTO users (username, password_hash, must_change) VALUES ('editor', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0);
INSERT OR IGNORE INTO users (username, password_hash, must_change) VALUES ('viewer', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 0);
-- 历史 seed 把 admin 绑在 superadmin 上；收敛为账号名=角色名（幂等 DELETE，每次重放生效）。
-- 已存在库中 admin 行可能残留 must_change=1，UPDATE 统一收敛为 0（四个均为 seed 自有开发账号）
DELETE FROM sys_user_role WHERE role_name = 'superadmin' AND user_id = (SELECT id FROM users WHERE username = 'admin');
UPDATE users SET must_change = 0 WHERE username IN ('superadmin', 'admin', 'editor', 'viewer');
-- 框架内置角色（ROLES 单一真相：superadmin 安全敏感项 / admin 日常管理 / editor、viewer 页面门）
INSERT OR IGNORE INTO sys_role (name, module, title, builtin) VALUES ('superadmin', 'framework', '超级管理员', 1);
INSERT OR IGNORE INTO sys_role (name, module, title, builtin) VALUES ('admin', 'framework', '系统管理员', 1);
INSERT OR IGNORE INTO sys_role (name, module, title, builtin) VALUES ('editor', 'framework', '编辑', 1);
INSERT OR IGNORE INTO sys_role (name, module, title, builtin) VALUES ('viewer', 'framework', '访客', 1);
-- 角色绑定（sys_user_role 唯一权威源，D10）：账号名=角色名一一对应
INSERT OR IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'superadmin';
INSERT OR IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'admin' FROM users WHERE username = 'admin';
INSERT OR IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'editor' FROM users WHERE username = 'editor';
INSERT OR IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'viewer' FROM users WHERE username = 'viewer';
-- 系统设置默认值（PRD §4.3；C4 设置页 / C5 登录方式发现的数据源；framework.market_cdn_url 安全组仅 superadmin 可改）
-- framework.market_cdn_url 缺省 /cdn = 本站点自供（config.yaml 的 /cdn 挂载直出工程根 cdn/），脚手架免 setup；外部真 CDN 才改指绝对地址
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('framework.site_title', 'framework', 'general', 'string', 'React Antd Admin', 'React Antd Admin', 'system:setting.site_title', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('framework.market_cdn_url', 'framework', 'security', 'string', '/cdn', '/cdn', 'system:setting.market_cdn_url', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap.enabled', 'ldap', 'login', 'bool', '0', '0', 'system:setting.ldap_enabled', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('sso.enabled', 'sso', 'login', 'bool', '0', '0', 'system:setting.sso_enabled', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap_base_dn', 'ldap', 'ldap', 'string', '', '', 'system:setting.ldap_base_dn', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap_uid_attr', 'ldap', 'ldap', 'string', 'uid', 'uid', 'system:setting.ldap_uid_attr', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap_email_attr', 'ldap', 'ldap', 'string', 'mail', 'mail', 'system:setting.ldap_email_attr', 0, 0);
