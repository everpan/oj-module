-- 系统设置默认值（PRD §4.3；注释内禁英文分号）
INSERT IGNORE INTO sys_setting (key, module, `group`, type, value, default_value, label_key, secret, update_time) VALUES ('framework.site_title', 'framework', 'general', 'string', 'React Antd Admin', 'React Antd Admin', 'system:setting.site_title', 0, 0);
INSERT IGNORE INTO sys_setting (key, module, `group`, type, value, default_value, label_key, secret, update_time) VALUES ('market.cdn_url', 'market', 'security', 'string', '', '', 'system:setting.market_cdn_url', 0, 0);
INSERT IGNORE INTO sys_setting (key, module, `group`, type, value, default_value, label_key, secret, update_time) VALUES ('ldap.enabled', 'ldap', 'login', 'bool', '0', '0', 'system:setting.ldap_enabled', 0, 0);
INSERT IGNORE INTO sys_setting (key, module, `group`, type, value, default_value, label_key, secret, update_time) VALUES ('sso.enabled', 'sso', 'login', 'bool', '0', '0', 'system:setting.sso_enabled', 0, 0);
