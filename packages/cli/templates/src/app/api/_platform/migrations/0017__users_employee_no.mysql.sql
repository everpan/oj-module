-- 0017__users_employee_no（mysql 方言）：工号列 + 租户内唯一。列语义同 0017__users_employee_no.sql 头注释。
-- 差异（沿用 0015__tenant.mysql.sql 惯例）：
--   · 键列不能用 TEXT 落唯一键 → 按业务长度收窄为 VARCHAR(64)；
--   · 无部分索引 → 普通唯一键，NULL 在 MySQL 里可重复出现，效果等同「有值才唯一」；
--   · (255 + 64) × 4B = 1276B < InnoDB 3072B 上限。
ALTER TABLE users ADD COLUMN employee_no VARCHAR(64) NULL;
ALTER TABLE users ADD UNIQUE KEY uk_users_employee_no (tenant_id, employee_no);
