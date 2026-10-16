-- 框架 RBAC 六表 mysql 方言覆盖（sqlite 版见 0004__sys_rbac.sql；oj-wiki 先例同型）。
-- 差异：保留字反引号（mysql 默认 sql_mode 下双引号是字符串字面量）；
-- AUTO_INCREMENT 替 AUTOINCREMENT，id 取 BIGINT（与 users 同宽度口径）；
-- 主键/默认值 TEXT → VARCHAR(255) / 表达式默认值（mysql TEXT 不能作主键、不能直接带默认值）。
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
  update_time BIGINT NOT NULL DEFAULT 0
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
  level BIGINT NOT NULL DEFAULT 6
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- mysql 无 CREATE INDEX IF NOT EXISTS；迁移账本保证一次应用（oj-bin docs/migration.md 语义）
CREATE INDEX idx_sys_oplog_time ON sys_oplog (create_time, id);

CREATE TABLE IF NOT EXISTS sys_solution_route (
  name VARCHAR(255) NOT NULL,
  version VARCHAR(255) NOT NULL,
  category TEXT NOT NULL,
  path VARCHAR(255) NOT NULL,
  `order` BIGINT NOT NULL DEFAULT 0,
  title_key TEXT,
  enabled BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (name, version, path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_role (
  name VARCHAR(255) PRIMARY KEY,
  module TEXT NOT NULL,
  title TEXT,
  description TEXT,
  builtin BIGINT NOT NULL DEFAULT 0,
  deprecated BIGINT NOT NULL DEFAULT 0
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
  PRIMARY KEY (user_id, role_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
