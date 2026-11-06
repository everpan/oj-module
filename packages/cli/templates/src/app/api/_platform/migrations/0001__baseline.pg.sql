-- 0001__baseline（postgres 方言）：_platform 全部表结构基线。压平口径见 0001__baseline.sql 头注释。
--
-- 方言差异（沿用历史迁移的既有惯例）：
--   · AUTOINCREMENT → BIGSERIAL（SERIAL 系允许 seed 显式写 id，GENERATED ALWAYS 系不允许）；
--   · TEXT 在 pg 合法，键列与文本列一律保留 TEXT，无需收窄；
--   · 秒级 / 毫秒级 epoch 的整型一律取 BIGINT（int4 上限 2.1e9，毫秒时间戳 1.7e12 直接溢出）；
--   · 部分唯一索引 pg 原生支持（工号「有值才唯一」与 sqlite 同语法）。

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  corp_id TEXT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_base64 TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  display_name TEXT,
  must_change INTEGER NOT NULL DEFAULT 0,
  is_forbidden INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  phone_number TEXT,
  description TEXT,
  activated INTEGER NOT NULL DEFAULT 0,
  position TEXT,
  external_status INTEGER,
  employee_no TEXT,
  UNIQUE (tenant_id, username)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_users_employee_no
  ON users (tenant_id, employee_no) WHERE employee_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS sys_setting (
  key TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  "group" TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'string',
  value TEXT,
  default_value TEXT,
  label_key TEXT,
  options TEXT,
  secret INTEGER NOT NULL DEFAULT 0,
  update_time BIGINT NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  group_label_key TEXT
);

CREATE TABLE IF NOT EXISTS sys_oplog (
  id BIGSERIAL PRIMARY KEY,
  create_time BIGINT NOT NULL,
  user_id BIGINT NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT 'framework',
  version TEXT,
  target TEXT,
  detail TEXT,
  level INTEGER NOT NULL DEFAULT 6,
  tenant_id TEXT NOT NULL DEFAULT 'default'
);
CREATE INDEX IF NOT EXISTS idx_sys_oplog_time ON sys_oplog (create_time, id);

CREATE TABLE IF NOT EXISTS sys_solution_route (
  path TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  category TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  title_key TEXT,
  required_permission TEXT,
  deprecated INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sys_solution_route_module ON sys_solution_route (module);

CREATE TABLE IF NOT EXISTS sys_role (
  name TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  title TEXT,
  description TEXT,
  builtin INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  title_key TEXT
);

CREATE TABLE IF NOT EXISTS sys_permission (
  code TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  title_key TEXT,
  deprecated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sys_role_permission (
  role_name TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  PRIMARY KEY (role_name, permission_code)
);

CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id BIGINT NOT NULL,
  role_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  PRIMARY KEY (user_id, role_name)
);

CREATE TABLE IF NOT EXISTS sys_refresh_token (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default'
);
CREATE INDEX IF NOT EXISTS idx_sys_refresh_token_user ON sys_refresh_token (user_id);

CREATE TABLE IF NOT EXISTS sys_rate_window (
  rate_key TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_login_throttle (
  pair_key TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL,
  blocked_until BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS market_history (
  id BIGSERIAL PRIMARY KEY,
  solution TEXT NOT NULL,
  version TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  operator TEXT,
  message TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS reg_source_seq (
  source_url TEXT NOT NULL PRIMARY KEY,
  max_seq BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_sys_department_parent
  ON sys_department (tenant_id, parent_id, deleted, order_no);

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
