-- 方案注册路由表重构 mysql 方言覆盖（sqlite 版见 0010__sys_solution_route.sql）。
-- 差异：保留字反引号；整型列取 BIGINT；主键 TEXT → VARCHAR(255)；
-- ALTER ADD COLUMN / CREATE INDEX 无 IF NOT EXISTS（迁移账本一次应用语义兜底，同 0008）。
ALTER TABLE sys_setting ADD COLUMN deprecated BIGINT NOT NULL DEFAULT 0;

DROP TABLE IF EXISTS sys_solution_route;
CREATE TABLE sys_solution_route (
  path VARCHAR(255) PRIMARY KEY,
  module TEXT NOT NULL,
  category TEXT NOT NULL,
  `order` BIGINT NOT NULL DEFAULT 0,
  title_key TEXT,
  required_permission TEXT,
  deprecated BIGINT NOT NULL DEFAULT 0,
  enabled BIGINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_sys_solution_route_module ON sys_solution_route (module);
