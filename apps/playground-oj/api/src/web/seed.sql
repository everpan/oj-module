-- web 模块种子数据（只放数据，DDL 归 migrations/，S006 纪律）。
-- 注意：seed 按英文分号朴素切分语句，注释里也不要出现英文分号。
INSERT OR IGNORE INTO users (username, password_hash, roles) VALUES ('admin', '$2y$10$ylE2NdjnYiuEcq54W/KxH.bhvGaQQg3rbmYI3mcEHX6LdQEAqixeC', '["admin"]')
