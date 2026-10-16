-- _platform 种子数据（只放数据，DDL 归 migrations/，S006 纪律）。
-- 注意：seed 按英文分号朴素切分语句，注释里也不要出现英文分号。
-- admin / 123456（bcrypt）；roles 列已移除（D10），角色绑定归 sys_user_role（A2 seed 补 builtin 角色与 admin 绑定）
INSERT OR IGNORE INTO users (username, password_hash) VALUES ('admin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC')
