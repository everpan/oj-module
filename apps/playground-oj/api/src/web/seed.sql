-- web 模块种子数据（只放数据，DDL 归 migrations/，S006 纪律）。
-- 注意：seed 按英文分号朴素切分语句，注释里也不要出现英文分号。
--
-- bcrypt 配方注头（P2-2）：
--   oj 内置 auth/login 用 Rust bcrypt 0.15 校验（bcrypt::verify）。
--   密码统一为 "12345"，cost=10，前缀 $2b$（bcrypt 0.15 兼容 $2a$/$2b$/$2y$）。
--   哈希由 `bcryptjs.hashSync("12345", 10)` 生成，与 oj 校验互通。
--   删模板 admin/123456 行：旧口令不再适用，统一改为 12345 双账号演示。
INSERT OR IGNORE INTO users (username, password_hash, roles) VALUES ('admin', '$2b$10$NPkC/w69U/a5pGfevgP2ieGvZmwF.gjhbEgPv4nGrepBrcPZNq9KO', '["admin"]');
INSERT OR IGNORE INTO users (username, password_hash, roles) VALUES ('common', '$2b$10$ofoSHbc938D5seUfE03rkOE4g0iT3LZ.W760MmL3NYZ6Q34aMrvbS', '["common"]');
