-- _platform 种子数据（只放数据，DDL 归 migrations/，S006 纪律）。
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
