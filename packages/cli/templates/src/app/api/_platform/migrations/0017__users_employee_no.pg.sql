-- 0017__users_employee_no（postgres 方言）：工号列 + 租户内唯一。列语义同 0017__users_employee_no.sql 头注释。
-- 差异（沿用 0016__org.pg.sql 惯例）：TEXT 在 pg 合法且可用于部分唯一索引，无需收窄类型。
ALTER TABLE users ADD COLUMN employee_no TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uk_users_employee_no ON users (tenant_id, employee_no) WHERE employee_no IS NOT NULL;
