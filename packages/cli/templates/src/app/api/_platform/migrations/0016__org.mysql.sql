-- 0016__org（mysql 方言）：组织架构领域。表定性与列语义同 0016__org.sql 头注释。
-- 差异（沿用 0001__create_users.mysql.sql / 0015__tenant.mysql.sql 的既有惯例）：
--   · TEXT 不能带字面默认值、不能直接做唯一键 → 键列按业务长度收窄为 VARCHAR；
--   · AUTOINCREMENT → BIGINT AUTO_INCREMENT；秒级 epoch 的 INTEGER → BIGINT；
--   · 索引写在 CREATE TABLE 内（MySQL 无 CREATE INDEX IF NOT EXISTS）；
--   · 复合唯一键 (tenant_id, origin, origin_id) = (255+32+128) × 4B = 1660B < InnoDB 3072B 上限。
CREATE TABLE IF NOT EXISTS sys_department (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  origin VARCHAR(32) NOT NULL DEFAULT 'local',
  origin_id VARCHAR(128) NOT NULL,
  parent_id BIGINT NULL,
  name VARCHAR(255),
  name_en VARCHAR(255),
  order_no INTEGER NOT NULL DEFAULT 0,
  sync_visible INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  seen_job_id BIGINT,
  update_time BIGINT NOT NULL,
  UNIQUE KEY uk_sys_department_origin (tenant_id, origin, origin_id),
  KEY idx_sys_department_parent (tenant_id, parent_id, deleted, order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_dept_member (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  user_id BIGINT NOT NULL,
  dept_id BIGINT NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 0,
  is_leader INTEGER NOT NULL DEFAULT 0,
  is_main INTEGER NOT NULL DEFAULT 0,
  update_time BIGINT NOT NULL,
  UNIQUE KEY uk_sys_dept_member (tenant_id, user_id, dept_id),
  KEY idx_sys_dept_member_dept (tenant_id, dept_id, order_no),
  KEY idx_sys_dept_member_user (tenant_id, user_id, is_main)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE users ADD COLUMN activated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN position VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN external_status INTEGER NULL;
UPDATE users SET activated = 1;
