-- 0016__org（postgres 方言）：组织架构领域。表定性与列语义同 0016__org.sql 头注释。
-- 差异（沿用 0001__create_users.pg.sql 的既有惯例）：
--   · AUTOINCREMENT → BIGSERIAL（SERIAL 系允许 seed 显式 id，GENERATED ALWAYS 系不允许）；
--   · TEXT 在 pg 合法，键列与文本列一律保留 TEXT，无需收窄；
--   · 秒级 epoch 的 INTEGER → BIGINT。
CREATE TABLE IF NOT EXISTS sys_department (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'local',
  origin_id TEXT NOT NULL,
  parent_id BIGINT,
  name TEXT,
  name_en TEXT,
  order_no INTEGER NOT NULL DEFAULT 0,
  sync_visible INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  seen_job_id BIGINT,
  update_time BIGINT NOT NULL,
  UNIQUE (tenant_id, origin, origin_id)
);
CREATE INDEX IF NOT EXISTS idx_sys_department_parent ON sys_department (tenant_id, parent_id, deleted, order_no);

CREATE TABLE IF NOT EXISTS sys_dept_member (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  dept_id BIGINT NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 0,
  is_leader INTEGER NOT NULL DEFAULT 0,
  is_main INTEGER NOT NULL DEFAULT 0,
  update_time BIGINT NOT NULL,
  UNIQUE (tenant_id, user_id, dept_id)
);
CREATE INDEX IF NOT EXISTS idx_sys_dept_member_dept ON sys_dept_member (tenant_id, dept_id, order_no);
CREATE INDEX IF NOT EXISTS idx_sys_dept_member_user ON sys_dept_member (tenant_id, user_id, is_main);

ALTER TABLE users ADD COLUMN activated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN position TEXT;
ALTER TABLE users ADD COLUMN external_status INTEGER;
UPDATE users SET activated = 1;
