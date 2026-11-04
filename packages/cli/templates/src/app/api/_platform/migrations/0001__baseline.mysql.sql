-- 0001__baseline（mysql 方言）：_platform 全部表结构基线。压平口径见 0001__baseline.sql 头注释。
--
-- 方言差异（沿用历史迁移的既有惯例，逐条都有先例）：
--   · TEXT 不能带字面默认值、不能直接做唯一键/主键 → 需要的那几列收窄为 VARCHAR；
--   · 字符串默认值写成表达式 DEFAULT ('x')（mysql ≥8.0.13 对 TEXT 系只允许表达式默认）；
--   · AUTOINCREMENT → BIGINT AUTO_INCREMENT；秒级 epoch 的整型取 BIGINT；
--   · 保留字（key / group / order）用反引号（mysql 默认 sql_mode 下双引号是字符串字面量）；
--   · 无 CREATE INDEX IF NOT EXISTS → 索引写在 CREATE TABLE 内，由迁移账本保证只执行一次。

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'default',
  corp_id VARCHAR(255) NULL,
  username VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_base64 TEXT NOT NULL DEFAULT (''),
  source TEXT NOT NULL DEFAULT ('local'),
  display_name TEXT,
  must_change BIGINT NOT NULL DEFAULT 0,
  is_forbidden BIGINT NOT NULL DEFAULT 0,
  email TEXT,
  phone_number TEXT,
  description TEXT,
  activated INTEGER NOT NULL DEFAULT 0,
  position VARCHAR(255) NULL,
  external_status INTEGER NULL,
  employee_no VARCHAR(64) NULL,
  UNIQUE KEY uk_users_tenant_username (tenant_id, username),
  -- 无部分索引：NULL 在 mysql 唯一键里可重复出现，效果等同「有值才唯一」
  UNIQUE KEY uk_users_employee_no (tenant_id, employee_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_setting (
  `key` VARCHAR(255) PRIMARY KEY,
  module TEXT NOT NULL,
  `group` TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT ('string'),
  value TEXT,
  default_value TEXT,
  label_key TEXT,
  options TEXT,
  secret BIGINT NOT NULL DEFAULT 0,
  update_time BIGINT NOT NULL DEFAULT 0,
  deprecated BIGINT NOT NULL DEFAULT 0,
  group_label_key TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_oplog (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  create_time BIGINT NOT NULL,
  user_id BIGINT NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT ('system'),
  action TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT ('framework'),
  version TEXT,
  target TEXT,
  detail TEXT,
  level BIGINT NOT NULL DEFAULT 6,
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'default',
  KEY idx_sys_oplog_time (create_time, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_solution_route (
  path VARCHAR(255) PRIMARY KEY,
  -- module 参与索引 → 必须收窄为 VARCHAR：mysql 的 TEXT 列建索引必须给前缀长度
  -- （历史 0010 的 mysql 版在这里直接 ERROR 1170，MySQL 全新安装根本起不来）
  module VARCHAR(255) NOT NULL,
  category TEXT NOT NULL,
  `order` BIGINT NOT NULL DEFAULT 0,
  title_key TEXT,
  required_permission TEXT,
  deprecated BIGINT NOT NULL DEFAULT 0,
  enabled BIGINT NOT NULL DEFAULT 1,
  KEY idx_sys_solution_route_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_role (
  name VARCHAR(255) PRIMARY KEY,
  module TEXT NOT NULL,
  title TEXT,
  description TEXT,
  builtin BIGINT NOT NULL DEFAULT 0,
  deprecated BIGINT NOT NULL DEFAULT 0,
  title_key TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_permission (
  code VARCHAR(255) PRIMARY KEY,
  module TEXT NOT NULL,
  title_key TEXT,
  deprecated BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_role_permission (
  role_name VARCHAR(255) NOT NULL,
  permission_code VARCHAR(255) NOT NULL,
  PRIMARY KEY (role_name, permission_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id BIGINT NOT NULL,
  role_name VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'default',
  PRIMARY KEY (user_id, role_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_refresh_token (
  token_hash VARCHAR(255) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'default',
  KEY idx_sys_refresh_token_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_rate_window (
  rate_key VARCHAR(255) PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_login_throttle (
  pair_key VARCHAR(255) PRIMARY KEY,
  fail_count BIGINT NOT NULL,
  blocked_until BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS market_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  solution VARCHAR(255) NOT NULL,
  version VARCHAR(255) NOT NULL,
  action VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  operator VARCHAR(255),
  message TEXT,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reg_source_seq (
  -- 主键参与索引 → 受 InnoDB 3072 字节上限约束：utf8mb4 每字符 4 字节，
  -- 768 字符正好顶满，取 700 留余量（历史 0014 用 1024 → ERROR 1071，同样起不来）
  source_url VARCHAR(700) NOT NULL,
  max_seq BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (source_url)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
