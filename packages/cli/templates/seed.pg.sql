-- 系统设置默认值（PRD §4.3；注释内禁英文分号）
INSERT INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('framework.site_title', 'framework', 'general', 'string', 'React Antd Admin', 'React Antd Admin', 'system:setting.site_title', 0, 0) ON CONFLICT DO NOTHING;
-- 系统设置默认值（PRD §4.3；注释内禁英文分号；framework.market_cdn_url 缺省 /cdn = 本站点自供，免 setup）
INSERT INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('framework.market_cdn_url', 'framework', 'security', 'string', '/cdn', '/cdn', 'system:setting.market_cdn_url', 0, 0) ON CONFLICT DO NOTHING;
INSERT INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('ldap.enabled', 'ldap', 'login', 'bool', '0', '0', 'system:setting.ldap_enabled', 0, 0) ON CONFLICT DO NOTHING;
INSERT INTO sys_setting (key, module, "group", type, value, default_value, label_key, secret, update_time) VALUES ('sso.enabled', 'sso', 'login', 'bool', '0', '0', 'system:setting.sso_enabled', 0, 0) ON CONFLICT DO NOTHING;
