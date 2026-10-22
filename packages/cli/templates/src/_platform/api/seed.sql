-- _platform 种子数据（只放数据，DDL 归 migrations/，S006 纪律）。
-- 方言覆盖：seed.mysql.sql / seed.pg.sql（INSERT OR IGNORE 为 sqlite 专属语法，方言文件必胜，同迁移约定）。
-- 注意：seed 按英文分号朴素切分语句，注释里也不要出现英文分号。
-- 账号生命周期 D12：admin 为 seed 超管（superadmin），must_change=1 首登强制改密——
-- 初始口令 123456 仅为开发便利，must_change 闭环兜底默认凭据窗口（口令不随机生成的取舍见计划 A2 阶段小结）
INSERT OR IGNORE INTO users (username, password_hash, must_change) VALUES ('admin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', 1);
-- 框架内置角色（ROLES 单一真相：superadmin 安全敏感项 / admin 日常管理 / editor、viewer 页面门）
INSERT OR IGNORE INTO sys_role (name, module, title, builtin) VALUES ('superadmin', 'framework', '超级管理员', 1);
INSERT OR IGNORE INTO sys_role (name, module, title, builtin) VALUES ('admin', 'framework', '系统管理员', 1);
INSERT OR IGNORE INTO sys_role (name, module, title, builtin) VALUES ('editor', 'framework', '编辑', 1);
INSERT OR IGNORE INTO sys_role (name, module, title, builtin) VALUES ('viewer', 'framework', '访客', 1);
-- seed 超管绑定（sys_user_role 唯一权威源，D10）
INSERT OR IGNORE INTO sys_user_role (user_id, role_name) SELECT id, 'superadmin' FROM users WHERE username = 'admin';
-- 系统设置默认值（PRD §4.3；C4 设置页 / C5 登录方式发现的数据源；framework.market_cdn_url 安全组仅 superadmin 可改）
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('framework.site_title', 'framework', 'general', 'string', 'React Antd Admin', 'React Antd Admin', 'system:setting.site_title', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('framework.market_cdn_url', 'framework', 'security', 'string', '', '', 'system:setting.market_cdn_url', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap.enabled', 'ldap', 'login', 'bool', '0', '0', 'system:setting.ldap_enabled', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('sso.enabled', 'sso', 'login', 'bool', '0', '0', 'system:setting.sso_enabled', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap_base_dn', 'ldap', 'ldap', 'string', '', '', 'system:setting.ldap_base_dn', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap_uid_attr', 'ldap', 'ldap', 'string', 'uid', 'uid', 'system:setting.ldap_uid_attr', 0, 0);
INSERT OR IGNORE INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap_email_attr', 'ldap', 'ldap', 'string', 'mail', 'mail', 'system:setting.ldap_email_attr', 0, 0);
