-- 框架 RBAC 六表（设计文档 §5.9.2；判权权威源 + 升级稳定性 deprecated 的地基）
-- sqlite 方言；mysql/pg 方言变体在阶段 A 冒烟时补齐
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
  update_time INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sys_oplog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  create_time INTEGER NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT 'framework',
  version TEXT,
  target TEXT,
  detail TEXT,
  level INTEGER NOT NULL DEFAULT 6
);
CREATE INDEX IF NOT EXISTS idx_sys_oplog_time ON sys_oplog (create_time, id);

CREATE TABLE IF NOT EXISTS sys_solution_route (
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  category TEXT NOT NULL,
  path TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  title_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (name, version, path)
);

CREATE TABLE IF NOT EXISTS sys_role (
  name TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  title TEXT,
  description TEXT,
  builtin INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0
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
  user_id INTEGER NOT NULL,
  role_name TEXT NOT NULL,
  PRIMARY KEY (user_id, role_name)
);
