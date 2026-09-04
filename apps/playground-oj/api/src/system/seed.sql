-- system 模块种子（P2-3，F8b 列清单）：角色/菜单/角色菜单，幂等 INSERT OR IGNORE。
-- 菜单 id 显式取 100+ 便于 role_menu 引用与教学对照。按分号朴素切分（S006）。
INSERT OR IGNORE INTO roles (id, name, code, status, remark) VALUES (1, 'admin', 'admin', 1, '管理员');
INSERT OR IGNORE INTO roles (id, name, code, status, remark) VALUES (2, 'common', 'common', 1, '普通用户');

-- 菜单：首页(100) / 系统(101,catalog)[角色(102) 菜单(103)] / 关于(104) / 异常(105,catalog)[403(106) 404(107)]
-- menu_type：0 菜单 / 1 目录。其余 UI 列有默认空值（current_active_menu/iframe_link/...）。
INSERT OR IGNORE INTO menus (id, parent_id, name, path, component, icon, sort, menu_type, status) VALUES (100, 0, 'home', '/home', '/home/index', 'HomeOutlined', 1, 0, 1);
INSERT OR IGNORE INTO menus (id, parent_id, name, path, component, icon, sort, menu_type, status) VALUES (101, 0, 'system', '/system', '', 'SettingOutlined', 2, 1, 1);
INSERT OR IGNORE INTO menus (id, parent_id, name, path, component, icon, sort, menu_type, status) VALUES (102, 101, 'role', '/system/role', '/system/role/index', 'TeamOutlined', 1, 0, 1);
INSERT OR IGNORE INTO menus (id, parent_id, name, path, component, icon, sort, menu_type, status) VALUES (103, 101, 'menu', '/system/menu', '/system/menu/index', 'MenuOutlined', 2, 0, 1);
INSERT OR IGNORE INTO menus (id, parent_id, name, path, component, icon, sort, menu_type, status) VALUES (104, 0, 'about', '/about', '/about/index', 'CopyrightOutlined', 3, 0, 1);
INSERT OR IGNORE INTO menus (id, parent_id, name, path, component, icon, sort, menu_type, status) VALUES (105, 0, 'exception', '/exception', '', 'FileTextOutlined', 4, 1, 1);
INSERT OR IGNORE INTO menus (id, parent_id, name, path, component, icon, sort, menu_type, status) VALUES (106, 105, '403', '/exception/403', '/exception/403/index', 'LockOutlined', 1, 0, 1);
INSERT OR IGNORE INTO menus (id, parent_id, name, path, component, icon, sort, menu_type, status) VALUES (107, 105, '404', '/exception/404', '/exception/404/index', 'FileTextOutlined', 2, 0, 1);

-- admin 拥有全部菜单（F2 全量）
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('admin', 100);
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('admin', 101);
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('admin', 102);
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('admin', 103);
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('admin', 104);
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('admin', 105);
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('admin', 106);
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('admin', 107);

-- common 仅首页 + 关于（演示 API 级权限差异 F2）
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('common', 100);
INSERT OR IGNORE INTO role_menu (role, menu_id) VALUES ('common', 104);
